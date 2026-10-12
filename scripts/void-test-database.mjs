// Fresh, in-memory PostgreSQL only. No URL, credentials, network or patient data.
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
export async function createVoidTestDatabase() {
  const db = process.argv.includes('--native') ? await (await import('./native-void-test-engine.mjs')).nativeVoidTestEngine() : new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table public.doctors(id uuid primary key);`);
  await db.exec(fs.readFileSync('supabase-schema.sql','utf8').replace('create extension if not exists pgcrypto;', ''));
  await db.exec(`
    create table public.login_logs(id uuid);
    create table public.pos_accounts(id uuid primary key,role text,enabled boolean,name text);
    create table public.pos_manager_access(account_id uuid,clinic_id uuid,permissions text[],starts_on date,ends_on date);
    create table public.clinic_patient_files(id uuid primary key,clinic_id uuid,patient_id uuid,file_no text);
    alter table public.receipts add column clinic_id uuid,add column subtotal numeric,add column vat numeric,add column amount_paid numeric,add column credit_applied numeric,add column treatment_plan_id uuid,add column transaction_type text,add column receipt_number bigint;
    alter table public.receipt_items add column teeth integer[];
    alter table public.refunds add column receptionist_id uuid,add column payment_method text;
    alter table public.refund_items add column refunded_treatment_amount numeric,add column refunded_vat_amount numeric,add column refunded_invoice_amount numeric;
    alter table public.treatment_plan_payments add column source_payment_record_id uuid;
    alter table public.treatment_plan_visits add column receipt_id uuid;
    alter table public.patients add column patient_number text;
    create table public.pos_checkout_requests(id uuid primary key,clinic_id uuid,result jsonb);
  `);
  for (const file of ['supabase-outstanding-balances-migration.sql','supabase-patient-credits-migration.sql']) {
    await db.exec(fs.readFileSync(file,'utf8'));
  }
  // Older credit migration contains an index on this field. Created in schema below if absent.
  await db.exec(`alter table public.outstanding_balances drop constraint outstanding_balances_original_amount_check;
    alter table public.outstanding_balances add constraint outstanding_balances_original_amount_check check(original_amount>=0);
    alter table public.outstanding_balances add column receipt_id uuid,add column cancelled_original_amount numeric;
  `);
  await db.exec(fs.readFileSync('supabase/migrations/20260803103000_payment_allocations_and_refunds.sql','utf8').split('create or replace function public.create_payment_record_with_allocations')[1].replace(/^/, 'create or replace function public.create_payment_record_with_allocations'));
  await db.exec(fs.readFileSync('supabase/migrations/20260809223000_create_legacy_receipt_refund_rpc.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261007110801_atomic_pos_checkout.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261008185229_lock_checkout_register.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261008040000_protected_balance_payment.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261008180415_protected_plan_payment.sql','utf8'));
  for (const file of ['20261007162150_activity_log_and_correction_approvers.sql','20261007180412_approved_receipt_refunds.sql','20261007215053_receipt_corrections_and_eod_status.sql','20261008010000_whole_receipt_void.sql','20261012180113_safe_receipt_void_20261012.sql']) {
    try { await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8')); }
    catch(error) { throw new Error(`${file}: ${error.message}`, {cause:error}); }
  }
  return db;
}
