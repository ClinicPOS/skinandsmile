import { Suspense } from "react";
import ReceiptBrandingPageClient from "./receipt-branding-client";

export const dynamic = "force-dynamic";

export default function ReceiptBrandingPage() {
  return (
    <Suspense fallback={<div className="min-h-[240px]" />}>
      <ReceiptBrandingPageClient />
    </Suspense>
  );
}
