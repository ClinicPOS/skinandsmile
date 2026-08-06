import { Suspense } from "react";
import A4InvoiceDesignPageClient from "./a4-invoice-design-client";

export const dynamic = "force-dynamic";

export default function A4InvoiceDesignPage() {
  return (
    <Suspense fallback={<div className="min-h-[240px]" />}>
      <A4InvoiceDesignPageClient />
    </Suspense>
  );
}
