create extension if not exists pgcrypto;

create table if not exists public.receptionist (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shift text not null default 'Morning',
  pin text not null,
  created_at timestamptz not null default now()
);

insert into public.receptionist (name, shift, pin)
select 'Front Desk', 'Morning', '0404'
where not exists (
  select 1
  from public.receptionist
);

create table if not exists public.cash_register_sessions (
  id uuid primary key default gen_random_uuid(),
  receptionist_id uuid not null references public.receptionist(id),
  opening_cash numeric(12,2) not null default 0,
  closing_cash numeric(12,2),
  variance numeric(12,2),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists cash_register_sessions_opened_at_idx
  on public.cash_register_sessions (opened_at desc);

create index if not exists cash_register_sessions_receptionist_id_idx
  on public.cash_register_sessions (receptionist_id);