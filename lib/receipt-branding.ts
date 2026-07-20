import type { Clinic } from "./types";

export const receiptLogoOptions = [
  { value: "skin-smile", label: "Skin and Smile default", path: "/images/logo6.jpg" },
  { value: "skin-smile-alt", label: "Skin and Smile alternate", path: "/images/logo7.PNG" },
  { value: "altamuze", label: "Al Tamuze", path: "/images/logo5.jpg" },
  { value: "altamuze-compact", label: "Al Tamuze compact", path: "/images/logo4.png" },
  { value: "logo", label: "Logo 1", path: "/images/logo.png" },
  { value: "logo2", label: "Logo 2", path: "/images/logo2.png" },
  { value: "logo3", label: "Logo 3", path: "/images/logo3.png" },
] as const;

export function getReceiptLogoPath(clinic: Pick<Clinic, "logo"> | { logo?: string | null } | null | undefined, fallbackPath = "/images/logo6.jpg") {
  const logo = clinic?.logo?.trim();
  if (!logo) return fallbackPath;

  const option = receiptLogoOptions.find((item) => item.value === logo);
  if (option) return option.path;

  if (logo.startsWith("/")) return logo;

  return fallbackPath;
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