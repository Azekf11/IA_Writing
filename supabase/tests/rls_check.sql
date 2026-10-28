-- Manual RLS and quota check for the local database. Local only: it creates and deletes two test users.
-- Run: docker exec -i supabase_db_IA_Writing psql -U postgres -d postgres < supabase/tests/rls_check.sql
-- Every line marked "must FAIL" should print an ERROR; the "expect" lines give the right value.
-- two fake users
insert into auth.users (id, instance_id, aud, role, email) values
 ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@test.dev'),
 ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@test.dev');

-- act as user A
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
\echo '== quota: limit 2 -> expect 1, 2, -1'
select public.consume_quota(2);
select public.consume_quota(2);
select public.consume_quota(2);
\echo '== refund -> then expect 2 again'
select public.refund_quota();
select public.consume_quota(2);

\echo '== insert own history (ok)'
insert into public.rewrites (user_id, original, locale) values ('11111111-1111-1111-1111-111111111111','hello','en');
\echo '== insert for another user (must FAIL, RLS)'
insert into public.rewrites (user_id, original, locale) values ('22222222-2222-2222-2222-222222222222','evil','en');
\echo '== bad locale (must FAIL)'
insert into public.rewrites (user_id, original, locale) values ('11111111-1111-1111-1111-111111111111','x','de');
\echo '== text too long (must FAIL)'
insert into public.rewrites (user_id, original, locale) select '11111111-1111-1111-1111-111111111111', repeat('a',5001), 'en';
\echo '== direct write to usage (must FAIL)'
update public.usage set count = 0;
insert into public.usage (user_id, count) values ('11111111-1111-1111-1111-111111111111', 0);

-- act as user B
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
\echo '== user B sees 0 rewrites of A (expect 0)'
select count(*) from public.rewrites;
\echo '== user B sees 0 usage rows of A (expect 0)'
select count(*) from public.usage;
\echo '== user B delete A row affects 0 rows'
delete from public.rewrites;
\echo '== user B has own fresh quota (expect 1)'
select public.consume_quota(2);

-- anonymous
reset role;
set role anon;
\echo '== anon cannot call consume_quota (must FAIL)'
select public.consume_quota(2);
\echo '== anon cannot read rewrites (must FAIL)'
select count(*) from public.rewrites;

-- user A still has the row
reset role; set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
\echo '== user A still has 1 row (expect 1)'
select count(*) from public.rewrites;
\echo '== user A delete own (expect DELETE 1)'
delete from public.rewrites;

-- cascade on user deletion
reset role;
insert into public.rewrites (user_id, original, locale) values ('22222222-2222-2222-2222-222222222222','keep','en');
delete from auth.users where email in ('a@test.dev','b@test.dev');
\echo '== cascade: rewrites + usage empty (expect 0, 0)'
select (select count(*) from public.rewrites) as rewrites, (select count(*) from public.usage) as usage;

-- Hosted projects grant broad table privileges by default; the migration
-- 20261028000000_tighten_grants.sql narrows them. Expect only the rows below.
select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by 1, 2 order by 2, 1;
