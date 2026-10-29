-- Fixes a quota bypass: refund_quota() let a signed-in user hand back requests they never lost,
-- by calling it straight on the public API. A refund now needs the unguessable id of a
-- reservation made for that user, and each reservation can be returned only once.
create table public.quota_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now()
);

create index quota_reservations_created_idx on public.quota_reservations (created_at);

-- Users never read this table, so they cannot learn the id of a reservation made on their behalf.
alter table public.quota_reservations enable row level security;
revoke all on public.quota_reservations from anon, authenticated;
grant all on public.quota_reservations to service_role;

-- Takes one request from today's quota and returns the reservation id.
-- Returns null when the daily limit is already reached.
create function public.reserve_quota(daily_limit integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  new_count integer;
  reservation uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.usage as u (user_id, day, count)
  values (uid, today, 1)
  on conflict (user_id, day)
  do update set count = u.count + 1
    where u.count < daily_limit
  returning u.count into new_count;

  -- The conflict branch skipped the update: the limit was hit
  if new_count is null then
    return null;
  end if;

  -- Old reservations are only needed for a few seconds: keep the table small
  delete from public.quota_reservations where created_at < now() - interval '2 days';

  insert into public.quota_reservations (user_id, day)
  values (uid, today)
  returning id into reservation;
  return reservation;
end;
$$;

-- Gives a request back, once, for a reservation the caller owns. Returns whether it did.
create function public.release_quota(reservation uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  reserved_day date;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Deleting first makes a second release of the same reservation find nothing
  delete from public.quota_reservations
  where id = reservation and user_id = uid
  returning day into reserved_day;

  if reserved_day is null then
    return false;
  end if;

  update public.usage
  set count = greatest(count - 1, 0)
  where user_id = uid and day = reserved_day;
  return true;
end;
$$;

revoke all on function public.reserve_quota(integer) from public, anon;
revoke all on function public.release_quota(uuid) from public, anon;
grant execute on function public.reserve_quota(integer) to authenticated;
grant execute on function public.release_quota(uuid) to authenticated;

-- The vulnerable function goes now. consume_quota() only ever hurts its caller, and the
-- deployed app may still use it until the new code is live: drop it in a later migration.
drop function public.refund_quota();
