-- How the corpus search reads the HNSW index, on synthetic vectors, on a local database. Everything
-- happens in one transaction that is rolled back, so nothing stays. docs/ARCHITECTURE.md shows the
-- output and the command to run it. Timings depend on the machine: the plans are what it shows.
-- Runs on 5,000 rows, or on what psql's -v rows=N asks for.

\if :{?rows} \else \set rows 5000 \endif

begin;

-- A fixed seed, so the rows are the same each run. The graph's random layers are not seeded.
select setseed(0.42);

insert into public.style_passages (id, author, title, lang, kind, n_words, body, embedding)
select
  'explain-' || i,
  'Synthetic author ' || i % 50,
  'Synthetic passage',
  case when i % 2 = 0 then 'en' else 'fr' end,
  'essay',
  2,
  'Synthetic passage',
  (
    select array_agg(random() - 0.5)
    from generate_series(1, 256)
    where i is not null
  )::real[]::extensions.vector(256)
from generate_series(1, :rows) i;

analyze public.style_passages;

-- What search_style_passages sets, so that the language filter cannot leave it short of rows
set local hnsw.iterative_scan = strict_order;

-- One synthetic query vector, kept for the two plans below
create temporary table query_vector on commit drop as
select (
  select array_agg(random() - 0.5)
  from generate_series(1, 256)
)::real[]::extensions.vector(256) as embedding;

\echo
\echo With the index, as the search runs:
explain (analyze, timing off, summary on, costs on)
select p.id, 1 - (p.embedding operator(extensions.<=>) (select embedding from query_vector)) as similarity
from public.style_passages p
where p.lang = 'en'
order by p.embedding operator(extensions.<=>) (select embedding from query_vector)
limit 10;

\echo
\echo Without it, comparing the query with every passage of that language:
set local enable_indexscan = off;
set local enable_bitmapscan = off;
explain (analyze, timing off, summary on, costs on)
select p.id, 1 - (p.embedding operator(extensions.<=>) (select embedding from query_vector)) as similarity
from public.style_passages p
where p.lang = 'en'
order by p.embedding operator(extensions.<=>) (select embedding from query_vector)
limit 10;

rollback;
