-- Public-domain prose passages used as writing references, with their embeddings.
-- Only the service role writes (the ingestion script); users search through a function.
create extension if not exists vector with schema extensions;

create table public.style_passages (
  id text primary key,
  gutenberg_id integer not null,
  author text not null,
  title text not null,
  lang text not null check (lang in ('en', 'fr')),
  kind text not null check (kind in ('fiction', 'essay')),
  n_words integer not null check (n_words > 0),
  body text not null,
  -- First 256 dimensions of static-similarity-mrl-multilingual-v1, L2-normalized
  embedding extensions.vector(256) not null
);

alter table public.style_passages enable row level security;

-- Cosine distance, the metric the embeddings were trained for
create index style_passages_embedding_idx
  on public.style_passages using hnsw (embedding extensions.vector_cosine_ops);
create index style_passages_lang_kind_idx on public.style_passages (lang, kind);

-- The table is never read directly: see match_style_passages() below.
-- Hosted Supabase grants new tables to anon and authenticated, so take it back.
revoke all on public.style_passages from anon, authenticated;
grant all on public.style_passages to service_role;

-- Nearest passages of the requested language, optionally of one kind.
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
  body text,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  select
    p.id, p.author, p.title, p.kind, p.body,
    1 - (p.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.style_passages p
  where p.lang = match_lang
    and (match_kind is null or p.kind = match_kind)
  order by p.embedding operator(extensions.<=>) query_embedding
  limit least(match_count, 10);
$$;

-- Signed-in users reach the table only through this function, which runs with the
-- owner's rights and returns at most 10 rows per call. No service key is needed at runtime.
alter function public.match_style_passages(extensions.vector, text, text, integer) security definer;
revoke all on function public.match_style_passages(extensions.vector, text, text, integer)
  from public, anon;
grant execute on function public.match_style_passages(extensions.vector, text, text, integer)
  to authenticated, service_role;
