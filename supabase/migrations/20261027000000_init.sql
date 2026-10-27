-- History of rewrites, one row per successful request.
create table public.rewrites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  original text not null check (char_length(original) <= 5000),
  edits jsonb not null default '[]'::jsonb,
  edit_count integer not null default 0 check (edit_count >= 0),
  locale text not null check (locale in ('en', 'fr')),
  created_at timestamptz not null default now()
);

create index rewrites_user_created_idx
  on public.rewrites (user_id, created_at desc);

-- Daily request counter, used for quotas.
create table public.usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  count integer not null default 0 check (count >= 0),
  primary key (user_id, day)
);

alter table public.rewrites enable row level security;
alter table public.usage enable row level security;

-- Users manage their own history. The usage counter is not writable directly.
create policy "rewrites: read own" on public.rewrites
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "rewrites: insert own" on public.rewrites
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "rewrites: delete own" on public.rewrites
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Users can see their own usage; only the functions below can change it.
create policy "usage: read own" on public.usage
  for select to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, delete on public.rewrites to authenticated;
grant select on public.usage to authenticated;
grant all on public.rewrites, public.usage to service_role;

-- Atomically count one request for today.
-- Returns the new count, or -1 when the daily limit is already reached.
create function public.consume_quota(daily_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_count integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.usage as u (user_id, day, count)
  values (uid, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
  do update set count = u.count + 1
    where u.count < daily_limit
  returning u.count into new_count;

  -- The conflict branch skipped the update: the limit was hit
  return coalesce(new_count, -1);
end;
$$;

-- Give a request back when the rewrite failed after the quota was taken.
create function public.refund_quota()
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

  update public.usage
  set count = greatest(count - 1, 0)
  where user_id = uid and day = (now() at time zone 'utc')::date;
end;
$$;

-- Functions are callable by anyone by default: lock them down.
revoke all on function public.consume_quota(integer) from public, anon;
revoke all on function public.refund_quota() from public, anon;
grant execute on function public.consume_quota(integer) to authenticated;
grant execute on function public.refund_quota() to authenticated;
