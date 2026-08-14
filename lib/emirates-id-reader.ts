"use client";

import { normalizePatientPhone } from "./patient-registration";

const EID_EVENT_NAME = "EID_EVENT";
const EID_RESPONSE_CLASS = "simulateEidResponse";

export const EID_READER_TIMEOUT_MS = 10000;

export type EmiratesIdReaderFieldKey =
  | "name"
  | "emiratesId"
  | "dateOfBirth"
  | "sex"
  | "nationality"
  | "phone"
  | "email"
  | "passportNumber"
  | "address";

export type EmiratesIdReaderFields = Partial<Record<EmiratesIdReaderFieldKey, string>>;

export type EmiratesIdReadResult = {
  fields: EmiratesIdReaderFields;
  photoDataUrl: string | null;
};

type EmiratesIdReaderPayload = {
  HasData?: boolean | string | null;
  Error?: string | null;
  IdNumber?: string | null;
  Photo?: string | null;
  nonModifiablePublicData?: {
    FullNameEnglish?: string | null;
    DateOfBirth?: string | null;
    Gender?: string | null;
    NationalityEnglish?: string | null;
  } | null;
  modifiablePublicData?: {
    PassportNumber?: string | null;
  } | null;
  homeAddress?: {
    MobilePhoneNumber?: string | null;
    Email?: string | null;
    FlatNumber?: string | null;
    BuildingNameEnglish?: string | null;
    StreetEnglish?: string | null;
    AreaEnglish?: string | null;
    CityEnglish?: string | null;
    EmirateEnglish?: string | null;
  } | null;
  workAddress?: {
    MobilePhoneNumber?: string | null;
    Email?: string | null;
  } | null;
};

type EmiratesIdReaderErrorCode = "timeout" | "no_data" | "reader_error" | "parse_error" | "empty_response" | "unavailable";

type EmiratesIdReaderError = Error & {
  code: EmiratesIdReaderErrorCode;
};

const FIELD_LABELS: Record<EmiratesIdReaderFieldKey, string> = {
  name: "Name",
  emiratesId: "Emirates ID",
  dateOfBirth: "Date of Birth",
  sex: "Sex",
  nationality: "Nationality",
  phone: "Phone",
  email: "Email",
  passportNumber: "Passport Number",
  address: "Address",
};

function createReaderError(code: EmiratesIdReaderErrorCode, message: string): EmiratesIdReaderError {
  const error = new Error(message) as EmiratesIdReaderError;
  error.code = code;
  return error;
}

function isFilled(value: string | null | undefined) {
  return String(value || "").trim().length > 0;
}

function ensureSingleResponseReceiver() {
  if (typeof document === "undefined") {
    throw createReaderError("unavailable", "Reader DOM is not available.");
  }

  const receivers = Array.from(document.querySelectorAll<HTMLElement>(`.${EID_RESPONSE_CLASS}`));
  const receiver = receivers[0] || document.createElement("button");

  if (receivers.length === 0) {
    receiver.className = EID_RESPONSE_CLASS;
    receiver.setAttribute("type", "button");
    receiver.hidden = true;
    receiver.style.display = "none";
    receiver.setAttribute("aria-hidden", "true");
    document.body.appendChild(receiver);
  }

  receiver.hidden = true;
  receiver.style.display = "none";
  receiver.textContent = "";
  receiver.setAttribute("aria-hidden", "true");
  if (receiver.tagName.toLowerCase() === "button") {
    receiver.setAttribute("type", "button");
  }

  for (const extraReceiver of receivers.slice(1)) {
    extraReceiver.remove();
  }

  return receiver;
}

function normalizeDateOfBirth(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const slashMatch = trimmed.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month}-${day}`;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return "";
}

function normalizeSex(value: string | null | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "male" || normalized === "m") return "Male";
  if (normalized === "female" || normalized === "f") return "Female";
  return "";
}

function formatEmiratesId(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 15) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 14)}-${digits.slice(14)}`;
  }
  return String(value || "").trim();
}

function normalizePhotoDataUrl(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  const compact = trimmed.replace(/\s+/g, "");
  return compact ? `data:image/jpeg;base64,${compact}` : null;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function buildAddress(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
}

function normalizeReaderPayload(payload: EmiratesIdReaderPayload): EmiratesIdReadResult {
  const errorMessage = String(payload.Error || "").trim();
  if (errorMessage) {
    throw createReaderError("reader_error", "Reader returned an error.");
  }

  const hasDataValue = typeof payload.HasData === "string"
    ? payload.HasData.trim().toLowerCase()
    : payload.HasData;
  if (hasDataValue === false || hasDataValue === "false") {
    throw createReaderError("no_data", "No card data was returned.");
  }

  const fields: EmiratesIdReaderFields = {};
  const fullName = String(payload.nonModifiablePublicData?.FullNameEnglish || "").trim();
  const emiratesId = formatEmiratesId(payload.IdNumber);
  const dateOfBirth = normalizeDateOfBirth(payload.nonModifiablePublicData?.DateOfBirth);
  const sex = normalizeSex(payload.nonModifiablePublicData?.Gender);
  const nationality = String(payload.nonModifiablePublicData?.NationalityEnglish || "").trim();
  const phone = normalizePatientPhone(firstNonEmpty(
    payload.homeAddress?.MobilePhoneNumber,
    payload.workAddress?.MobilePhoneNumber
  ));
  const email = firstNonEmpty(payload.homeAddress?.Email, payload.workAddress?.Email);
  const passportNumber = String(payload.modifiablePublicData?.PassportNumber || "").trim();
  const address = buildAddress([
    payload.homeAddress?.FlatNumber,
    payload.homeAddress?.BuildingNameEnglish,
    payload.homeAddress?.StreetEnglish,
    payload.homeAddress?.AreaEnglish,
    payload.homeAddress?.CityEnglish,
    payload.homeAddress?.EmirateEnglish,
  ]);

  if (fullName) fields.name = fullName;
  if (emiratesId) fields.emiratesId = emiratesId;
  if (dateOfBirth) fields.dateOfBirth = dateOfBirth;
  if (sex) fields.sex = sex;
  if (nationality) fields.nationality = nationality;
  if (phone) fields.phone = phone;
  if (email) fields.email = email;
  if (passportNumber) fields.passportNumber = passportNumber;
  if (address) fields.address = address;

  return {
    fields,
    photoDataUrl: normalizePhotoDataUrl(payload.Photo),
  };
}

async function readRawEmiratesIdPayload(timeoutMs = EID_READER_TIMEOUT_MS): Promise<EmiratesIdReaderPayload> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw createReaderError("unavailable", "Reader is unavailable.");
  }

  const receiver = ensureSingleResponseReceiver();

  return await new Promise<EmiratesIdReaderPayload>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timerId);
      receiver.removeEventListener("click", handleClick);
      receiver.textContent = "";
    };

    const fail = (error: EmiratesIdReaderError) => {
      cleanup();
      reject(error);
    };

    const handleClick = () => {
      const rawText = String(receiver.textContent || "").trim();
      receiver.textContent = "";
      if (!rawText) {
        fail(createReaderError("empty_response", "Reader returned an empty response."));
        return;
      }

      try {
        const payload = JSON.parse(rawText) as EmiratesIdReaderPayload;
        cleanup();
        resolve(payload);
      } catch {
        fail(createReaderError("parse_error", "Reader response could not be parsed."));
      }
    };

    const timerId = window.setTimeout(() => {
      fail(createReaderError("timeout", "Timed out waiting for Emirates ID reader response."));
    }, timeoutMs);

    receiver.addEventListener("click", handleClick);
    receiver.textContent = "";

    try {
      document.dispatchEvent(new CustomEvent(EID_EVENT_NAME));
    } catch {
      fail(createReaderError("unavailable", "Could not dispatch Emirates ID reader event."));
    }
  });
}

export function mergeReaderPatientFields(
  current: EmiratesIdReaderFields,
  incoming: EmiratesIdReaderFields
) {
  const updates: EmiratesIdReaderFields = {};
  const skippedFields: string[] = [];

  (Object.keys(FIELD_LABELS) as EmiratesIdReaderFieldKey[]).forEach((field) => {
    const nextValue = String(incoming[field] || "").trim();
    if (!nextValue) return;

    const currentValue = String(current[field] || "").trim();
    if (!isFilled(currentValue)) {
      updates[field] = nextValue;
      return;
    }

    if (currentValue !== nextValue) {
      skippedFields.push(FIELD_LABELS[field]);
    }
  });

  return { updates, skippedFields };
}

export function getEmiratesIdReaderMessage(error: unknown) {
  const code = (error as { code?: EmiratesIdReaderErrorCode } | null)?.code;
  if (code === "timeout" || code === "unavailable") return "Reader extension or native app is unavailable.";
  if (code === "no_data" || code === "reader_error") return "No card detected or no data was returned.";
  return "Unable to read clipboard/card response.";
}

export async function readEmiratesIdCard(timeoutMs = EID_READER_TIMEOUT_MS): Promise<EmiratesIdReadResult> {
  const payload = await readRawEmiratesIdPayload(timeoutMs);
  return normalizeReaderPayload(payload);
}
