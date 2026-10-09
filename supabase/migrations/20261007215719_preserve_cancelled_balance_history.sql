-- Allow fully settled/cancelled rows to remain as zero balances; retain their original value.
alter table public.outstanding_balances add column cancelled_original_amount numeric;
alter table public.outstanding_balances drop constraint outstanding_balances_original_amount_check;
alter table public.outstanding_balances add constraint outstanding_balances_original_amount_check check(original_amount>=0);
revoke insert,update,delete on public.receipts from public,anon,authenticated;
revoke delete on public.outstanding_balances from public,anon,authenticated;
