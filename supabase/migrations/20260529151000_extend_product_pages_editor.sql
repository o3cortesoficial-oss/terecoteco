alter table public.product_pages
  add column if not exists images jsonb not null default '[]'::jsonb,
  add column if not exists comments jsonb not null default '[]'::jsonb,
  add column if not exists fields jsonb not null default '{}'::jsonb;

update public.product_pages
set images = case
  when coalesce(image_url, '') <> '' and images = '[]'::jsonb then jsonb_build_array(image_url)
  else images
end;
