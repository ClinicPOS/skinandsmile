export const MISSING_RECEIPT_CLINIC_MESSAGE = "No active clinic found for this register. Open the register for a clinic before completing checkout.";

export type ReceiptInsertPayloadInput = {
  clinicId: string | null | undefined;
  patientId: string;
  patientFileId?: string | null;
  doctorId?: string | null;
  receptionistId: string;
  subtotal: number;
  vat: number;
  total: number;
  totalBeforeGatewayFee: number;
  gatewayFee?: number | null;
  gatewayFeeProvider?: string | null;
  discountAmount?: number | null;
  birthdayDiscountAmount?: number | null;
  birthdayDiscountApplied?: boolean;
  paymentMethod: string;
  includeAmountPaid: boolean;
  amountPaid: number;
  creditApplied: number;
};

export function requireReceiptClinicId(clinicId: string | null | undefined): string {
  const normalizedClinicId = String(clinicId || "").trim();
  if (!normalizedClinicId) {
    throw new Error(MISSING_RECEIPT_CLINIC_MESSAGE);
  }
  return normalizedClinicId;
}

export function buildReceiptInsertPayload(input: ReceiptInsertPayloadInput) {
  const clinicId = requireReceiptClinicId(input.clinicId);

  return {
    clinic_id: clinicId,
    patient_id: input.patientId,
    patient_file_id: input.patientFileId || null,
    doctor_id: input.doctorId || null,
    receptionist_id: input.receptionistId,
    subtotal: input.subtotal,
    vat: input.vat,
    total: input.total,
    total_before_gateway_fee: input.totalBeforeGatewayFee,
    gateway_fee: input.gatewayFee && input.gatewayFee > 0 ? input.gatewayFee : null,
    gateway_fee_provider: input.gatewayFeeProvider || null,
    discount_amount: input.discountAmount && input.discountAmount > 0 ? input.discountAmount : null,
    birthday_discount_amount: input.birthdayDiscountAmount && input.birthdayDiscountAmount > 0 ? input.birthdayDiscountAmount : null,
    discount_reason: input.birthdayDiscountApplied ? "Birthday Discount 5%" : null,
    notes: null,
    payment_method: input.paymentMethod,
    ...(input.includeAmountPaid ? { amount_paid: input.amountPaid } : {}),
    ...(input.creditApplied > 0.0049 ? { credit_applied: input.creditApplied } : {}),
  };
}
