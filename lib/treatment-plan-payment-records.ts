import { PaymentAllocationComputed, paymentSummaryLabel, paymentVariantLabel } from "./payment-allocation";

type BuildTreatmentPlanPaymentRecordArgs = {
  treatmentPlanId: string;
  patientId: string;
  clinicId: string;
  receptionistId: string;
  registerSessionId?: string | null;
  paymentNotePrefix: string;
  allocations: PaymentAllocationComputed[];
};

export function buildTreatmentPlanPaymentMethodLabel(allocation: PaymentAllocationComputed): string {
  const methodName = paymentVariantLabel(allocation.methodVariant);
  const networkLabel = allocation.methodVariant === "card" && allocation.cardNetwork
    ? ` (${allocation.cardNetwork})`
    : "";
  const refLabel = allocation.providerReferenceNumber ? ` (Ref: ${allocation.providerReferenceNumber})` : "";
  return `${methodName}${networkLabel}${refLabel}`;
}

export function buildTreatmentPlanPaymentNote(paymentNotePrefix: string, allocation: PaymentAllocationComputed): string {
  return [
    paymentNotePrefix,
    `Invoice settled AED ${allocation.invoiceAllocationAmount.toFixed(2)}`,
    `Fee AED ${allocation.feeAmount.toFixed(2)} @ ${(allocation.feeRate * 100).toFixed(1)}%`,
    `Customer charged AED ${allocation.customerChargedAmount.toFixed(2)}`,
  ].join(" | ");
}

export function buildLegacyTreatmentPlanPaymentRows(args: BuildTreatmentPlanPaymentRecordArgs) {
  const { treatmentPlanId, patientId, clinicId, receptionistId, registerSessionId, paymentNotePrefix, allocations } = args;
  return allocations.map((allocation) => ({
    treatment_plan_id: treatmentPlanId,
    patient_id: patientId,
    clinic_id: clinicId,
    amount: allocation.invoiceAllocationAmount,
    payment_method: buildTreatmentPlanPaymentMethodLabel(allocation),
    receptionist_id: receptionistId,
    register_session_id: registerSessionId || null,
    notes: buildTreatmentPlanPaymentNote(paymentNotePrefix, allocation),
  }));
}

export function buildTreatmentPlanPaymentRpcArgs(args: BuildTreatmentPlanPaymentRecordArgs) {
  const { treatmentPlanId, patientId, clinicId, receptionistId, registerSessionId, paymentNotePrefix, allocations } = args;
  return {
    p_treatment_plan_id: treatmentPlanId,
    p_patient_id: patientId,
    p_clinic_id: clinicId,
    p_receptionist_id: receptionistId,
    p_total_invoice_amount_settled: allocations.reduce((sum, allocation) => sum + allocation.invoiceAllocationAmount, 0),
    p_total_vat_amount: allocations.reduce((sum, allocation) => sum + allocation.vatAmount, 0),
    p_total_payment_fee_amount: allocations.reduce((sum, allocation) => sum + allocation.feeAmount, 0),
    p_total_customer_charged_amount: allocations.reduce((sum, allocation) => sum + allocation.customerChargedAmount, 0),
    p_payment_method_summary: paymentSummaryLabel(allocations, { includeAmounts: true, includeReferences: true }),
    p_is_split: allocations.length > 1,
    p_status: "completed",
    p_allocations: allocations.map((allocation) => ({
      method_group: allocation.methodGroup,
      method_variant: allocation.methodVariant,
      treatment_net_amount: allocation.treatmentNetAmount,
      vat_amount: allocation.vatAmount,
      invoice_allocation_amount: allocation.invoiceAllocationAmount,
      fee_rate: allocation.feeRate,
      fee_amount: allocation.feeAmount,
      customer_charged_amount: allocation.customerChargedAmount,
      provider_reference_number: allocation.providerReferenceNumber,
      terminal_authorization_code: allocation.terminalAuthorizationCode,
      card_network: allocation.cardNetwork,
      status: "completed",
    })),
    p_register_session_id: registerSessionId || null,
    p_created_by: receptionistId,
    p_payment_note_prefix: paymentNotePrefix,
  };
}
