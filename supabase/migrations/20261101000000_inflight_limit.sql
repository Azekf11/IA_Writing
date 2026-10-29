-- Caps how many rewrites one user can have running at the same moment. Each one holds a
-- serverless function for up to a minute and a paid model call, so twenty at once from a single
-- account is abuse, not use. A reservation counts as "running" for 90 seconds, which is longer
-- than any request may last (60 s): a crashed request frees its slot by itself.
create or replace function public.reserve_quota(daily_limit integer, max_in_flight integer default 2)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  today date := (now() at time zone 'utc')::date;
  new_count integer;
  running integer;
  reservation uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- One request at a time per user through this check: concurrent callers queue on the lock,
  -- so two of them cannot both see a free slot.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));

  select count(*) into running
  from public.quota_reservations
  where user_id = uid and created_at > now() - interval '90 seconds';

  if running >= max_in_flight then
    -- Same answer as a spent quota, so the app needs one code path; it tells them apart below
    raise exception 'too many requests in flight' using errcode = '53400';
  end if;

  insert into public.usage as u (user_id, day, count)
  values (uid, today, 1)
  on conflict (user_id, day)
  do update set count = u.count + 1
    where u.count < daily_limit
  returning u.count into new_count;

  if new_count is null then
    return null;
  end if;

  delete from public.quota_reservations where created_at < now() - interval '2 days';

  insert into public.quota_reservations (user_id, day)
  values (uid, today)
  returning id into reservation;
  return reservation;
end;
$$;

-- release_quota() removes the reservation, which also frees the in-flight slot.
-- A request that finishes fine must free its slot too, without giving the request back:
create function public.finish_rewrite(reservation uuid)
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
  -- Backdating makes the reservation old enough to stop counting as running, yet it stays on
  -- record so a later release_quota() for the same id still finds it.
  update public.quota_reservations
  set created_at = now() - interval '1 hour'
  where id = reservation and user_id = uid;
  return found;
end;
$$;

drop function public.reserve_quota(integer);

revoke all on function public.reserve_quota(integer, integer) from public, anon;
revoke all on function public.finish_rewrite(uuid) from public, anon;
grant execute on function public.reserve_quota(integer, integer) to authenticated;
grant execute on function public.finish_rewrite(uuid) to authenticated;
