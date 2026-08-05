import qrcode from "qrcode-generator";
import type { Clinic } from "./types";

export type ReceiptLogoVariant = "invoice" | "thermal";

type ReceiptLogoOption = {
  value: string;
  label: string;
  path: string;
  thermalPath?: string;
};

export const receiptLogoOptions: ReceiptLogoOption[] = [
  { value: "skin-smile", label: "Skin and Smile default", path: "/images/logo6.jpg", thermalPath: "/images/Alsatwathermal.png" },
  { value: "skin-smile-alt", label: "Skin and Smile alternate", path: "/images/dental.png", thermalPath: "/images/Alsatwathermal.png" },
  { value: "dental", label: "Skin and Smile Dental", path: "/images/dental.png", thermalPath: "/images/Alsatwathermal.png" },
  { value: "aesthetic", label: "Skin and Smile Aesthetic", path: "/images/invoiceskinandsmile-aesthetic.png", thermalPath: "/images/aesthetic.png" },
  { value: "al-dana", label: "Skin and Smile Dental (Al Dana)", path: "/images/aldana.png", thermalPath: "/images/aldanathermal.PNG" },
  { value: "altamuze", label: "Al Tamuze", path: "/images/altamuze.png", thermalPath: "/images/altamuzethermal.jpg" },
  { value: "altamuze-compact", label: "Al Tamuze compact", path: "/images/logo4.png", thermalPath: "/images/altamuzethermal.jpg" },
  { value: "altamuze-new", label: "Altamuze Medical Center", path: "/images/altamuze.png", thermalPath: "/images/altamuzethermal.jpg" },
  { value: "logo", label: "Logo 1", path: "/images/logo.png", thermalPath: "/images/Alsatwathermal.png" },
  { value: "logo2", label: "Logo 2", path: "/images/logo2.png", thermalPath: "/images/Alsatwathermal.png" },
  { value: "logo3", label: "Logo 3", path: "/images/logo3.png", thermalPath: "/images/Alsatwathermal.png" },
  { value: "al-jameelah", label: "Al Jameelah Clinic", path: "/images/aljameelah.png", thermalPath: "/images/Jameelahthermal.png" },
  { value: "al-jameelah-new", label: "Al Jameelah Clinic (new)", path: "/images/aljameelah.png", thermalPath: "/images/Jameelahthermal.png" },
] as const;

function normalizeClinicName(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getReceiptLogoPath(
  clinic: Partial<Pick<Clinic, "logo" | "name" | "receipt_print_name">> | null | undefined,
  fallbackPath?: string,
  variant: ReceiptLogoVariant = "invoice",
) {
  const clinicName = [clinic?.name, clinic?.receipt_print_name].find(Boolean)?.toString().trim();
  const logo = clinic?.logo?.trim();
  const resolvedFallbackPath = fallbackPath ?? (variant === "thermal" ? "/images/Alsatwathermal.png" : "/images/logo6.jpg");

  if (logo) {
    const option = receiptLogoOptions.find((item) => item.value === logo);
    const selectedPath = variant === "thermal"
      ? option?.thermalPath ?? option?.path
      : option?.path;

    if (selectedPath) return `${selectedPath}?v=20260805-transparent`;

    if (logo.startsWith("/")) return `${logo}?v=20260805-transparent`;
    if (/^https?:\/\//i.test(logo) || logo.startsWith("data:")) return logo;
  }

  const normalizedName = normalizeClinicName(clinicName);
  if (variant === "thermal") {
    if (normalizedName.includes("al dana") || normalizedName.includes("dana")) {
      return "/images/aldanathermal.PNG?v=20260805-transparent";
    }
    if (normalizedName.includes("al satwa") || normalizedName.includes("satwa")) {
      return "/images/Alsatwathermal.png?v=20260805-transparent";
    }
    if (normalizedName.includes("aesthetic") || normalizedName.includes("aesthetics")) {
      return "/images/aesthetic.png?v=20260805-transparent";
    }
    if (normalizedName.includes("altamuze")) {
      return "/images/altamuzethermal.jpg?v=20260805-transparent";
    }
    if (normalizedName.includes("al jameelah") || normalizedName.includes("jameelah")) {
      return "/images/Jameelahthermal.png?v=20260805-transparent";
    }
  } else {
    if (normalizedName.includes("al dana") || normalizedName.includes("dana")) {
      return "/images/aldana.png?v=20260805-transparent";
    }
    if (normalizedName.includes("al satwa") || normalizedName.includes("satwa")) {
      return "/images/dental.png?v=20260805-transparent";
    }
    if (normalizedName.includes("aesthetic") || normalizedName.includes("aesthetics")) {
      return "/images/invoiceskinandsmile-aesthetic.png?v=20260805-transparent";
    }
    if (normalizedName.includes("altamuze")) {
      return "/images/altamuze.png?v=20260805-transparent";
    }
    if (normalizedName.includes("al jameelah") || normalizedName.includes("jameelah")) {
      return "/images/aljameelah.png?v=20260805-transparent";
    }
  }

  return resolvedFallbackPath;
}

type ReceiptQrClinic = Partial<Pick<Clinic, "name" | "phone" | "whatsapp" | "instagram" | "facebook" | "tiktok" | "receipt_qr_url">> | null | undefined;

type ReceiptQrOptions = {
  clinic: ReceiptQrClinic;
  clinicDisplayName: string;
  clinicPhone?: string;
  clinicWhatsapp?: string;
  clinicInstagram?: string;
  clinicFacebook?: string;
  clinicTiktok?: string;
  qrUrl?: string;
  invoiceNo?: string;
};

function cleanSocialHandle(value: string) {
  return value.trim().replace(/^@+/, "");
}

function receiptQrValue(options: ReceiptQrOptions) {
  const configuredUrl = (options.qrUrl || options.clinic?.receipt_qr_url || "").trim();
  if (configuredUrl) return configuredUrl;

  const whatsapp = options.clinicWhatsapp || options.clinic?.whatsapp || "";
  const instagram = options.clinicInstagram || options.clinic?.instagram || "";
  const facebook = options.clinicFacebook || options.clinic?.facebook || "";
  const tiktok = options.clinicTiktok || options.clinic?.tiktok || "";
  const phone = options.clinicPhone || options.clinic?.phone || "";

  const whatsappDigits = whatsapp.replace(/\D/g, "");
  if (whatsappDigits.length >= 8) {
    return `https://wa.me/${whatsappDigits}`;
  }

  const instagramHandle = cleanSocialHandle(instagram);
  if (instagramHandle) {
    return `https://www.instagram.com/${instagramHandle}`;
  }

  const facebookValue = facebook.trim();
  if (/^https?:\/\//i.test(facebookValue)) {
    return facebookValue;
  }

  const tiktokHandle = cleanSocialHandle(tiktok);
  if (tiktokHandle) {
    return `https://www.tiktok.com/@${tiktokHandle}`;
  }

  return [
    options.clinicDisplayName || options.clinic?.name || "Clinic",
    phone ? `Phone: ${phone}` : "",
    options.invoiceNo ? `Invoice: ${options.invoiceNo}` : "",
  ].filter(Boolean).join("\n");
}

export function buildReceiptQrHtml(options: ReceiptQrOptions) {
  const qr = qrcode(0, "M");
  qr.addData(receiptQrValue(options));
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true })
    .replace("<svg ", '<svg style="width:22mm;height:22mm;display:block;" ');

  return `
    <div class="receipt-qr" style="display:flex;flex-direction:column;align-items:center;margin:6px 0 4px;break-inside:avoid;">
      <div style="font-size:10px;line-height:1.25;margin-bottom:3px;text-align:center;font-weight:700;">How did we do today?</div>
      ${svg}
      <div style="font-size:9px;line-height:1.3;margin-top:3px;text-align:center;">
        <div>Scan the QR code<br/>to share your experience.</div>
        <div style="margin-top:2px;">Your feedback helps us<br/>serve you better.</div>
      </div>
    </div>`;
}

export function printHtmlWhenImagesReady(html: string, popupMessage = "Please allow popups to print the receipt.") {
  const w = window.open("", "_blank", "width=400,height=600");
  if (!w) {
    alert(popupMessage);
    return;
  }

  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();

  const printWindow = () => {
    try { w.print(); } catch { /* ignore */ }
  };

  const images = Array.from(w.document.images);
  if (images.length === 0) {
    setTimeout(printWindow, 100);
    return;
  }

  let remaining = images.filter((img) => !img.complete).length;
  if (remaining === 0) {
    setTimeout(printWindow, 100);
    return;
  }

  const done = () => {
    remaining -= 1;
    if (remaining <= 0) {
      setTimeout(printWindow, 100);
    }
  };

  images.forEach((img) => {
    if (img.complete) return;
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });

  setTimeout(printWindow, 1500);
}
