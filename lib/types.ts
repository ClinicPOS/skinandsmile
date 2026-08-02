export type Clinic = {
  id: string;
  name: string;
  room: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  receipt_print_name: string | null;
  receipt_title: string | null;
  receipt_vat_note: string | null;
  receipt_thank_you: string | null;
  receipt_final_message: string | null;
  receipt_qr_url: string | null;
  trn: string | null;
  logo: string | null;
};

export type Patient = {
  id: string;
  patient_number?: number | null;
  name: string;
  phone: string | null;
  email?: string | null;
  notes?: string | null;
  date_of_birth?: string | null;
  sex?: string | null;
  nationality?: string | null;
  emirates_id?: string | null;
  passport_number?: string | null;
  mrn?: string | null;
  address?: string | null;
};

export type Doctor = {
  id: string;
  name: string;
  specialty: string;
  clinic_id?: string | null;
};

export type Service = {
  id: string;
  name: string;
  description?: string | null;
  display_name?: string | null;
  variant?: string | null;
  search_keywords?: string | null;
  common_aliases?: string | null;
  price: number;
  standard_price?: number | null;
  promo_price?: number | null;
  clinic_id?: string | null;
  category?: string | null;
  category_id?: string | null;
  requires_quantity?: boolean;
  billing_unit?: string | null;
  tooth_selection_mode?: 'none' | 'optional' | 'required';
  default_visit_count?: number;
  active_plan_recommended?: boolean;
  is_active?: boolean;
  sort_order?: number | null;
  canonical_service_id?: string | null;
  pricing_type?: 'fixed' | 'variable';
  min_price?: number | null;
  max_price?: number | null;
};

export type Receptionist = {
  id: string;
  name: string;
  shift: string;
  pin?: string | null;
  clinic_id?: string | null;
};

export type CashRegisterSession = {
  id: string;
  receptionist_id: string;
  opening_cash: number;
  closing_cash: number | null;
  variance: number | null;
  opened_at: string;
  closed_at: string | null;
};

export type PatientNote = {
  id: string;
  patient_id: string;
  receipt_id: string | null;
  note: string;
  doctor_id: string | null;
  receptionist_id: string | null;
  clinic_id: string | null;
  created_at: string;
};

export type OutstandingBalance = {
  id: string;
  patient_id: string;
  clinic_id: string;
  original_date: string;
  original_amount: number;
  reason: string | null;
  reference_number: string | null;
  created_by: string | null;
  receipt_id?: string | null;
  created_at: string;
};

export type BalancePayment = {
  id: string;
  outstanding_balance_id: string;
  amount: number;
  payment_method: string;
  receptionist_id: string;
  register_session_id: string | null;
  notes: string | null;
  created_at: string;
};

export type PatientCredit = {
  id: string;
  patient_id: string;
  clinic_id: string;
  amount: number; // positive = deposit received, negative = credit applied
  payment_method: string | null;
  reason: string | null;
  expected_treatment_date: string | null;
  notes: string | null;
  receipt_id: string | null;
  receptionist_id: string | null;
  register_session_id: string | null;
  created_at: string;
};

export type TreatmentPlan = {
  id: string;
  patient_id: string;
  clinic_id: string;
  service_id: string | null;
  title: string;
  total_amount: number;
  planned_visits: number;
  status: "Active" | "Completed" | "Cancelled";
  notes: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  is_legacy?: boolean;
  historical_amount_paid?: number;
  payment_arrangement?: string | null;
  source_imported_visit_id?: string | null;
  clinic_patient_file_id?: string | null;
};

export type TreatmentPlanVisit = {
  id: string;
  treatment_plan_id: string;
  visit_number: number;
  visit_date: string;
  doctor_id: string | null;
  receptionist_id: string | null;
  notes: string | null;
  created_at: string;
};

export type TreatmentPlanPayment = {
  id: string;
  treatment_plan_id: string;
  patient_id: string;
  clinic_id: string;
  amount: number;
  payment_method: string;
  receptionist_id: string;
  register_session_id: string | null;
  notes: string | null;
  created_at: string;
};

export type PosHold = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  patient_name: string;
  patient_phone: string | null;
  doctor_id: string | null;
  receptionist_id: string;
  register_session_id: string | null;
  clinic_patient_file_id: string | null;
  patient_file_no: string | null;
  status: 'Waiting' | 'In Treatment' | 'Ready to Pay' | 'Cancelled';
  notes: string | null;
  discount_input: string | null;
  discount_type: 'AED' | '%' | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PosHoldService = {
  id: string;
  hold_id: string;
  service_id: string | null;
  service_name: string;
  price: number;
  original_price: number | null;
  quantity: number;
  teeth: string[];
  created_at: string;
};
