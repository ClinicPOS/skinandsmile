/**
 * Per-clinic invoice brand themes.
 * Keyed by the `clinic.logo` field value so no DB migration is required.
 * The fallback theme is used when a clinic logo key is not found.
 */
export interface InvoiceTheme {
  /** Thin divider line and section heading accent */
  primaryColor: string;
  /** Table header background, status badge background */
  secondaryColor: string;
  /** Link/icon accent used sparingly */
  accentColor: string;
  /** Body text colour */
  textColor: string;
  /** Thin horizontal divider line colour */
  dividerColor: string;
  /** Short clinic tagline displayed under the clinic name in the header */
  tagline: string;
  /** Optional branch label shown under the legal clinic name */
  branchLabel?: string;
  /** Human-readable invoice font colour override for the header right block (defaults to primaryColor) */
  titleColor?: string;
}

const THEMES: Record<string, InvoiceTheme> = {
  // ── Skin and Smile Dental (Al Satwa) ──────────────────────────────────────
  "dental": {
    primaryColor:   "#A87925",
    secondaryColor: "#202020",
    accentColor:    "#D4AF37",
    textColor:      "#1A1A1A",
    dividerColor:   "#E5D4AB",
    tagline:        "Healthy Smiles, Confident Lives",
  },
  // Also cover the legacy logo key used by existing clinic records
  "skin-smile": {
    primaryColor:   "#A87925",
    secondaryColor: "#202020",
    accentColor:    "#D4AF37",
    textColor:      "#1A1A1A",
    dividerColor:   "#E5D4AB",
    tagline:        "Healthy Smiles, Confident Lives",
  },
  "skin-smile-alt": {
    primaryColor:   "#A87925",
    secondaryColor: "#202020",
    accentColor:    "#D4AF37",
    textColor:      "#1A1A1A",
    dividerColor:   "#E5D4AB",
    tagline:        "Healthy Smiles, Confident Lives",
  },

  // ── Skin and Smile Dental (Al Dana Branch) ────────────────────────────────
  "al-dana": {
    primaryColor:   "#A87925",
    secondaryColor: "#202020",
    accentColor:    "#D4AF37",
    textColor:      "#1A1A1A",
    dividerColor:   "#E5D4AB",
    tagline:        "Healthy Smiles, Confident Lives",
    branchLabel:    "Al Dana Branch",
  },

  // ── Skin and Smile Aesthetic Clinic ──────────────────────────────────────
  "aesthetic": {
    primaryColor:   "#9A6A20",
    secondaryColor: "#8A7964",
    accentColor:    "#C9A35E",
    textColor:      "#25221E",
    dividerColor:   "#E8D8B6",
    tagline:        "Natural Beauty, Refined",
  },

  // ── Al Jameelah Clinic ───────────────────────────────────────────────────
  "al-jameelah": {
    primaryColor:   "#6F9291",
    secondaryColor: "#293B3B",
    accentColor:    "#C9A35E",
    textColor:      "#293B3B",
    dividerColor:   "#E8DED0",
    tagline:        "Caring for Every Smile, Every Generation",
  },
  "al-jameelah-new": {
    primaryColor:   "#6F9291",
    secondaryColor: "#293B3B",
    accentColor:    "#C9A35E",
    textColor:      "#293B3B",
    dividerColor:   "#E8DED0",
    tagline:        "Caring for Every Smile, Every Generation",
  },

  // ── Altamuze Medical Center ──────────────────────────────────────────────
  "altamuze": {
    primaryColor:   "#087A35",
    secondaryColor: "#EF3340",
    accentColor:    "#EF6680",
    textColor:      "#222222",
    dividerColor:   "#DCE9DF",
    tagline:        "Compassionate Care for Every Family",
  },
  "altamuze-new": {
    primaryColor:   "#087A35",
    secondaryColor: "#EF3340",
    accentColor:    "#EF6680",
    textColor:      "#222222",
    dividerColor:   "#DCE9DF",
    tagline:        "Compassionate Care for Every Family",
  },
  "altamuze-compact": {
    primaryColor:   "#087A35",
    secondaryColor: "#EF3340",
    accentColor:    "#EF6680",
    textColor:      "#222222",
    dividerColor:   "#DCE9DF",
    tagline:        "Compassionate Care for Every Family",
  },
};

/** Default/fallback theme — neutral professional gold */
export const DEFAULT_INVOICE_THEME: InvoiceTheme = {
  primaryColor:   "#A87925",
  secondaryColor: "#202020",
  accentColor:    "#D4AF37",
  textColor:      "#1A1A1A",
  dividerColor:   "#E5D4AB",
  tagline:        "",
};

/**
 * Returns the brand theme for a clinic based on its `logo` field value.
 * Falls back to the default theme if the key is not found.
 */
export function getInvoiceTheme(logoKey: string | null | undefined): InvoiceTheme {
  if (logoKey) {
    const theme = THEMES[logoKey.trim()];
    if (theme) return theme;
  }
  return DEFAULT_INVOICE_THEME;
}
