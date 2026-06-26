export type Patient = {
  id: string;
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
};

export type Service = {
  id: string;
  name: string;
  price: number;
};

export type Receptionist = {
  id: string;
  name: string;
  shift: string;
  pin?: string | null;
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
