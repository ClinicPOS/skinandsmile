import type { Clinic } from "./types";

export const THERMAL_PAPER_WIDTH_MM = 80;
export const THERMAL_PRINTABLE_WIDTH_MM = 72;
export const THERMAL_NON_PRINTABLE_GUTTER_MM = 4;

export const THERMAL_LOGO_WIDTH_RANGE_MM = { min: 10, max: THERMAL_PRINTABLE_WIDTH_MM } as const;
export const THERMAL_LOGO_MAX_HEIGHT_RANGE_MM = { min: 10, max: 72 } as const;
export const THERMAL_LOGO_OFFSET_Y_RANGE_MM = { min: -8, max: 16 } as const;
export const THERMAL_FONT_SIZE_RANGE_PX = { min: 9, max: 13 } as const;
export const THERMAL_TEXT_WEIGHT_OPTIONS = [500, 700, 800] as const;

export type ThermalLogoAlignment = "left" | "center" | "right";
export type ThermalTextWeight = (typeof THERMAL_TEXT_WEIGHT_OPTIONS)[number];

export const THERMAL_RECEIPT_DEFAULTS = {
  logoWidthMm: 68,
  logoMaxHeightMm: 36,
  logoAlignment: "center" as ThermalLogoAlignment,
  logoOffsetXMm: 0,
  logoOffsetYMm: 0,
  logoHighContrast: false,
  textWeight: 500 as ThermalTextWeight,
  fontSizePx: 10,
} as const;

type ThermalReceiptClinic = Partial<Pick<
  Clinic,
  | "thermal_logo_width_mm"
  | "thermal_logo_max_height_mm"
  | "thermal_logo_alignment"
  | "thermal_logo_offset_x_mm"
  | "thermal_logo_offset_y_mm"
  | "thermal_logo_high_contrast"
  | "thermal_text_weight"
  | "thermal_font_size_px"
>> | null | undefined;

export type ThermalReceiptBrandingDraft = {
  thermal_logo_width_mm?: string | number | null;
  thermal_logo_max_height_mm?: string | number | null;
  thermal_logo_alignment?: string | null;
  thermal_logo_offset_x_mm?: string | number | null;
  thermal_logo_offset_y_mm?: string | number | null;
  thermal_logo_high_contrast?: boolean | null;
  thermal_text_weight?: string | number | null;
  thermal_font_size_px?: string | number | null;
};

export type ThermalReceiptBrandingPayload = Pick<
  Clinic,
  | "thermal_logo_width_mm"
  | "thermal_logo_max_height_mm"
  | "thermal_logo_alignment"
  | "thermal_logo_offset_x_mm"
  | "thermal_logo_offset_y_mm"
  | "thermal_logo_high_contrast"
  | "thermal_text_weight"
  | "thermal_font_size_px"
>;

export type ResolvedThermalReceiptSettings = {
  paperWidthMm: number;
  printableWidthMm: number;
  nonPrintableGutterMm: number;
  logoWidthMm: number;
  logoMaxHeightMm: number;
  logoAlignment: ThermalLogoAlignment;
  logoOffsetXMm: number;
  logoOffsetYMm: number;
  logoHighContrast: boolean;
  textWeight: ThermalTextWeight;
  fontSizePx: number;
};

export type ThermalReceiptBrandingValidation = {
  settings: ResolvedThermalReceiptSettings;
  payload: ThermalReceiptBrandingPayload;
  errors: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseFiniteNumber(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumericDraft(value: string | number | null | undefined, label: string, errors: string[]) {
  if (value == null || value === "") return null;
  const parsed = parseFiniteNumber(value);
  if (parsed == null) {
    errors.push(`${label} must be a valid number.`);
    return null;
  }
  return parsed;
}

function parseAlignment(value: string | null | undefined): ThermalLogoAlignment {
  return value === "left" || value === "right" ? value : "center";
}

function parseTextWeight(value: string | number | null | undefined): ThermalTextWeight {
  const parsed = parseFiniteNumber(value);
  return parsed === 700 || parsed === 800 ? parsed : 500;
}

function clampHorizontalOffset(alignment: ThermalLogoAlignment, logoWidthMm: number, offsetXMm: number) {
  const availableShift = Math.max(0, THERMAL_PRINTABLE_WIDTH_MM - logoWidthMm);
  if (alignment === "left") {
    return clamp(offsetXMm, 0, availableShift);
  }
  if (alignment === "right") {
    return clamp(offsetXMm, -availableShift, 0);
  }
  return clamp(offsetXMm, -(availableShift / 2), availableShift / 2);
}

function resolvePayload(draft: ThermalReceiptBrandingDraft, errors: string[]): ThermalReceiptBrandingPayload {
  const rawLogoWidth = parseNumericDraft(draft.thermal_logo_width_mm, "Logo width", errors);
  const rawLogoMaxHeight = parseNumericDraft(draft.thermal_logo_max_height_mm, "Logo maximum height", errors);
  const rawLogoOffsetX = parseNumericDraft(draft.thermal_logo_offset_x_mm, "Horizontal offset", errors);
  const rawLogoOffsetY = parseNumericDraft(draft.thermal_logo_offset_y_mm, "Vertical offset", errors);
  const rawFontSize = parseNumericDraft(draft.thermal_font_size_px, "Base text size", errors);
  const rawTextWeight = parseNumericDraft(draft.thermal_text_weight, "Text weight", errors);

  const alignment = parseAlignment(draft.thermal_logo_alignment);
  const logoWidthMm = clamp(
    rawLogoWidth ?? THERMAL_RECEIPT_DEFAULTS.logoWidthMm,
    THERMAL_LOGO_WIDTH_RANGE_MM.min,
    THERMAL_LOGO_WIDTH_RANGE_MM.max
  );
  const logoMaxHeightMm = clamp(
    rawLogoMaxHeight ?? THERMAL_RECEIPT_DEFAULTS.logoMaxHeightMm,
    THERMAL_LOGO_MAX_HEIGHT_RANGE_MM.min,
    THERMAL_LOGO_MAX_HEIGHT_RANGE_MM.max
  );
  const logoOffsetXMm = clampHorizontalOffset(
    alignment,
    logoWidthMm,
    rawLogoOffsetX ?? THERMAL_RECEIPT_DEFAULTS.logoOffsetXMm
  );
  const logoOffsetYMm = clamp(
    rawLogoOffsetY ?? THERMAL_RECEIPT_DEFAULTS.logoOffsetYMm,
    THERMAL_LOGO_OFFSET_Y_RANGE_MM.min,
    THERMAL_LOGO_OFFSET_Y_RANGE_MM.max
  );
  const fontSizePx = clamp(
    rawFontSize ?? THERMAL_RECEIPT_DEFAULTS.fontSizePx,
    THERMAL_FONT_SIZE_RANGE_PX.min,
    THERMAL_FONT_SIZE_RANGE_PX.max
  );
  const textWeight = rawTextWeight == null
    ? THERMAL_RECEIPT_DEFAULTS.textWeight
    : parseTextWeight(rawTextWeight);
  const logoHighContrast = draft.thermal_logo_high_contrast === true;

  return {
    thermal_logo_width_mm: logoWidthMm,
    thermal_logo_max_height_mm: logoMaxHeightMm,
    thermal_logo_alignment: alignment,
    thermal_logo_offset_x_mm: logoOffsetXMm,
    thermal_logo_offset_y_mm: logoOffsetYMm,
    thermal_logo_high_contrast: logoHighContrast,
    thermal_text_weight: textWeight,
    thermal_font_size_px: fontSizePx,
  };
}

export function validateThermalReceiptBrandingDraft(
  draft: ThermalReceiptBrandingDraft | ThermalReceiptClinic
): ThermalReceiptBrandingValidation {
  const errors: string[] = [];
  const payload = resolvePayload(draft || {}, errors);
  return {
    payload,
    errors,
    settings: getThermalReceiptSettings(payload),
  };
}

export function getThermalReceiptSettings(clinic: ThermalReceiptClinic): ResolvedThermalReceiptSettings {
  const validation = resolvePayload(clinic || {}, []);
  return {
    paperWidthMm: THERMAL_PAPER_WIDTH_MM,
    printableWidthMm: THERMAL_PRINTABLE_WIDTH_MM,
    nonPrintableGutterMm: THERMAL_NON_PRINTABLE_GUTTER_MM,
    logoWidthMm: validation.thermal_logo_width_mm ?? THERMAL_RECEIPT_DEFAULTS.logoWidthMm,
    logoMaxHeightMm: validation.thermal_logo_max_height_mm ?? THERMAL_RECEIPT_DEFAULTS.logoMaxHeightMm,
    logoAlignment: (validation.thermal_logo_alignment as ThermalLogoAlignment | null) ?? THERMAL_RECEIPT_DEFAULTS.logoAlignment,
    logoOffsetXMm: validation.thermal_logo_offset_x_mm ?? THERMAL_RECEIPT_DEFAULTS.logoOffsetXMm,
    logoOffsetYMm: validation.thermal_logo_offset_y_mm ?? THERMAL_RECEIPT_DEFAULTS.logoOffsetYMm,
    logoHighContrast: validation.thermal_logo_high_contrast ?? THERMAL_RECEIPT_DEFAULTS.logoHighContrast,
    textWeight: (validation.thermal_text_weight as ThermalTextWeight | null) ?? THERMAL_RECEIPT_DEFAULTS.textWeight,
    fontSizePx: validation.thermal_font_size_px ?? THERMAL_RECEIPT_DEFAULTS.fontSizePx,
  };
}

function logoJustifyContent(alignment: ThermalLogoAlignment) {
  if (alignment === "left") return "flex-start";
  if (alignment === "right") return "flex-end";
  return "center";
}

function logoTransformOrigin(alignment: ThermalLogoAlignment) {
  if (alignment === "left") return "top left";
  if (alignment === "right") return "top right";
  return "top center";
}

export function getThermalLogoFilter(settings: ResolvedThermalReceiptSettings) {
  return settings.logoHighContrast
    ? "grayscale(1) contrast(1.35) brightness(0.88)"
    : "none";
}

export function buildThermalReceiptCss(settings: ResolvedThermalReceiptSettings) {
  return `
    * { box-sizing: border-box; }
    @page { size: 80mm auto; margin: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      width: ${THERMAL_PRINTABLE_WIDTH_MM}mm;
      margin: 0;
      padding: 2mm;
      font-size: ${settings.fontSizePx}px;
      line-height: 1.25;
      color: #000;
      background: #fff;
      overflow-x: hidden;
      -webkit-text-size-adjust: 100%;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-weight: ${settings.textWeight};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .logo-wrap {
      display: flex;
      justify-content: ${logoJustifyContent(settings.logoAlignment)};
      width: 100%;
      margin: 0 0 4px;
      overflow: hidden;
    }
    .logo {
      display: block;
      width: ${settings.logoWidthMm}mm;
      max-width: 100%;
      max-height: ${settings.logoMaxHeightMm}mm;
      height: auto;
      object-fit: contain;
      transform: translate(${settings.logoOffsetXMm}mm, ${settings.logoOffsetYMm}mm);
      transform-origin: ${logoTransformOrigin(settings.logoAlignment)};
      filter: ${getThermalLogoFilter(settings)};
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    .center { text-align: center; }
    .hr { border-top: 1px dashed #000; margin: 5px 0; }
    .double {
      border-top: 2px solid #000;
      border-bottom: 2px solid #000;
      padding: 3px 0;
      margin: 5px 0;
      text-align: center;
      font-weight: 700;
    }
    .clinic-name { text-align: center; font-size: 14px; font-weight: 700; line-height: 1.1; }
    .address { text-align: center; font-size: 9px; line-height: 1.25; margin-top: 4px; }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
      margin: 1px 0;
    }
    .row span:first-child { min-width: 30mm; }
    .row span:last-child {
      text-align: right;
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .head-row { display: flex; justify-content: space-between; font-weight: 700; }
    .footer-center { text-align: center; margin-top: 4px; }
    @media print {
      @page { size: 80mm auto; margin: 0; }
      body { width: ${THERMAL_PRINTABLE_WIDTH_MM}mm; padding: 2mm; }
      * { color: #000 !important; border-color: #000 !important; background-color: #fff !important; }
    }
  `;
}

export function buildThermalLogoHtml(logoPath: string, alt: string, wrapId = "logo-wrap") {
  return `
    <div class="logo-wrap" id="${wrapId}">
      <img class="logo" src="${logoPath}" alt="${alt}" loading="eager" decoding="async" onerror="document.getElementById('${wrapId}').style.display='none'" />
    </div>
  `;
}
