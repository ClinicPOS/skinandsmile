-- Add Bank Transfer as a first-class paid payment method.
-- This records the payment exactly like Cash/Card, with no fee or reference requirement.

alter table public.payment_allocations
  drop constraint if exists payment_allocations_method_group_check,
  drop constraint if exists payment_allocations_method_variant_check;

alter table public.payment_allocations
  add constraint payment_allocations_method_group_check
    check (method_group in ('cash','card','bank_transfer','tabby','tamara')),
  add constraint payment_allocations_method_variant_check
    check (method_variant in ('cash','card','bank_transfer','tabby_standard','tabby_card','tamara'));

alter table public.treatment_plan_payment_allocations
  drop constraint if exists treatment_plan_payment_allocations_method_group_check,
  drop constraint if exists treatment_plan_payment_allocations_method_variant_check;

alter table public.treatment_plan_payment_allocations
  add constraint treatment_plan_payment_allocations_method_group_check
    check (method_group in ('cash','card','bank_transfer','tabby','tamara')),
  add constraint treatment_plan_payment_allocations_method_variant_check
    check (method_variant in ('cash','card','bank_transfer','tabby_standard','tabby_card','tamara'));
