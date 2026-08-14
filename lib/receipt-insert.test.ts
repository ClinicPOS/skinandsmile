import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReceiptInsertPayload,
  MISSING_RECEIPT_CLINIC_MESSAGE,
} from "./receipt-insert.ts";

test("buildReceiptInsertPayload stores the active clinic UUID on every new receipt", () => {
  const payload = buildReceiptInsertPayload({
    clinicId: "clinic-uuid-123",
    patientId: "patient-1",
    patientFileId: "file-1",
    doctorId: "doctor-1",
    receptionistId: "receptionist-1",
    subtotal: 100,
    vat: 5,
    total: 105,
    totalBeforeGatewayFee: 105,
    gatewayFee: null,
    gatewayFeeProvider: null,
    discountAmount: 0,
    birthdayDiscountAmount: 0,
    birthdayDiscountApplied: false,
    paymentMethod: "Cash",
    includeAmountPaid: false,
    amountPaid: 0,
    creditApplied: 0,
  });

  assert.equal(payload.clinic_id, "clinic-uuid-123");
  assert.equal(payload.patient_id, "patient-1");
  assert.equal(payload.payment_method, "Cash");
  assert.equal(payload.total_before_gateway_fee, 105);
  assert.ok(!("amount_paid" in payload));
  assert.ok(!("credit_applied" in payload));
});

test("buildReceiptInsertPayload keeps partial-payment and credit fields when checkout needs them", () => {
  const payload = buildReceiptInsertPayload({
    clinicId: "clinic-uuid-456",
    patientId: "patient-2",
    patientFileId: null,
    doctorId: null,
    receptionistId: "receptionist-2",
    subtotal: 200,
    vat: 10,
    total: 220,
    totalBeforeGatewayFee: 210,
    gatewayFee: 10,
    gatewayFeeProvider: "Tabby",
    discountAmount: 15,
    birthdayDiscountAmount: 5,
    birthdayDiscountApplied: true,
    paymentMethod: "Split Payment",
    includeAmountPaid: true,
    amountPaid: 120,
    creditApplied: 25,
  });

  assert.equal(payload.clinic_id, "clinic-uuid-456");
  assert.equal(payload.amount_paid, 120);
  assert.equal(payload.credit_applied, 25);
  assert.equal(payload.gateway_fee, 10);
  assert.equal(payload.gateway_fee_provider, "Tabby");
  assert.equal(payload.discount_amount, 15);
  assert.equal(payload.birthday_discount_amount, 5);
  assert.equal(payload.discount_reason, "Birthday Discount 5%");
});

test("buildReceiptInsertPayload fails when checkout has no clinic context", () => {
  assert.throws(
    () =>
      buildReceiptInsertPayload({
        clinicId: "",
        patientId: "patient-3",
        patientFileId: null,
        doctorId: null,
        receptionistId: "receptionist-3",
        subtotal: 50,
        vat: 2.5,
        total: 52.5,
        totalBeforeGatewayFee: 52.5,
        gatewayFee: null,
        gatewayFeeProvider: null,
        discountAmount: 0,
        birthdayDiscountAmount: 0,
        birthdayDiscountApplied: false,
        paymentMethod: "Card",
        includeAmountPaid: false,
        amountPaid: 0,
        creditApplied: 0,
      }),
    new Error(MISSING_RECEIPT_CLINIC_MESSAGE)
  );
});
