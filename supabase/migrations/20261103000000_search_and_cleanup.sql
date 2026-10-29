-- Two fixes found in an audit.

-- 1. The language filter runs after the vector index, so a search could return fewer than ten
-- rows (seen on French queries). Iterative scans keep walking the index until enough rows pass.
-- The setting is applied inside the function: a `set` clause on it needs a privilege that
-- migrations do not have.
create or replace function public.match_style_passages(
  query_embedding extensions.vector(256),
  match_lang text,
  match_kind text default null,
  match_count integer default 3
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
stable
security definer
set search_path = ''
as $$
begin
  perform set_config('hnsw.iterative_scan', 'strict_order', true);
  return query
    select
      p.id, p.author, p.title, p.kind, p.year, p.body,
      1 - (p.embedding operator(extensions.<=>) query_embedding) as similarity
    from public.style_passages p
    where p.lang = match_lang
      and (match_kind is null or p.kind = match_kind)
    order by p.embedding operator(extensions.<=>) query_embedding
    limit least(match_count, 10);
end;
$$;

-- Replaced by reserve_quota(); nothing calls it any more.
drop function if exists public.consume_quota(integer);
