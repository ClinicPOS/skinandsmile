export type Clinic = {
  id: string;
  name: string;
  room: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
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
  price: number;
  clinic_id?: string | null;
  category?: string | null;
  requires_quantity?: boolean;
  billing_unit?: string | null;
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
