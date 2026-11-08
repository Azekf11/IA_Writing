-- The quota and the corpus search become server-side operations, first step of two.
--
-- What is wrong: the six functions of 20261105000000 are granted to every signed-in user, so
-- anyone with an account can drive them through the public API, without the route and without a
-- model call. Three accounts spend the whole day's 15 places that way, and a ticket reads raw
-- excerpts from the corpus.
--
-- What this adds: the same operations for the server's own identity (the secret key, role
-- service_role). They take the account as an argument, because auth.uid() is null under that key.
-- The route takes it from the session it has just verified. No browser may call them: an account
-- argument in a browser's hands would mean acting for anyone.
--
-- What stays the same: the limits, the UTC windows, the ticket states, the advisory lock (the same
-- key as the old functions, so both generations queue together during the transition), and the
-- rule that a started attempt is never given back.
--
-- Deploying: this file only adds. The running app keeps calling the old signatures, so apply it
-- before the app version that calls these. 20261107000000 then removes the old signatures; it must
-- wait until no old version is running. docs/DEPLOY.md gives the order.

-- Takes one attempt for an account and returns its ticket. Refusals are errors, so a refused call
-- changes nothing (the transaction rolls back):
--   28000  no account
--   23503  no such account: it was deleted while its session was still valid
--   53400  this account already has max_in_flight attempts open
--   53401  this account's daily limit is reached
--   53402  the daily ceiling for all accounts is reached
--   53403  the monthly ceiling for all accounts is reached
-- The two ceilings are checked again, and counted, when the ticket starts.
create function public.reserve_quota(account uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  lim public.quota_limits;
  stale record;
  used integer;
  ticket uuid;
begin
  if account is null then
    raise exception 'no account' using errcode = '28000';
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
  where user_id = account and state in ('reserved', 'started');
  if used >= lim.max_in_flight then
    raise exception 'too many rewrites running for this account' using errcode = '53400';
  end if;

  select coalesce(max(count), 0) into used
  from public.usage where user_id = account and day = today;
  if used >= lim.user_daily then
    raise exception 'daily limit reached for this account' using errcode = '53401';
  end if;

  -- Refuse early when the app is already full, so the request costs nothing more
  select coalesce(max(count), 0) into used
  from public.usage_global where day = today;
  if used >= lim.global_daily then
    raise exception 'daily limit reached for all accounts' using errcode = '53402';
  end if;

  select coalesce(sum(count), 0) into used
  from public.usage_global
  where day >= date_trunc('month', today::timestamp)::date;
  if used >= lim.global_monthly then
    raise exception 'monthly limit reached for all accounts' using errcode = '53403';
  end if;

  insert into public.usage as u (user_id, day, count) values (account, today, 1)
  on conflict (user_id, day) do update set count = u.count + 1;

  insert into public.quota_reservations (user_id, day)
  values (account, today)
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
-- True for a live reserved ticket of this account; false for any other ticket.
-- Raises 53402 or 53403 when a ceiling was reached since the reservation: the ticket stays
-- reserved, so the route gives it back.
create function public.start_rewrite(account uuid, reservation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  lim public.quota_limits;
  used integer;
begin
  if account is null then
    raise exception 'no account' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.quota', 0));
  select * into strict lim from public.quota_limits;

  -- A ticket past its lifetime may already count as free: do not start it
  update public.quota_reservations
  set state = 'started', started_at = now()
  where id = reservation
    and user_id = account
    and state = 'reserved'
    and created_at > now() - make_interval(secs => lim.ticket_ttl_seconds);
  if not found then
    return false;
  end if;

  -- Raising undoes the update above
  select coalesce(max(count), 0) into used
  from public.usage_global where day = today;
  if used >= lim.global_daily then
    raise exception 'daily limit reached for all accounts' using errcode = '53402';
  end if;

  select coalesce(sum(count), 0) into used
  from public.usage_global
  where day >= date_trunc('month', today::timestamp)::date;
  if used >= lim.global_monthly then
    raise exception 'monthly limit reached for all accounts' using errcode = '53403';
  end if;

  insert into public.usage_global as g (day, count) values (today, 1)
  on conflict (day) do update set count = g.count + 1;
  return true;
end;
$$;

-- Closes a started ticket and frees its slot. The attempt stays counted.
-- outcome: succeeded, failed (an error, a refusal or a cut-off answer) or cancelled (the reader
-- left). True only the first time, and only for this account's ticket.
create function public.finish_rewrite(account uuid, reservation uuid, outcome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if account is null then
    raise exception 'no account' using errcode = '28000';
  end if;
  if outcome is null or outcome not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.quota', 0));

  update public.quota_reservations
  set state = outcome, closed_at = now()
  where id = reservation and user_id = account and state = 'started';
  return found;
end;
$$;

-- Gives the attempt back, for a ticket of this account that never started: only then is it certain
-- that the model was not called. True only the first time.
create function public.release_quota(account uuid, reservation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_day date;
begin
  if account is null then
    raise exception 'no account' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.quota', 0));

  update public.quota_reservations
  set state = 'released', closed_at = now()
  where id = reservation and user_id = account and state = 'reserved'
  returning day into ticket_day;
  if ticket_day is null then
    return false;
  end if;

  update public.usage set count = greatest(count - 1, 0)
  where user_id = account and day = ticket_day;
  return true;
end;
$$;

-- The corpus search, for a started ticket of this account, once per ticket, ten passages at most.
--
-- One call: the old search recorded its results and a second function read them, because a browser
-- could make the API's outer query fail after the function had returned, undoing the "once" mark
-- while quoting the passages in the error. Only the server calls this one, and its outer query is
-- fixed, so search_results and the read function have nothing left to guard.
create function public.search_style_passages(
  account uuid,
  reservation uuid,
  query_embedding extensions.vector(256),
  match_lang text,
  match_count integer default 10
)
returns table (
  id text,
  author text,
  title text,
  kind text,
  year integer,
  body text,
  similarity double precision
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if account is null then
    raise exception 'no account' using errcode = '28000';
  end if;

  update public.quota_reservations t
  set searched_at = now()
  where t.id = reservation
    and t.user_id = account
    and t.state = 'started'
    and t.searched_at is null;
  if not found then
    raise exception 'no started ticket for this search' using errcode = '42501';
  end if;

  -- The language filter runs after the vector index: keep scanning until enough rows pass
  perform set_config('hnsw.iterative_scan', 'strict_order', true);
  return query
    select
      p.id, p.author, p.title, p.kind, p.year, p.body,
      1 - (p.embedding operator(extensions.<=>) query_embedding)
    from public.style_passages p
    where p.lang = match_lang
    order by p.embedding operator(extensions.<=>) query_embedding
    limit least(greatest(coalesce(match_count, 10), 0), 10);
end;
$$;

-- For the server only. Supabase's default privileges grant every new function to anon and
-- authenticated, so these have to be taken away one by one.
revoke all on function public.reserve_quota(uuid) from public, anon, authenticated;
revoke all on function public.start_rewrite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_rewrite(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_quota(uuid, uuid) from public, anon, authenticated;
revoke all on function public.search_style_passages(uuid, uuid, extensions.vector, text, integer)
  from public, anon, authenticated;

grant execute on function public.reserve_quota(uuid) to service_role;
grant execute on function public.start_rewrite(uuid, uuid) to service_role;
grant execute on function public.finish_rewrite(uuid, uuid, text) to service_role;
grant execute on function public.release_quota(uuid, uuid) to service_role;
grant execute on function public.search_style_passages(uuid, uuid, extensions.vector, text, integer)
  to service_role;
