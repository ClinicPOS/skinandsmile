export type BackendNavItem = {
  href: string;
  label: string;
  keywords?: string[];
  group: "core" | "branding" | "security";
};

export const backendNavigation: BackendNavItem[] = [
  { href: "/backend", label: "Overview", keywords: ["home", "dashboard", "summary"], group: "core" },
  { href: "/backend/clinics", label: "Clinics", keywords: ["branches"], group: "core" },
  { href: "/backend/patients", label: "Patients", keywords: ["patient"], group: "core" },
  { href: "/backend/doctors", label: "Doctors / Aestheticians", keywords: ["providers", "aestheticians"], group: "core" },
  { href: "/backend/services", label: "Services", keywords: ["catalog", "pricing"], group: "core" },
  { href: "/backend/receptionists", label: "Receptionists", keywords: ["front desk", "staff"], group: "core" },
  { href: "/backend/treatment-plans", label: "Treatment Plans", keywords: ["plans"], group: "core" },
  { href: "/backend/outstanding-balances", label: "Outstanding Balances", keywords: ["balances", "collections"], group: "core" },
  { href: "/backend/receipt-log", label: "Receipt Log", keywords: ["receipts", "history", "reprint"], group: "core" },
  { href: "/backend/reports", label: "Reports", keywords: ["analytics", "ceo"], group: "core" },
  { href: "/backend/branding", label: "Branding", keywords: ["design", "receipts", "invoice"], group: "branding" },
  { href: "/backend/receipt-branding", label: "Thermal Receipt & Reprint", keywords: ["thermal", "receipt", "reprint"], group: "branding" },
  { href: "/backend/a4-invoice-design", label: "A4 Invoice Design", keywords: ["a4", "invoice", "pdf"], group: "branding" },
  { href: "/backend/access", label: "Access & PINs", keywords: ["sessions", "security", "pins"], group: "security" },
  { href: "/backend/system-settings", label: "System Settings", keywords: ["export", "register", "settings"], group: "security" },
];

export function getBackendPageTitle(pathname: string) {
  const match = backendNavigation.find((item) => item.href === pathname);
  return match?.label || "Backend";
}
