-- CEO dashboard configuration tables:
-- 1) clinic monthly targets
-- 2) clinic operating schedule (open/closed by weekday)
-- 3) business calendar events (holidays, Ramadan/Eid periods, closures, campaigns)
--
-- Additive migration only.

create table if not exists public.clinic_monthly_targets (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  target_year int not null check (target_year between 2000 and 2100),
  target_month int not null check (target_month between 1 and 12),
  net_sales_target numeric(14,2) not null check (net_sales_target >= 0),
  notes text,
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_monthly_targets_unique unique (clinic_id, target_year, target_month)
);

create index if not exists clinic_monthly_targets_clinic_idx
  on public.clinic_monthly_targets(clinic_id, target_year, target_month);

create table if not exists public.clinic_operating_schedule (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6), -- 0=Sunday ... 6=Saturday
  is_open boolean not null default true,
  opens_at time,
  closes_at time,
  notes text,
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_operating_schedule_unique unique (clinic_id, weekday)
);

create index if not exists clinic_operating_schedule_clinic_idx
  on public.clinic_operating_schedule(clinic_id, weekday);

create table if not exists public.clinic_calendar_events (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade,
  applies_to_all_clinics boolean not null default false,
  event_name text not null,
  event_type text not null check (
    event_type in (
      'public_holiday',
      'ramadan_eid',
      'clinic_closure',
      'marketing_campaign',
      'other_business_event'
    )
  ),
  start_date date not null,
  end_date date not null,
  is_closed_day boolean not null default false,
  notes text,
  created_by uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_calendar_events_date_order check (end_date >= start_date),
  constraint clinic_calendar_events_scope_check check (
    applies_to_all_clinics = true or clinic_id is not null
  )
);

create index if not exists clinic_calendar_events_date_idx
  on public.clinic_calendar_events(start_date, end_date);
create index if not exists clinic_calendar_events_scope_idx
  on public.clinic_calendar_events(applies_to_all_clinics, clinic_id, event_type);

alter table public.clinic_monthly_targets enable row level security;
alter table public.clinic_operating_schedule enable row level security;
alter table public.clinic_calendar_events enable row level security;

drop policy if exists clinic_monthly_targets_select on public.clinic_monthly_targets;
drop policy if exists clinic_monthly_targets_insert on public.clinic_monthly_targets;
drop policy if exists clinic_monthly_targets_update on public.clinic_monthly_targets;
drop policy if exists clinic_monthly_targets_delete on public.clinic_monthly_targets;

drop policy if exists clinic_operating_schedule_select on public.clinic_operating_schedule;
drop policy if exists clinic_operating_schedule_insert on public.clinic_operating_schedule;
drop policy if exists clinic_operating_schedule_update on public.clinic_operating_schedule;
drop policy if exists clinic_operating_schedule_delete on public.clinic_operating_schedule;

drop policy if exists clinic_calendar_events_select on public.clinic_calendar_events;
drop policy if exists clinic_calendar_events_insert on public.clinic_calendar_events;
drop policy if exists clinic_calendar_events_update on public.clinic_calendar_events;
drop policy if exists clinic_calendar_events_delete on public.clinic_calendar_events;

create policy clinic_monthly_targets_select on public.clinic_monthly_targets for select using (true);
create policy clinic_monthly_targets_insert on public.clinic_monthly_targets for insert with check (true);
create policy clinic_monthly_targets_update on public.clinic_monthly_targets for update using (true) with check (true);
create policy clinic_monthly_targets_delete on public.clinic_monthly_targets for delete using (true);

create policy clinic_operating_schedule_select on public.clinic_operating_schedule for select using (true);
create policy clinic_operating_schedule_insert on public.clinic_operating_schedule for insert with check (true);
create policy clinic_operating_schedule_update on public.clinic_operating_schedule for update using (true) with check (true);
create policy clinic_operating_schedule_delete on public.clinic_operating_schedule for delete using (true);

create policy clinic_calendar_events_select on public.clinic_calendar_events for select using (true);
create policy clinic_calendar_events_insert on public.clinic_calendar_events for insert with check (true);
create policy clinic_calendar_events_update on public.clinic_calendar_events for update using (true) with check (true);
create policy clinic_calendar_events_delete on public.clinic_calendar_events for delete using (true);

-- Optional session role normalization for dashboard authorization checks.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'active_sessions'
  ) then
    create index if not exists active_sessions_role_mode_idx
      on public.active_sessions(user_role, session_mode);
  end if;
end
$$;
