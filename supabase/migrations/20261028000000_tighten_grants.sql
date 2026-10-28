-- Hosted Supabase grants every privilege on new tables to anon and authenticated.
-- Keep only what the app needs, so RLS is not the only line of defence.
revoke all on public.rewrites, public.usage from anon, authenticated;

grant select, insert, delete on public.rewrites to authenticated;
grant select on public.usage to authenticated;
