-- Clears practice transaction records for Rafaella, File No. #19900.
-- This keeps the patient profile, but removes treatment plans, receipts,
-- credits/deposits, outstanding balances, and clinical notes for this practice patient.

begin;

with target_patient as (
  select id
  from public.patients
  where patient_number = 19900
    and name ilike '%rafaella%'
)
delete from public.patient_credits
where patient_id in (select id from target_patient);

with target_patient as (
  select id
  from public.patients
  where patient_number = 19900
    and name ilike '%rafaella%'
)
delete from public.patient_notes
where patient_id in (select id from target_patient);

with target_patient as (
  select id
  from public.patients
  where patient_number = 19900
    and name ilike '%rafaella%'
), target_balances as (
  select id
  from public.outstanding_balances
  where patient_id in (select id from target_patient)
)
delete from public.balance_payments
where outstanding_balance_id in (select id from target_balances);

with target_patient as (
  select id
  from public.patients
  where patient_number = 19900
    and name ilike '%rafaella%'
)
delete from public.outstanding_balances
where patient_id in (select id from target_patient);

with target_patient as (
  select id
  from public.patients
  where patient_number = 19900
    and name ilike '%rafaella%'
)
delete from public.treatment_plans
where patient_id in (select id from target_patient);

with target_patient as (
  select id
  from public.patients
  where patient_number = 19900
    and name ilike '%rafaella%'
)
delete from public.receipts
where patient_id in (select id from target_patient);

commit;

-- Verification: all counts should be 0 after running the transaction above.
with target_patient as (
  select id, name, patient_number
  from public.patients
  where patient_number = 19900
    and name ilike '%rafaella%'
)
select
  target_patient.name,
  target_patient.patient_number,
  (select count(*) from public.patient_credits where patient_id = target_patient.id) as credits_count,
  (select count(*) from public.patient_notes where patient_id = target_patient.id) as clinical_notes_count,
  (select count(*) from public.outstanding_balances where patient_id = target_patient.id) as outstanding_balances_count,
  (select count(*) from public.treatment_plans where patient_id = target_patient.id) as treatment_plans_count,
  (select count(*) from public.receipts where patient_id = target_patient.id) as receipts_count
from target_patient;
