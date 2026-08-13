create table if not exists public.birthday_greetings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  birthday_date date not null,
  greeted_at timestamptz not null default now(),
  receptionist_id uuid references public.receptionist(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint birthday_greetings_unique_clinic_patient_date unique (clinic_id, patient_id, birthday_date)
);

create index if not exists birthday_greetings_clinic_date_idx
  on public.birthday_greetings (clinic_id, birthday_date);

create index if not exists birthday_greetings_receptionist_idx
  on public.birthday_greetings (receptionist_id);

alter table public.birthday_greetings enable row level security;

drop policy if exists birthday_greetings_select on public.birthday_greetings;
drop policy if exists birthday_greetings_insert on public.birthday_greetings;
drop policy if exists birthday_greetings_update on public.birthday_greetings;

create policy birthday_greetings_select on public.birthday_greetings
for select
using (public.can_access_clinic(clinic_id));

create policy birthday_greetings_insert on public.birthday_greetings
for insert
with check (public.can_access_clinic(clinic_id));

create or replace function public.get_clinic_birthday_patients(
  p_clinic_id uuid,
  p_target_date date default ((now() at time zone 'Asia/Dubai')::date)
)
returns table (
  patient_id uuid,
  clinic_patient_file_id uuid,
  file_no text,
  clinic_mrn text,
  full_name text,
  date_of_birth date,
  sex text,
  nationality text,
  phone text,
  email text,
  greeted boolean,
  greeted_at timestamptz,
  greeted_by_receptionist_id uuid,
  greeted_by_receptionist_name text
)
language sql
stable
set search_path = public
as $$
  select
    p.id as patient_id,
    cpf.id as clinic_patient_file_id,
    cpf.file_no,
    cpf.mrn as clinic_mrn,
    p.name as full_name,
    p.date_of_birth,
    p.sex,
    p.nationality,
    p.phone,
    p.email,
    (bg.id is not null) as greeted,
    bg.greeted_at,
    bg.receptionist_id as greeted_by_receptionist_id,
    r.name as greeted_by_receptionist_name
  from public.clinic_patient_files cpf
  join public.patients p on p.id = cpf.patient_id
  left join public.birthday_greetings bg
    on bg.clinic_id = cpf.clinic_id
   and bg.patient_id = cpf.patient_id
   and bg.birthday_date = p_target_date
  left join public.receptionist r
    on r.id = bg.receptionist_id
  where cpf.clinic_id = p_clinic_id
    and p.date_of_birth is not null
    and extract(month from p.date_of_birth) = extract(month from p_target_date)
    and extract(day from p.date_of_birth) = extract(day from p_target_date)
  order by p.name asc, cpf.file_no asc;
$$;

create or replace function public.get_clinic_birthday_remaining_count(
  p_clinic_id uuid,
  p_target_date date default ((now() at time zone 'Asia/Dubai')::date)
)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from public.clinic_patient_files cpf
  join public.patients p on p.id = cpf.patient_id
  left join public.birthday_greetings bg
    on bg.clinic_id = cpf.clinic_id
   and bg.patient_id = cpf.patient_id
   and bg.birthday_date = p_target_date
  where cpf.clinic_id = p_clinic_id
    and p.date_of_birth is not null
    and extract(month from p.date_of_birth) = extract(month from p_target_date)
    and extract(day from p.date_of_birth) = extract(day from p_target_date)
    and bg.id is null;
$$;
