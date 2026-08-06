import { getInvoiceTheme, type InvoiceTheme } from "./invoice-themes";
import { getReceiptLogoPath } from "./receipt-branding";
import type { Clinic } from "./types";

export const A4_INVOICE_LOGO_BUCKET = "clinic-branding";

export type A4InvoiceLogoAlignment = "left" | "center" | "right";

type A4InvoiceClinic = Partial<Pick<
  Clinic,
  | "name"
  | "logo"
  | "receipt_print_name"
  | "a4_invoice_logo_url"
  | "a4_invoice_logo_width_mm"
  | "a4_invoice_logo_height_mm"
  | "a4_invoice_logo_alignment"
  | "a4_invoice_logo_offset_x_mm"
  | "a4_invoice_logo_offset_y_mm"
  | "a4_invoice_primary_color"
  | "a4_invoice_secondary_color"
  | "a4_invoice_accent_color"
  | "a4_invoice_text_color"
  | "a4_invoice_divider_color"
  | "a4_invoice_slogan"
>> | null | undefined;

export type ResolvedA4InvoiceLogoSettings = {
  widthMm: number;
  heightMm: number;
  alignment: A4InvoiceLogoAlignment;
  offsetXMm: number;
  offsetYMm: number;
};

function parseNullableNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveNumber(value: number | string | null | undefined, fallback: number) {
  const parsed = parseNullableNumber(value);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function parseOffsetNumber(value: number | string | null | undefined) {
  return parseNullableNumber(value) ?? 0;
}

function parseAlignment(value: string | null | undefined): A4InvoiceLogoAlignment {
  return value === "center" || value === "right" ? value : "left";
}

export function getA4InvoiceLogoPath(clinic: A4InvoiceClinic) {
  const configuredLogo = clinic?.a4_invoice_logo_url?.trim();
  if (configuredLogo) return configuredLogo;
  return getReceiptLogoPath(clinic, undefined, "invoice");
}

export function getA4InvoiceTheme(clinic: A4InvoiceClinic): InvoiceTheme {
  const fallbackTheme = getInvoiceTheme(clinic?.logo);

  return {
    ...fallbackTheme,
    primaryColor: clinic?.a4_invoice_primary_color?.trim() || fallbackTheme.primaryColor,
    secondaryColor: clinic?.a4_invoice_secondary_color?.trim() || fallbackTheme.secondaryColor,
    accentColor: clinic?.a4_invoice_accent_color?.trim() || fallbackTheme.accentColor,
    textColor: clinic?.a4_invoice_text_color?.trim() || fallbackTheme.textColor,
    dividerColor: clinic?.a4_invoice_divider_color?.trim() || fallbackTheme.dividerColor,
    tagline: clinic?.a4_invoice_slogan?.trim() || fallbackTheme.tagline,
  };
}

export function getA4InvoiceLogoSettings(clinic: A4InvoiceClinic): ResolvedA4InvoiceLogoSettings {
  return {
    widthMm: parsePositiveNumber(clinic?.a4_invoice_logo_width_mm, 32),
    heightMm: parsePositiveNumber(clinic?.a4_invoice_logo_height_mm, 20),
    alignment: parseAlignment(clinic?.a4_invoice_logo_alignment),
    offsetXMm: parseOffsetNumber(clinic?.a4_invoice_logo_offset_x_mm),
    offsetYMm: parseOffsetNumber(clinic?.a4_invoice_logo_offset_y_mm),
  };
}

export function buildA4InvoiceLogoStoragePath(clinicId: string, fileName: string) {
  const trimmedClinicId = clinicId.trim();
  const safeBaseName = fileName
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "logo";
  const extensionMatch = fileName.toLowerCase().match(/\.([a-z0-9]+)$/i);
  const extension = extensionMatch?.[1] || "png";
  return `a4-invoices/${trimmedClinicId}/${Date.now()}-${safeBaseName}.${extension}`;
}
