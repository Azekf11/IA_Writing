-- Recent journalism joins the corpus. Two checks assumed public-domain sources only.

-- A third source: news and magazine articles from the open web datasets
alter table public.style_passages drop constraint style_passages_source_check;
alter table public.style_passages
  add constraint style_passages_source_check
  check (source in ('gutenberg', 'common-corpus', 'web'));

-- Years: public-domain texts stop at 1960, web articles run up to the present.
-- 2022 is the last year taken on purpose (see docs/STYLE_CORPUS.md); 2100 is just a sanity bound.
alter table public.style_passages drop constraint style_passages_year_check;
alter table public.style_passages
  add constraint style_passages_year_check
  check (year is null or year between 1400 and 2100);

-- Web passages must carry the year of their crawl, so the 2022 cut-off can be audited later
alter table public.style_passages
  add constraint style_passages_web_year_check
  check (source <> 'web' or (year is not null and year between 1990 and 2022));
