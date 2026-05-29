alter table public.product_pages
  add column if not exists fields jsonb not null default '{}'::jsonb,
  add column if not exists elements jsonb not null default '{}'::jsonb;
