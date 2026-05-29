create table if not exists public.product_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  subtitle text default '',
  description text default '',
  price numeric(10, 2) not null default 0,
  original_price numeric(10, 2) not null default 0,
  discount numeric(10, 2) not null default 0,
  coupon numeric(10, 2) not null default 0,
  image_url text default '',
  analysis_notes text default '',
  is_active boolean not null default true,
  view_count integer not null default 0,
  order_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.product_pages (
  slug,
  name,
  subtitle,
  description,
  price,
  original_price,
  discount,
  coupon,
  analysis_notes,
  is_active
) values (
  'kit-panela',
  'Jogo de Panelas Antiaderente Ceramica Mimo/Colinox Style 10 Ps',
  'Layout base copiado da pagina Kit Panela',
  'Produto principal do funil atual usando o layout original da loja.',
  61.90,
  199.00,
  137.10,
  18.00,
  'Produto base para clonar novos cadastros com o mesmo layout.',
  true
) on conflict (slug) do update set
  name = excluded.name,
  subtitle = excluded.subtitle,
  description = excluded.description,
  price = excluded.price,
  original_price = excluded.original_price,
  discount = excluded.discount,
  coupon = excluded.coupon,
  analysis_notes = excluded.analysis_notes,
  is_active = excluded.is_active,
  updated_at = now();
