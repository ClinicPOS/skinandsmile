"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../components/app-frame";
import { supabase } from "../lib/supabase";

const modules = [
  {
    href: "/backend",
    title: "Backend",
    description: "One protected workspace to manage patients, doctors, receptionists, and services.",
    tone: "from-teal-900 to-cyan-700",
  },
  {
    href: "/receipt-history",
    title: "Receipt History",
    description: "Review past receipts and print copies for the office.",
    tone: "from-cyan-800 to-teal-500",
  },
  {
    href: "/treatment-history",
    title: "Patient Treatment History",
    description: "Open a patient timeline and inspect treatments by visit.",
    tone: "from-teal-500 to-cyan-400",
  },
  {
    href: "/search-patients",
    title: "Search Patients",
    description: "Quickly find a patient by name or phone number.",
    tone: "from-teal-500 to-amber-300",
  },
  {
    href: "/receipts",
    title: "Receipts",
    description: "Create professional invoices with VAT and service totals.",
    tone: "from-cyan-800 to-teal-400",
  },
];

export default function Home() {
  const [todaySales, setTodaySales] = useState(0);
  const [todayReceipts, setTodayReceipts] = useState(0);
  const [patientCount, setPatientCount] = useState(0);
  const [serviceCount, setServiceCount] = useState(0);

  useEffect(() => {
    loadDashboardStats();
  }, []);

  async function loadDashboardStats() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [receiptsResult, patientsResult, servicesResult] = await Promise.all([
      supabase
        .from("receipts")
        .select("total, created_at")
        .gte("created_at", startOfDay.toISOString()),
      supabase.from("patients").select("id", { count: "exact", head: true }),
      supabase.from("services").select("id", { count: "exact", head: true }),
    ]);

    const todayReceiptsData = receiptsResult.data || [];
    setTodaySales(
      todayReceiptsData.reduce(
        (sum, receipt) => sum + Number(receipt.total || 0),
        0
      )
    );
    setTodayReceipts(todayReceiptsData.length);
    setPatientCount(patientsResult.count || 0);
    setServiceCount(servicesResult.count || 0);
  }

  const metricCards = useMemo(
    () => [
      {
        label: "Today's sales",
        value: `AED ${todaySales.toFixed(2)}`,
        hint: "Revenue recorded today",
      },
      {
        label: "Receipts today",
        value: String(todayReceipts),
        hint: "Transactions created today",
      },
      {
        label: "Patients",
        value: String(patientCount),
        hint: "Saved patient records",
      },
      {
        label: "Services",
        value: String(serviceCount),
        hint: "Billable treatments",
      },
    ],
    [todaySales, todayReceipts, patientCount, serviceCount]
  );

  return (
    <AppFrame
      title="Office POS Dashboard"
      description="The main workstation for running the clinic day to day. Open a module below to manage patients, billing, histories, or search."
      actionLabel="Open Backend"
      actionHref="/backend"
    >
      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.95fr]">
        <div className="rounded-3xl border border-teal-200/70 bg-gradient-to-br from-teal-950 via-cyan-900 to-slate-900 p-6 text-white shadow-lg shadow-cyan-900/30">
          <p className="text-xs uppercase tracking-[0.3em] text-teal-200">
            Clinic POS command center
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            Fast access to the essentials.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-teal-100/90 sm:text-base">
            Keep the front desk, clinical team, and billing workflow organized in one
            office app.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {metricCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-teal-100/20 bg-white/10 p-4 backdrop-blur-sm">
                <p className="text-2xl font-semibold">{card.value}</p>
                <p className="mt-1 text-sm text-teal-100">{card.label}</p>
                <p className="mt-2 text-xs leading-5 text-teal-100/70">{card.hint}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-3xl border border-teal-100 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700/80">
              Quick actions
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-1">
              <Link
                href="/receipts"
                className="rounded-2xl border border-teal-200 bg-teal-50/60 px-4 py-3 text-center text-sm font-semibold text-teal-800 transition hover:border-teal-300 hover:bg-teal-100/70"
              >
                Open Clinic POS
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-teal-100 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-700/80">
              Available modules
            </p>
            <div className="mt-4 grid gap-3">
              {modules.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-2xl border border-teal-100 p-4 transition hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md"
                >
                  <div className={`h-1.5 w-16 rounded-full bg-gradient-to-r ${item.tone}`} />
                  <h3 className="mt-3 text-base font-semibold text-slate-900 group-hover:text-teal-700">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-teal-900/60">
                    {item.description}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
