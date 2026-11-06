-- The quota and the corpus search become server-side operations, second step of two: nothing a
-- browser can call or write is left. Apply it only once no app version that calls the old signatures
-- is running: docs/DEPLOY.md gives the order, and what a rollback needs after this point.
--
-- A signed-in user keeps reading and deleting their own history, and reading their own counter.
-- The route writes the history with the account taken from the verified session.

drop function public.reserve_quota();
drop function public.start_rewrite(uuid);
drop function public.finish_rewrite(uuid, text);
drop function public.release_quota(uuid);
drop function public.search_style_passages(uuid, extensions.vector, text, integer);
drop function public.read_style_passages(uuid);

-- Only the old two-call search used it
alter table public.quota_reservations drop column search_results;

drop policy "rewrites: insert own" on public.rewrites;
revoke insert on public.rewrites from authenticated;
