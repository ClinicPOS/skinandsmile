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
