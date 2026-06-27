"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

const BOSS_PIN = "0404";

export default function RefundsPage() {
  const [pinInput, setPinInput] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinError, setPinError] = useState("");

  const [receiptSearch, setReceiptSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [receiptItems, setReceiptItems] = useState<any[]>([]);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [refundReason, setRefundReason] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [refundMessage, setRefundMessage] = useState("");

  async function handleUnlock() {
    if (pinInput === BOSS_PIN) {
      setIsUnlocked(true);
      setPinError("");
    } else {
      setPinError("Invalid PIN");
    }
  }

  async function searchReceipts() {
    if (!receiptSearch.trim()) {
      setSearchResults([]);
      return;
    }
    const query = receiptSearch.trim().toLowerCase();
    const { data } = await supabase.from("receipts").select("*, patients(name), receptionist(name)");
    if (data) {
      const filtered = data.filter((r: any) =>
        String(r.id || "").toLowerCase().includes(query) ||
        String(r.patients?.name || "").toLowerCase().includes(query)
      );
      setSearchResults(filtered.slice(0, 10));
    }
  }

  async function selectReceipt(receipt: any) {
    setSelectedReceipt(receipt);
    setCheckedItems(new Set());
    const { data: items } = await supabase
      .from("receipt_items")
      .select("*, services(name)")
      .eq("receipt_id", receipt.id);
    setReceiptItems(items || []);
    setRefundMessage("");
  }

  function toggleItem(itemId: string) {
    const updated = new Set(checkedItems);
    if (updated.has(itemId)) {
      updated.delete(itemId);
    } else {
      updated.add(itemId);
    }
    setCheckedItems(updated);
  }

  async function processRefund() {
    if (!selectedReceipt || checkedItems.size === 0) {
      setRefundMessage("Select at least one item to refund.");
      return;
    }
    if (!refundReason.trim()) {
      setRefundMessage("Please enter a reason for the refund.");
      return;
    }

    setIsProcessing(true);

    try {
      const itemsToRefund = receiptItems.filter((item) => checkedItems.has(item.id));
      const totalRefund = itemsToRefund.reduce((sum, item) => sum + Number(item.total || item.price || 0), 0);

      // Create refund record
      const { data: refundData, error: refundError } = await supabase
        .from("refunds")
        .insert([
          {
            receipt_id: selectedReceipt.id,
            receptionist_id: selectedReceipt.receptionist_id,
            reason: refundReason.trim(),
            total_amount: totalRefund,
            payment_method: selectedReceipt.payment_method,
          },
        ])
        .select()
        .single();

      if (refundError || !refundData) {
        setRefundMessage(`Error creating refund: ${refundError?.message || "unknown"}`);
        setIsProcessing(false);
        return;
      }

      // Create refund items
      const refundItems = itemsToRefund.map((item) => ({
        refund_id: refundData.id,
        receipt_item_id: item.id,
        service_id: item.service_id,
        service_name: item.services?.name || "Unknown",
        amount: Number(item.total || item.price || 0),
      }));

      const { error: itemsError } = await supabase.from("refund_items").insert(refundItems);
      if (itemsError) {
        setRefundMessage(`Error saving refund items: ${itemsError.message}`);
        setIsProcessing(false);
        return;
      }

      setRefundMessage(`✓ Refund processed for AED ${totalRefund.toFixed(2)}`);
      setSelectedReceipt(null);
      setCheckedItems(new Set());
      setRefundReason("");
      setReceiptSearch("");
      setSearchResults([]);
    } catch (err) {
      setRefundMessage(`Error: ${String(err)}`);
    }

    setIsProcessing(false);
  }

  if (!isUnlocked) {
    return (
      <AppFrame title="Refunds" description="Process refunds with boss authorization.">
        <div className="mx-auto max-w-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700">Refunds</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">Enter PIN</h2>
          <p className="mt-1 text-sm text-slate-500">
            Only authorized boss access. Enter PIN to process refunds.
          </p>
          <div className="mt-5 space-y-3">
            <input
              type="password"
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value); setPinError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="Enter PIN"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
            />
            {pinError && <p className="text-sm text-red-500">{pinError}</p>}
            <button
              onClick={handleUnlock}
              className="w-full rounded-2xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-600"
            >
              Unlock
            </button>
          </div>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame title="Refunds" description="Process refunds with boss authorization.">
      <div className="space-y-6">
        <div className="flex justify-end">
          <button
            onClick={() => setIsUnlocked(false)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-50"
          >
            Lock
          </button>
        </div>

        {/* Search section */}
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Find Receipt</p>
          <p className="mt-1 text-sm text-slate-600">Search by receipt ID or patient name</p>
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={receiptSearch}
              onChange={(e) => setReceiptSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchReceipts()}
              placeholder="Receipt ID or patient name..."
              className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
            />
            <button
              onClick={searchReceipts}
              className="rounded-2xl bg-teal-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-500"
            >
              Search
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="mt-4 space-y-2">
              {searchResults.map((receipt) => (
                <button
                  key={receipt.id}
                  onClick={() => selectReceipt(receipt)}
                  className={`w-full rounded-2xl border-2 p-3 text-left transition ${
                    selectedReceipt?.id === receipt.id
                      ? "border-teal-500 bg-teal-50"
                      : "border-slate-200 bg-white hover:border-teal-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{receipt.patients?.name || "Unknown"}</p>
                      <p className="text-xs text-slate-500">ID: {String(receipt.id).slice(0, 8)}...</p>
                    </div>
                    <p className="font-semibold text-slate-900">AED {Number(receipt.total).toFixed(2)}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(receipt.created_at).toLocaleString()} · {receipt.receptionist?.name}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Selected receipt details */}
        {selectedReceipt && (
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Receipt Items</p>
            <p className="mt-1 text-sm text-slate-600">Select items to refund</p>

            <div className="mt-4 space-y-2">
              {receiptItems.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3 transition hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={checkedItems.has(item.id)}
                    onChange={() => toggleItem(item.id)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{item.services?.name || "Unknown"}</p>
                    <p className="text-xs text-slate-500">AED {Number(item.total || item.price).toFixed(2)}</p>
                  </div>
                </label>
              ))}
            </div>

            {checkedItems.size > 0 && (
              <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50 p-3">
                <p className="text-sm font-semibold text-teal-900">
                  Total to Refund: AED {receiptItems
                    .filter((item) => checkedItems.has(item.id))
                    .reduce((sum, item) => sum + Number(item.total || item.price || 0), 0)
                    .toFixed(2)}
                </p>
              </div>
            )}

            {/* Reason input */}
            <div className="mt-4">
              <label className="block text-sm font-semibold text-slate-700">Reason</label>
              <input
                type="text"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="e.g., Patient request, incorrect charge, service issue"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-teal-400 focus:ring-4 focus:ring-teal-100"
              />
            </div>

            {/* Process button */}
            <button
              onClick={processRefund}
              disabled={isProcessing || checkedItems.size === 0}
              className="mt-5 w-full rounded-2xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition disabled:opacity-50 hover:bg-red-500"
            >
              {isProcessing ? "Processing..." : "Process Refund"}
            </button>

            {refundMessage && (
              <p className={`mt-3 text-sm font-medium ${refundMessage.startsWith("✓") ? "text-green-600" : "text-red-600"}`}>
                {refundMessage}
              </p>
            )}
          </div>
        )}
      </div>
    </AppFrame>
  );
}
