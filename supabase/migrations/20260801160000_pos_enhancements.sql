-- POS Enhancements Migration
-- Adds tooth selection, pos holds, plan improvements

-- Add to services table:
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS tooth_selection_mode text NOT NULL DEFAULT 'none' CHECK (tooth_selection_mode IN ('none','optional','required'));
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS default_visit_count integer NOT NULL DEFAULT 1 CHECK (default_visit_count >= 1);

-- Add to receipt_items table:
ALTER TABLE public.receipt_items ADD COLUMN IF NOT EXISTS teeth text[] NOT NULL DEFAULT '{}';

-- Add to treatment_plans table:
ALTER TABLE public.treatment_plans ADD COLUMN IF NOT EXISTS is_legacy boolean NOT NULL DEFAULT false;
ALTER TABLE public.treatment_plans ADD COLUMN IF NOT EXISTS historical_amount_paid numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.treatment_plans ADD COLUMN IF NOT EXISTS payment_arrangement text;
ALTER TABLE public.treatment_plans ADD COLUMN IF NOT EXISTS source_imported_visit_id uuid REFERENCES public.patient_treatment_visits(id) ON DELETE SET NULL;
ALTER TABLE public.treatment_plans ADD COLUMN IF NOT EXISTS clinic_patient_file_id uuid REFERENCES public.clinic_patient_files(id) ON DELETE SET NULL;

-- Add to treatment_plan_visits:
ALTER TABLE public.treatment_plan_visits ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES public.receipts(id) ON DELETE SET NULL;
ALTER TABLE public.treatment_plan_visits ADD COLUMN IF NOT EXISTS teeth text[] NOT NULL DEFAULT '{}';

-- Add to treatment_plan_payments:
ALTER TABLE public.treatment_plan_payments ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.treatment_plan_visits(id) ON DELETE SET NULL;

-- Add to receipts:
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS transaction_type text NOT NULL DEFAULT 'regular' CHECK (transaction_type IN ('regular','plan_payment','plan_summary'));
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS treatment_plan_id uuid REFERENCES public.treatment_plans(id) ON DELETE SET NULL;

-- Create pos_holds:
CREATE TABLE IF NOT EXISTS public.pos_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  patient_name text NOT NULL,
  patient_phone text,
  doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  receptionist_id uuid NOT NULL REFERENCES public.receptionist(id) ON DELETE RESTRICT,
  register_session_id uuid REFERENCES public.cash_register_sessions(id) ON DELETE SET NULL,
  clinic_patient_file_id uuid REFERENCES public.clinic_patient_files(id) ON DELETE SET NULL,
  patient_file_no text,
  status text NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting','In Treatment','Ready to Pay','Cancelled')),
  notes text,
  discount_input text,
  discount_type text DEFAULT 'AED',
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create pos_hold_services:
CREATE TABLE IF NOT EXISTS public.pos_hold_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL REFERENCES public.pos_holds(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  service_name text NOT NULL,
  price numeric(12,2) NOT NULL DEFAULT 0,
  original_price numeric(12,2),
  quantity integer NOT NULL DEFAULT 1,
  teeth text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes:
CREATE INDEX IF NOT EXISTS pos_holds_clinic_id_idx ON public.pos_holds(clinic_id);
CREATE INDEX IF NOT EXISTS pos_holds_patient_id_idx ON public.pos_holds(patient_id);
CREATE INDEX IF NOT EXISTS pos_holds_status_idx ON public.pos_holds(status);
CREATE INDEX IF NOT EXISTS pos_hold_services_hold_id_idx ON public.pos_hold_services(hold_id);
CREATE INDEX IF NOT EXISTS receipt_items_teeth_idx ON public.receipt_items USING GIN(teeth);
CREATE INDEX IF NOT EXISTS treatment_plans_is_legacy_idx ON public.treatment_plans(is_legacy);

-- RLS for pos_holds (same open policy as other tables since app uses anon key):
ALTER TABLE public.pos_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_hold_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_holds_select ON public.pos_holds;
DROP POLICY IF EXISTS pos_holds_insert ON public.pos_holds;
DROP POLICY IF EXISTS pos_holds_update ON public.pos_holds;
DROP POLICY IF EXISTS pos_hold_services_select ON public.pos_hold_services;
DROP POLICY IF EXISTS pos_hold_services_insert ON public.pos_hold_services;
DROP POLICY IF EXISTS pos_hold_services_update ON public.pos_hold_services;
DROP POLICY IF EXISTS pos_hold_services_delete ON public.pos_hold_services;

CREATE POLICY pos_holds_select ON public.pos_holds FOR SELECT USING (true);
CREATE POLICY pos_holds_insert ON public.pos_holds FOR INSERT WITH CHECK (true);
CREATE POLICY pos_holds_update ON public.pos_holds FOR UPDATE USING (true);
CREATE POLICY pos_hold_services_select ON public.pos_hold_services FOR SELECT USING (true);
CREATE POLICY pos_hold_services_insert ON public.pos_hold_services FOR INSERT WITH CHECK (true);
CREATE POLICY pos_hold_services_update ON public.pos_hold_services FOR UPDATE USING (true);
CREATE POLICY pos_hold_services_delete ON public.pos_hold_services FOR DELETE USING (true);
