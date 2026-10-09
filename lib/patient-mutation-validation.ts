export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PATIENT_EDITABLE_FIELDS = [
  "name",
  "phone",
  "email",
  "nationality",
  "emirates_id",
  "passport_number",
  "address",
  "notes",
  "date_of_birth",
  "sex",
  "mrn",
] as const;

export type PatientEditableField = (typeof PATIENT_EDITABLE_FIELDS)[number];
export type PatientUpdatePayload = Partial<Record<PatientEditableField, string | null>>;

const PATIENT_EDITABLE_FIELD_SET = new Set<string>(PATIENT_EDITABLE_FIELDS);
const MAX_FIELD_LENGTHS: Record<PatientEditableField, number> = {
  name: 200,
  phone: 50,
  email: 320,
  nationality: 100,
  emirates_id: 100,
  passport_number: 100,
  address: 500,
  notes: 5000,
  date_of_birth: 10,
  sex: 50,
  mrn: 100,
};

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export const PATIENT_REGISTRATION_FIELDS = [
  "clinicId",
  "fullName",
  "mobile",
  "email",
  "dateOfBirth",
  "sex",
  "nationality",
  "emiratesId",
  "passportNumber",
  "mrn",
  "address",
  "notes",
  "fileNo",
  "clinicFileClinicalNotes",
] as const;

export type PatientRegistrationPayload = {
  clinicId: string;
  fullName: string;
  mobile: string;
  email: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  nationality: string | null;
  emiratesId: string | null;
  passportNumber: string | null;
  mrn: string | null;
  address: string | null;
  notes: string | null;
  fileNo: string | null;
  clinicFileClinicalNotes: string | null;
};

const PATIENT_REGISTRATION_FIELD_SET = new Set<string>(PATIENT_REGISTRATION_FIELDS);

export function validatePatientRegistration(value: unknown): { value?: PatientRegistrationPayload; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Patient registration details are required." };
  }
  const body = value as Record<string, unknown>;
  const unexpected = Object.keys(body).find((key) => !PATIENT_REGISTRATION_FIELD_SET.has(key));
  if (unexpected) return { error: `Field '${unexpected}' is not allowed.` };
  if (!isUuid(body.clinicId)) return { error: "A valid clinic ID is required." };

  const text = (field: string, maxLength: number, required = false): string | null | undefined => {
    const raw = body[field];
    if (raw == null || raw === "") return required ? undefined : null;
    if (typeof raw !== "string") return undefined;
    const normalized = raw.trim();
    if ((required && !normalized) || normalized.length > maxLength) return undefined;
    return normalized || null;
  };

  const fullName = text("fullName", 200, true);
  const mobileValue = text("mobile", 50);
  if (mobileValue === undefined) return { error: "Patient phone is invalid or too long." };
  const mobile = mobileValue ?? "";
  if (!fullName) return { error: "Patient name is required." };
  if (typeof body.mobile !== "undefined" && body.mobile !== null && typeof body.mobile !== "string") {
    return { error: "Patient phone must be text." };
  }

  const fields = {
    email: text("email", 320),
    dateOfBirth: text("dateOfBirth", 10),
    sex: text("sex", 50),
    nationality: text("nationality", 100),
    emiratesId: text("emiratesId", 100),
    passportNumber: text("passportNumber", 100),
    mrn: text("mrn", 100),
    address: text("address", 500),
    notes: text("notes", 5000),
    fileNo: text("fileNo", 100),
    clinicFileClinicalNotes: text("clinicFileClinicalNotes", 5000),
  };
  for (const [field, normalized] of Object.entries(fields)) {
    const raw = body[field];
    if (raw != null && raw !== "" && normalized === undefined) {
      return { error: `Field '${field}' is invalid or too long.` };
    }
  }
  if (fields.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth)) {
    return { error: "Date of birth must use YYYY-MM-DD format." };
  }

  return {
    value: {
      clinicId: String(body.clinicId),
      fullName,
      mobile,
      email: fields.email ?? null,
      dateOfBirth: fields.dateOfBirth ?? null,
      sex: fields.sex ?? null,
      nationality: fields.nationality ?? null,
      emiratesId: fields.emiratesId ?? null,
      passportNumber: fields.passportNumber ?? null,
      mrn: fields.mrn ?? null,
      address: fields.address ?? null,
      notes: fields.notes ?? null,
      fileNo: fields.fileNo ?? null,
      clinicFileClinicalNotes: fields.clinicFileClinicalNotes ?? null,
    },
  };
}

export function validateNoteText(value: unknown): { value?: string; error?: string } {
  if (typeof value !== "string") return { error: "Note text is required." };
  const note = value.trim();
  if (!note) return { error: "Note text is required." };
  if (note.length > 5000) return { error: "Note text is too long." };
  return { value: note };
}

export function validatePatientUpdates(value: unknown): { value?: PatientUpdatePayload; error?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Patient updates are required." };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return { error: "At least one patient field is required." };
  const unexpected = entries.find(([key]) => !PATIENT_EDITABLE_FIELD_SET.has(key));
  if (unexpected) return { error: `Field '${unexpected[0]}' cannot be updated.` };

  const updates: PatientUpdatePayload = {};
  for (const [key, rawValue] of entries) {
    const field = key as PatientEditableField;
    if (rawValue !== null && typeof rawValue !== "string") {
      return { error: `Field '${field}' must be text or null.` };
    }
    const normalized = typeof rawValue === "string" ? rawValue.trim() : null;
    if (normalized != null && normalized.length > MAX_FIELD_LENGTHS[field]) {
      return { error: `Field '${field}' is too long.` };
    }
    if (field === "name" && !normalized) return { error: "Patient name cannot be empty." };
    if (field === "phone" && rawValue === null) return { error: "Patient phone cannot be null." };
    if (field === "date_of_birth" && normalized && !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return { error: "Date of birth must use YYYY-MM-DD format." };
    }
    updates[field] = normalized;
  }

  return { value: updates };
}

export function sessionCanAccessClinic(
  session: { sessionMode: string; clinicId: string | null } | null,
  clinicId: string | null
): boolean {
  if (!session) return false;
  if (session.sessionMode !== "clinic") return session.sessionMode === "manager";
  return !!clinicId && session.clinicId === clinicId;
}
