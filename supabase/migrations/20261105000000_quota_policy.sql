-- One quota policy for the whole app, enforced by the database.
--
-- What was wrong:
--  * reserve_quota(daily_limit, max_in_flight) took its limits from the caller, and any signed-in
--    user can call it through the public API;
--  * nothing capped all accounts together, so every new account added more paid calls per day;
--  * the route gave a request back after a model error, a refusal or a cancelled stream, although
--    the paid call had already been sent: cancelling every stream before its first edit gave
--    unlimited model calls;
--  * any signed-in user could call match_style_passages directly and page through the corpus,
--    ten passages at a time, without spending anything.
--
-- What changes:
--  * the limits live in one row, public.quota_limits, that only the database owner and the secret
--    key can change; no signed-in user can;
--  * each attempt is a ticket with an explicit state, and every change of state is a guarded
--    update (`where state = ...`), so a ticket is started, closed or given back at most once;
--  * one transaction-level advisory lock serialises every change of state, so neither parallel
--    requests nor many accounts can go past a limit;
--  * an account's attempt counts when it is reserved; the app-wide ceilings count started
--    attempts, the ones that may reach the model, so tickets held without starting cannot
--    block other accounts;
--  * the corpus search needs a started ticket of the caller's, once per ticket, and hands over
--    what it found in a second call, so an error that undoes the search gives the caller nothing
--    (see below).
--
-- Ticket states:
--   reserved   counts for the account; the model has not been called; can still be given back
--   started    counts for the app too; cleared for the style search and the model, so the model
--              may have been called; never given back
--   released   given back: it never started
--   succeeded, failed, cancelled
--              closed by the route once it started (a reader who left in time may have cost
--              nothing, but a started ticket no longer proves that)
--   expired    closed by the database once ticket_ttl_seconds have passed (a crashed or
--              timed-out request); a ticket that never started is released instead
--
-- Deploying: apply this migration and the app version that calls these functions together. In
-- between, each side calls functions the other does not have, so rewrites fail before the model
-- is called. Nothing is spent during that window.

-- ---- The limits ---------------------------------------------------------------------------------

-- One row. Cautious values for a public demo: they cap the number of model calls, not money.
-- The spending cap itself is set in the Anthropic console.
-- To change a value: update public.quota_limits set user_daily = 10;  (SQL editor, no deploy)
create table public.quota_limits (
  id boolean primary key default true check (id),
  -- attempts per account per UTC day
  user_daily integer not null check (user_daily >= 0),
  -- started attempts per UTC day, all accounts together
  global_daily integer not null check (global_daily >= 0),
  -- started attempts per UTC calendar month, all accounts together
  global_monthly integer not null check (global_monthly >= 0),
  -- attempts one account may have open at the same moment
  max_in_flight integer not null check (max_in_flight >= 1),
  -- after this, a ticket nobody closed is closed by the database. Must stay above the route's
  -- 60 s maximum duration, so a live request never loses its ticket.
  ticket_ttl_seconds integer not null check (ticket_ttl_seconds >= 75)
);

insert into public.quota_limits
  (user_daily, global_daily, global_monthly, max_in_flight, ticket_ttl_seconds)
values (5, 15, 300, 2, 90);

-- Started attempts per UTC day for all accounts together. Kept apart from public.usage, whose
-- rows go with their account: deleting accounts must not lower the total.
create table public.usage_global (
  day date primary key,
  count integer not null default 0 check (count >= 0)
);

-- Requests already counted under the old scheme reached the model (failures were given back),
-- so they count toward the new ceilings
insert into public.usage_global (day, count)
select day, sum(count)::integer from public.usage group by day;

alter table public.quota_limits enable row level security;
alter table public.usage_global enable row level security;
revoke all on public.quota_limits, public.usage_global from anon, authenticated;
grant all on public.quota_limits, public.usage_global to service_role;

-- ---- Tickets --------------------------------------------------------------------------------

alter table public.quota_reservations
  add column state text not null default 'expired'
    check (state in ('reserved', 'started', 'released', 'succeeded', 'failed', 'cancelled', 'expired')),
  add column started_at timestamptz,
  add column searched_at timestamptz,
  add column search_results jsonb,
  add column closed_at timestamptz;

-- Tickets from before this migration are closed and counted (public.usage already counts them);
-- their outcome was never recorded. New tickets start as reserved.
update public.quota_reservations set closed_at = now();
alter table public.quota_reservations alter column state set default 'reserved';

create index quota_reservations_open_idx
  on public.quota_reservations (user_id) where state in ('reserved', 'started');

-- The old signatures: one took the limits from the caller, the other closed any ticket.
drop function public.reserve_quota(integer, integer);
drop function public.finish_rewrite(uuid);

-- Takes one attempt for the signed-in user and returns its ticket.
-- Refusals are errors, so a refused call changes nothing (the transaction rolls back):
--   53400  this user already has max_in_flight attempts open
--   53401  this user's daily limit is reached
--   53402  the daily ceiling for all users is reached
--   53403  the monthly ceiling for all users is reached
-- The two ceilings are checked again, and counted, when the ticket starts.
create function public.reserve_quota()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  lim public.quota_limits;
  stale record;
  used integer;
  ticket uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- One change at a time, for everyone: the counts read below cannot move before the insert at
  -- the end. Everything under this lock is bounded, so the queue stays short at this volume.
  perform pg_advisory_xact_lock(hashtextextended('public.quota', 0));

  -- No limits row means no policy: refuse rather than guess (raises when the row is missing)
  select * into strict lim from public.quota_limits;

  -- Close tickets nobody closed in time. One that never started was never paid for, so the
  -- account gets it back; a started one stays counted. A refusal below undoes this, and the next
  -- call does the same work first, so the counts stay right.
  for stale in
    update public.quota_reservations
    set state = case when state = 'reserved' then 'released' else 'expired' end,
        closed_at = now()
    where state in ('reserved', 'started')
      and created_at < now() - make_interval(secs => lim.ticket_ttl_seconds)
    returning user_id, day, state
  loop
    if stale.state = 'released' then
      update public.usage set count = greatest(count - 1, 0)
      where user_id = stale.user_id and day = stale.day;
    end if;
  end loop;

  select count(*) into used
  from public.quota_reservations
  where user_id = uid and state in ('reserved', 'started');
  if used >= lim.max_in_flight then
    raise exception 'too many rewrites running for this user' using errcode = '53400';
  end if;

  select coalesce(max(count), 0) into used
  from public.usage where user_id = uid and day = today;
  if used >= lim.user_daily then
    raise exception 'daily limit reached for this user' using errcode = '53401';
  end if;

  -- Refuse early when the app is already full, so the request costs nothing more
  select coalesce(max(count), 0) into used
  from public.usage_global where day = today;
  if used >= lim.global_daily then
    raise exception 'daily limit reached for all users' using errcode = '53402';
  end if;

  select coalesce(sum(count), 0) into used
  from public.usage_global
  where day >= date_trunc('month', today::timestamp)::date;
  if used >= lim.global_monthly then
    raise exception 'monthly limit reached for all users' using errcode = '53403';
  end if;

  insert into public.usage as u (user_id, day, count) values (uid, today, 1)
  on conflict (user_id, day) do update set count = u.count + 1;

  insert into public.quota_reservations (user_id, day)
  values (uid, today)
  returning id into ticket;

  -- Closed tickets are only kept for a short while. Accepted calls only, oldest first through the
  -- index, and a few at a time: each one removes more than it adds, and a backlog cannot hold up
  -- everyone waiting on the lock.
  delete from public.quota_reservations
  where id in (
    select r.id from public.quota_reservations r
    where r.created_at < now() - interval '2 days'
    order by r.created_at
    limit 200
  );
  return ticket;
end;
$$;

-- Starts the attempt, before the style search and the paid call, and counts it against the
-- app-wide ceilings. From here on it is never given back, whatever happens next.
-- True for a live reserved ticket of the caller's; false for any other ticket.
-- Raises 53402 or 53403 when a ceiling was reached since the reservation: the ticket stays
-- reserved, so the route gives it back.
create function public.start_rewrite(reservation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  lim public.quota_limits;
  used integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.quota', 0));
  select * into strict lim from public.quota_limits;

  -- A ticket past its lifetime may already count as free: do not start it
  update public.quota_reservations
  set state = 'started', started_at = now()
  where id = reservation
    and user_id = uid
    and state = 'reserved'
    and created_at > now() - make_interval(secs => lim.ticket_ttl_seconds);
  if not found then
    return false;
  end if;

  -- Raising undoes the update above
  select coalesce(max(count), 0) into used
  from public.usage_global where day = today;
  if used >= lim.global_daily then
    raise exception 'daily limit reached for all users' using errcode = '53402';
  end if;

  select coalesce(sum(count), 0) into used
  from public.usage_global
  where day >= date_trunc('month', today::timestamp)::date;
  if used >= lim.global_monthly then
    raise exception 'monthly limit reached for all users' using errcode = '53403';
  end if;

  insert into public.usage_global as g (day, count) values (today, 1)
  on conflict (day) do update set count = g.count + 1;
  return true;
end;
$$;

-- Closes a started ticket and frees its slot. The attempt stays counted.
-- outcome: succeeded, failed (an error, a refusal or a cut-off answer) or cancelled (the reader
-- left).
-- True only the first time.
create function public.finish_rewrite(reservation uuid, outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if outcome is null or outcome not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.quota', 0));

  update public.quota_reservations
  set state = outcome, closed_at = now()
  where id = reservation and user_id = uid and state = 'started';
  return found;
end;
$$;

-- Gives the attempt back, for a ticket of the caller's that never started: only then is it
-- certain that the model was not called. True only the first time.
create or replace function public.release_quota(reservation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ticket_day date;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.quota', 0));

  update public.quota_reservations
  set state = 'released', closed_at = now()
  where id = reservation and user_id = uid and state = 'reserved'
  returning day into ticket_day;
  if ticket_day is null then
    return false;
  end if;

  update public.usage set count = greatest(count - 1, 0)
  where user_id = uid and day = ticket_day;
  return true;
end;
$$;

-- ---- The corpus search ----------------------------------------------------------------------

-- Only for a started ticket of the caller's, once per ticket: reading the corpus costs an attempt
-- that counts everywhere, for ten passages at most.
--
-- Two calls, because the API runs each call and its outer query in one transaction. A caller can
-- make that outer query fail once a function has returned (select=body::int raises an error that
-- quotes the value), which undoes whatever the function recorded. If one call both used up the
-- ticket's search and returned the rows, it could be repeated for ever, and every passage read
-- from the error messages. So the search records what it found and returns nothing, and the rows
-- are read in a later call: however that call is abused, it only sees what was recorded.
drop function public.match_style_passages(extensions.vector, text, text, integer);

create function public.search_style_passages(
  reservation uuid,
  query_embedding extensions.vector(256),
  match_lang text,
  match_count integer default 10
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update public.quota_reservations t
  set searched_at = now()
  where t.id = reservation
    and t.user_id = uid
    and t.state = 'started'
    and t.searched_at is null;
  if not found then
    raise exception 'no started ticket for this search' using errcode = '42501';
  end if;

  -- The language filter runs after the vector index: keep scanning until enough rows pass
  perform set_config('hnsw.iterative_scan', 'strict_order', true);
  update public.quota_reservations t
  set search_results = (
    select jsonb_agg(
      jsonb_build_object('id', m.id, 'similarity', m.similarity) order by m.similarity desc
    )
    from (
      select
        p.id,
        1 - (p.embedding operator(extensions.<=>) query_embedding) as similarity
      from public.style_passages p
      where p.lang = match_lang
      order by p.embedding operator(extensions.<=>) query_embedding
      limit least(greatest(coalesce(match_count, 10), 0), 10)
    ) m
  )
  where t.id = reservation;
end;
$$;

-- What the ticket's search found, nearest first; nothing for any other ticket
create function public.read_style_passages(reservation uuid)
returns table (
  id text,
  author text,
  title text,
  kind text,
  year integer,
  body text,
  similarity double precision
)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.author, p.title, p.kind, p.year, p.body, found.similarity
  from public.quota_reservations t
  cross join lateral jsonb_to_recordset(t.search_results)
    as found(id text, similarity double precision)
  join public.style_passages p on p.id = found.id
  where t.id = reservation
    and t.user_id = (select auth.uid())
    and t.state = 'started'
  order by found.similarity desc;
$$;

-- ---- Permissions ----------------------------------------------------------------------------

-- Signed-in users may call these six and nothing else; anonymous visitors may call none.
-- Called directly, they spend the caller's own attempts and places under the shared ceilings,
-- never more: the limits are read here, a started ticket is never given back, and tickets are
-- bound to their owner.
revoke all on function public.reserve_quota() from public, anon, authenticated;
revoke all on function public.start_rewrite(uuid) from public, anon, authenticated;
revoke all on function public.finish_rewrite(uuid, text) from public, anon, authenticated;
revoke all on function public.release_quota(uuid) from public, anon, authenticated;
revoke all on function public.search_style_passages(uuid, extensions.vector, text, integer)
  from public, anon, authenticated;
revoke all on function public.read_style_passages(uuid) from public, anon, authenticated;

grant execute on function public.reserve_quota() to authenticated;
grant execute on function public.start_rewrite(uuid) to authenticated;
grant execute on function public.finish_rewrite(uuid, text) to authenticated;
grant execute on function public.release_quota(uuid) to authenticated;
grant execute on function public.search_style_passages(uuid, extensions.vector, text, integer)
  to authenticated;
grant execute on function public.read_style_passages(uuid) to authenticated;
