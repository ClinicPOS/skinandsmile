"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "../../components/app-frame";
import { supabase } from "../../lib/supabase";

const BILLING_UNITS = ["Session", "Tooth", "Syringe", "Area", "Unit", "Pack", "Other"];

export default function ServicesPage() {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [billingUnit, setBillingUnit] = useState("Session");
  const [requiresQuantity, setRequiresQuantity] = useState(false);
  const [services, setServices] = useState<any[]>([]);

  useEffect(() => {
    loadServices();
  }, []);

  async function loadServices() {
    const { data } = await supabase.from("services").select("*");
    if (data) setServices(data);
  }

  async function saveService() {
    const { error } = await supabase.from("services").insert([
      {
        name,
        price: Number(price),
        billing_unit: billingUnit,
        requires_quantity: requiresQuantity,
      },
    ]);

    if (error) {
      alert("Error saving service");
      console.log(error);
    } else {
      alert("Service saved successfully!");
      setName("");
      setPrice("");
      setBillingUnit("Session");
      setRequiresQuantity(false);
      loadServices();
    }
  }

  return (
    <AppFrame
      title="Services"
      description="Define dental services and pricing for fast, consistent receipt creation."
    >
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            New service
          </p>
          <div className="mt-4 space-y-4">
            <input
              type="text"
              placeholder="Service Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <input
              type="number"
              placeholder="Price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500">Billing Unit</label>
                <select
                  value={billingUnit}
                  onChange={(e) => setBillingUnit(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                >
                  {BILLING_UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={requiresQuantity}
                  onChange={(e) => setRequiresQuantity(e.target.checked)}
                  className="h-4 w-4 rounded accent-cyan-600"
                />
                <span className="text-sm text-slate-700">Requires Quantity</span>
              </label>
            </div>

            <button
              onClick={saveService}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500"
            >
              Save Service
            </button>
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Service List</h2>
            <p className="text-sm text-slate-500">{services.length} records</p>
          </div>

          <div className="space-y-3">
            {services.map((service) => (
              <div
                key={service.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-slate-900">{service.name}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                  AED {service.price} / {service.billing_unit || "Session"}
                  {service.requires_quantity && (
                    <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-xs font-semibold text-cyan-700">Qty</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppFrame>
  );
}
