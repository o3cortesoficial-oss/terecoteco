create table if not exists public.funnel_events (
  id bigserial primary key,
  event_type text not null,
  stage text not null,
  product_slug text,
  product_name text,
  session_id text,
  order_id text,
  traffic_source text,
  path text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists funnel_events_created_at_idx
  on public.funnel_events (created_at desc);

create index if not exists funnel_events_session_created_idx
  on public.funnel_events (session_id, created_at desc);

create index if not exists funnel_events_stage_idx
  on public.funnel_events (stage);
