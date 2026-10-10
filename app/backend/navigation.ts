export type BackendNavItem = {
  href: string;
  label: string;
  keywords?: string[];
  group: "core" | "branding" | "security";
  ownerOnly?:boolean;
};

export const backendNavigation: BackendNavItem[] = [
  {href:'/backend/managers',label:'Managers & Access',keywords:['owner','permissions'],group:'security',ownerOnly:true},
  {href:'/clinic-admin',label:'Clinic Workspace',keywords:['dashboard'],group:'core',ownerOnly:true},
  { href: "/backend", label: "Overview", keywords: ["home", "dashboard", "summary"], group: "core" },
  { href: "/backend/clinics", label: "Clinics", keywords: ["branches"], group: "core" },
  { href: "/backend/patients", label: "Patients", keywords: ["patient"], group: "core" },
  { href: "/backend/treatment-plans", label: "Treatment Plans", keywords: ["plans"], group: "core" },
  { href: "/backend/outstanding-balances", label: "Outstanding Balances", keywords: ["balances", "collections"], group: "core" },
  { href: "/backend/receipt-log", label: "Receipt Log", keywords: ["receipts", "history", "reprint"], group: "core" },
  { href: "/backend/reports", label: "Reports", keywords: ["analytics", "ceo"], group: "core" },
  { href: "/backend/access", label: "Access & PINs", keywords: ["sessions", "security", "pins"], group: "security" },
  { href: "/backend/activity-log", label: "Activity Log", keywords: ["audit", "history", "changes"], group: "security" },
  { href: "/backend/correction-approvers", label: "Correction Approvers", keywords: ["manager", "approval", "leave", "backup"], group: "security" },
  { href: "/backend/system-settings", label: "System Settings", keywords: ["export", "register", "settings"], group: "security" },
];

export function getBackendPageTitle(pathname: string) {
  const match = backendNavigation.find((item) => item.href === pathname);
  return match?.label || "Backend";
}
