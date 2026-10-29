-- The corpus now has several sources: Gutenberg books, plus public-domain books and
-- newspapers from Common Corpus. Newspapers have no Gutenberg id, and the kinds grow.
alter table public.style_passages
  alter column gutenberg_id drop not null,
  add column source text not null default 'gutenberg'
    check (source in ('gutenberg', 'common-corpus')),
  add column collection text,
  add column year integer check (year is null or year between 1400 and 1960);

alter table public.style_passages drop constraint style_passages_kind_check;
alter table public.style_passages
  add constraint style_passages_kind_check
  check (kind in ('fiction', 'essay', 'book', 'news'));

create index style_passages_source_idx on public.style_passages (source);

-- The result gains a column (year), which a replacement cannot do: drop and recreate.
drop function public.match_style_passages(extensions.vector, text, text, integer);

create function public.match_style_passages(
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
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.author, p.title, p.kind, p.year, p.body,
    1 - (p.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.style_passages p
  where p.lang = match_lang
    and (match_kind is null or p.kind = match_kind)
  order by p.embedding operator(extensions.<=>) query_embedding
  limit least(match_count, 10);
$$;

revoke all on function public.match_style_passages(extensions.vector, text, text, integer)
  from public, anon;
grant execute on function public.match_style_passages(extensions.vector, text, text, integer)
  to authenticated, service_role;
