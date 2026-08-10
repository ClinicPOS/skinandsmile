type NumberLike = number | string | null | undefined;

export type RegularReceiptRenderSourceItem = {
  service_id?: string | null;
  service_name_snapshot?: string | null;
  quantity?: NumberLike;
  price?: NumberLike;
  total?: NumberLike;
  original_price?: NumberLike;
  teeth?: string[] | null;
  allocated_global_discount_amount?: NumberLike;
  taxable_amount?: NumberLike;
  vat_rate?: NumberLike;
  vat_amount?: NumberLike;
  final_line_total?: NumberLike;
};

export type RegularReceiptRenderFallback = {
  serviceName?: string | null;
  fallbackOriginalUnitPrice?: number | null;
};

export type RegularReceiptRenderLine = {
  name: string;
  quantity: number;
  soldUnitPrice: number;
  soldLineTotal: number;
  originalUnitPrice: number | null;
  originalLineTotal: number | null;
  manualDiscountAmount: number;
  allocatedGlobalDiscountAmount: number;
  totalDiscountAmount: number;
  taxableAmount: number | null;
  vatRate: number | null;
  vatAmount: number | null;
  finalLineTotal: number | null;
  isSnapshotBacked: boolean;
  hasTruePromo: boolean;
  hasPriceIncrease: boolean;
  teeth: string[];
};

export type RegularReceiptRenderSummary = {
  subtotal: number;
  discountAmount: number;
  manualDiscountAmount: number;
  globalDiscountAmount: number;
  taxableTotal: number;
  vat: number;
  invoiceTotalBeforeGatewayFee: number;
  paymentFeeAmount: number;
  finalTotal: number;
  useSnapshotSummary: boolean;
};

type RegularReceiptSummarySource = {
  subtotal?: NumberLike;
  discount_amount?: NumberLike;
  vat?: NumberLike;
  total_before_gateway_fee?: NumberLike;
  total?: NumberLike;
  gateway_fee?: NumberLike;
};

function roundMoney(value: NumberLike): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function normalizeVatRate(value: NumberLike): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (numeric === 0) return 0;
  if (numeric === 0.05) return 0.05;
  return null;
}

export function hasCompleteRegularReceiptSnapshot(item: RegularReceiptRenderSourceItem): boolean {
  return item.taxable_amount != null
    && item.vat_rate != null
    && item.vat_amount != null
    && item.final_line_total != null;
}

export function mapRegularReceiptRenderLine(
  item: RegularReceiptRenderSourceItem,
  fallback: RegularReceiptRenderFallback = {}
): RegularReceiptRenderLine {
  const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
  const soldUnitPrice = roundMoney(item.price);
  const soldLineTotal = roundMoney(item.total != null ? item.total : soldUnitPrice * quantity);
  const fallbackOriginalUnitPrice = fallback.fallbackOriginalUnitPrice != null
    ? roundMoney(fallback.fallbackOriginalUnitPrice)
    : null;
  const originalUnitPrice = item.original_price != null
    ? roundMoney(item.original_price)
    : fallbackOriginalUnitPrice;
  const originalLineTotal = originalUnitPrice != null ? roundMoney(originalUnitPrice * quantity) : null;
  const hasTruePromo = originalLineTotal != null && originalLineTotal > soldLineTotal + 0.0049;
  const hasPriceIncrease = originalLineTotal != null && soldLineTotal > originalLineTotal + 0.0049;
  const manualDiscountAmount = hasTruePromo && originalLineTotal != null
    ? roundMoney(originalLineTotal - soldLineTotal)
    : 0;
  const allocatedGlobalDiscountAmount = hasCompleteRegularReceiptSnapshot(item)
    ? roundMoney(item.allocated_global_discount_amount)
    : 0;
  const totalDiscountAmount = roundMoney(manualDiscountAmount + allocatedGlobalDiscountAmount);

  return {
    name: String(item.service_name_snapshot || fallback.serviceName || "Service"),
    quantity,
    soldUnitPrice,
    soldLineTotal,
    originalUnitPrice,
    originalLineTotal,
    manualDiscountAmount,
    allocatedGlobalDiscountAmount,
    totalDiscountAmount,
    taxableAmount: hasCompleteRegularReceiptSnapshot(item) ? roundMoney(item.taxable_amount) : null,
    vatRate: hasCompleteRegularReceiptSnapshot(item) ? normalizeVatRate(item.vat_rate) : null,
    vatAmount: hasCompleteRegularReceiptSnapshot(item) ? roundMoney(item.vat_amount) : null,
    finalLineTotal: hasCompleteRegularReceiptSnapshot(item) ? roundMoney(item.final_line_total) : null,
    isSnapshotBacked: hasCompleteRegularReceiptSnapshot(item),
    hasTruePromo,
    hasPriceIncrease,
    teeth: Array.isArray(item.teeth) ? item.teeth.map(String) : [],
  };
}

export function summarizeRegularReceiptForRender(
  receipt: RegularReceiptSummarySource,
  lines: RegularReceiptRenderLine[]
): RegularReceiptRenderSummary {
  const paymentFeeAmount = roundMoney(receipt.gateway_fee);
  const vat = roundMoney(receipt.vat);
  const useSnapshotSummary = lines.length > 0 && lines.every((line) => line.isSnapshotBacked);

  if (useSnapshotSummary) {
    const subtotal = roundMoney(receipt.subtotal);
    const discountAmount = roundMoney(receipt.discount_amount);
    const manualDiscountAmount = roundMoney(lines.reduce((sum, line) => sum + line.manualDiscountAmount, 0));
    const globalDiscountAmount = roundMoney(lines.reduce((sum, line) => sum + line.allocatedGlobalDiscountAmount, 0));
    const taxableTotal = roundMoney(lines.reduce((sum, line) => sum + Number(line.taxableAmount || 0), 0));
    const invoiceTotalBeforeGatewayFee = receipt.total_before_gateway_fee != null
      ? roundMoney(receipt.total_before_gateway_fee)
      : roundMoney(taxableTotal + vat);
    const finalTotal = receipt.total != null
      ? roundMoney(receipt.total)
      : roundMoney(invoiceTotalBeforeGatewayFee + paymentFeeAmount);

    return {
      subtotal,
      discountAmount,
      manualDiscountAmount,
      globalDiscountAmount,
      taxableTotal,
      vat,
      invoiceTotalBeforeGatewayFee,
      paymentFeeAmount,
      finalTotal,
      useSnapshotSummary: true,
    };
  }

  const subtotal = roundMoney(lines.reduce((sum, line) => {
    if (line.hasTruePromo && line.originalLineTotal != null) {
      return sum + line.originalLineTotal;
    }
    return sum + line.soldLineTotal;
  }, 0));
  const derivedDiscountAmount = roundMoney(lines.reduce((sum, line) => sum + line.manualDiscountAmount, 0));
  const storedDiscountAmount = roundMoney(receipt.discount_amount);
  const discountAmount = storedDiscountAmount > 0.0049 ? storedDiscountAmount : derivedDiscountAmount;
  const taxableTotal = roundMoney(Math.max(0, subtotal - discountAmount));
  const invoiceTotalBeforeGatewayFee = receipt.total_before_gateway_fee != null
    ? roundMoney(receipt.total_before_gateway_fee)
    : roundMoney(taxableTotal + vat);
  const finalTotal = receipt.total != null
    ? roundMoney(receipt.total)
    : roundMoney(invoiceTotalBeforeGatewayFee + paymentFeeAmount);

  return {
    subtotal,
    discountAmount,
    manualDiscountAmount: discountAmount,
    globalDiscountAmount: 0,
    taxableTotal,
    vat,
    invoiceTotalBeforeGatewayFee,
    paymentFeeAmount,
    finalTotal,
    useSnapshotSummary: false,
  };
}
