-- Automatic File No. generation for new patients.
-- Old-system files go up to ~18,000 and keep their numbers untouched;
-- system-generated File Numbers start at 20,000 so the two ranges never
-- collide. Manually entered numbers keep working and stay unique.
--
-- Why a sequence: nextval() is concurrency-safe — two receptionists creating
-- patients at the same moment always receive different numbers, with no
-- read-max-then-insert race. The function loop skips numbers that were
-- already taken by manual entry. The unique index on patients.patient_number
-- (see supabase-patient-credits-migration.sql) remains the final guarantee,
-- and the app retries on duplicate errors as a last resort.

create sequence if not exists public.patient_file_number_seq start with 20000;

create or replace function public.next_patient_file_number()
returns integer
language plpgsql
as $$
declare
  candidate integer;
begin
  loop
    candidate := nextval('public.patient_file_number_seq');
    exit when not exists (
      select 1 from public.patients where patient_number = candidate
    );
  end loop;
  return candidate;
end;
$$;

grant execute on function public.next_patient_file_number() to anon, authenticated;
