"use client";

import { AppFrame } from "../../components/app-frame";
import ReceiptLogClient from "./receipt-log-client";

export default function ReceiptLogPage() {
  return (
    <AppFrame title="Receipts" description="View and manage past receipts.">
      <ReceiptLogClient />
    </AppFrame>
  );
}
