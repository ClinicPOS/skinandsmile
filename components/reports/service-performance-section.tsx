"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "../../lib/ceo-dashboard";
import { ExecutiveKpiCard } from "./executive-kpi-card";

type ServiceRow = {
  id: string; rank: number; name: string; category: string; quantity: number; uniquePatients: number;
  grossSales: number; discounts: number; refunds: number; netRevenue: number; revenueShare: number; averageRevenuePerSale: number;
};
type ServicePerformanceResponse = {
  meta: { granularity: "day" | "month"; legacyPricingRows: number };
  summary: {
    totalServiceRevenue: number; topRevenueService: ServiceRow | null; servicesSold: number;
    quantitySold: number; averageRevenuePerServiceSale: number;
  };
  services: ServiceRow[];
  categories: string[];
  serviceOptions: Array<{ id: string; name: string; category: string }>;
  categoryRevenue: Array<{ category: string; revenue: number }>;
  trend: Array<{ key: string; label: string; revenue: number }>;
};
type SortKey = keyof Pick<ServiceRow, "rank" | "name" | "category" | "quantity" | "uniquePatients" | "grossSales" | "discounts" | "netRevenue" | "revenueShare" | "averageRevenuePerSale">;

function currencyTooltip(value: unknown) {
  return [formatCurrency(Number(value || 0)), "Net Revenue"];
}

export function ServicePerformanceSection({ clinicId, startDate, endDate }: { clinicId: string; startDate: string; endDate: string }) {
  const [category, setCategory] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [data, setData] = useState<ServicePerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("netRevenue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError("");
      return fetch("/api/reports/top-services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId: clinicId || null, startDate, endDate, category: category || null, serviceId: serviceId || null }),
      signal: controller.signal,
      });
    }).then(async (response) => {
      if (!response) return;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to load service performance.");
      setData(payload as ServicePerformanceResponse);
    }).catch((requestError) => {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "Unable to load service performance.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [category, clinicId, endDate, serviceId, startDate]);

  const serviceOptions = useMemo(() => {
    const options = data?.serviceOptions || [];
    return category ? options.filter((service) => service.category === category) : options;
  }, [category, data?.serviceOptions]);

  const sortedRows = useMemo(() => {
    const rows = [...(data?.services || [])];
    return rows.sort((left, right) => {
      const a = left[sortKey];
      const b = right[sortKey];
      const comparison = typeof a === "string" ? a.localeCompare(String(b)) : Number(a) - Number(b);
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [data?.services, sortDirection, sortKey]);

  function changeSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(nextKey);
      setSortDirection(nextKey === "name" || nextKey === "category" ? "asc" : "desc");
    }
  }

  const selectedServiceName = data?.serviceOptions.find((service) => service.id === serviceId)?.name || "Selected Service";
  const chartRows = (data?.services || []).slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Service Performance</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">Revenue by service and category</h2>
            <p className="mt-1 text-sm text-slate-500">Uses the page date and clinic filters. Refunded treatment value is deducted; VAT is excluded.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[520px]">
            <label className="text-xs font-semibold text-slate-600">
              Service Category
              <select value={category} onChange={(event) => { setCategory(event.target.value); setServiceId(""); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                <option value="">All Categories</option>
                {(data?.categories || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Individual Service
              <select value={serviceId} onChange={(event) => setServiceId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900">
                <option value="">All Services</option>
                {serviceOptions.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
      {loading ? <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Loading service performance…</div> : null}

      {!loading && data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ExecutiveKpiCard title="Total Service Revenue" value={formatCurrency(data.summary.totalServiceRevenue)} />
            <ExecutiveKpiCard title="Top Revenue Service" value={data.summary.topRevenueService?.name || "No sales"} note={data.summary.topRevenueService ? formatCurrency(data.summary.topRevenueService.netRevenue) : undefined} />
            <ExecutiveKpiCard title="Number of Services Sold" value={String(data.summary.servicesSold)} note={`${data.summary.quantitySold.toLocaleString()} total quantity`} />
            <ExecutiveKpiCard title="Average Revenue per Service Sale" value={formatCurrency(data.summary.averageRevenuePerServiceSale)} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold text-slate-950">Top Services by Revenue</h3>
              <p className="mt-1 text-sm text-slate-500">Highest net service revenue after discounts and refunds.</p>
              {chartRows.length ? <div className="mt-4 h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(value) => String(value).length > 22 ? `${String(value).slice(0, 21)}…` : String(value)} />
                    <Tooltip formatter={currencyTooltip} contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                    <Bar dataKey="netRevenue" name="Net Revenue" fill="#0f766e" radius={[0, 7, 7, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div> : <EmptyState />}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-base font-semibold text-slate-950">Category Revenue</h3>
              <p className="mt-1 text-sm text-slate-500">Revenue grouped using the categories stored on services.</p>
              {data.categoryRevenue.length ? <div className="mt-4 h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.categoryRevenue} margin={{ top: 4, right: 12, bottom: 50, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="category" angle={-30} textAnchor="end" interval={0} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                    <Tooltip formatter={currencyTooltip} contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                    <Bar dataKey="revenue" name="Net Revenue" fill="#0284c7" radius={[7, 7, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div> : <EmptyState />}
            </section>
          </div>

          {serviceId ? <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-base font-semibold text-slate-950">{selectedServiceName} Revenue Trend</h3>
            <p className="mt-1 text-sm text-slate-500">{data.meta.granularity === "day" ? "Daily" : "Monthly"} net revenue for the selected range.</p>
            {data.trend.length ? <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                  <Tooltip formatter={currencyTooltip} contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Line type="monotone" dataKey="revenue" name="Net Revenue" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div> : <EmptyState />}
          </section> : null}

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h3 className="text-base font-semibold text-slate-950">Service Performance Table</h3>
            <p className="mt-1 text-sm text-slate-500">Select a column heading to sort. Refunds are included in Net Revenue.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-[1120px] w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <SortableHeading label="Rank" field="rank" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Service Name" field="name" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Category" field="category" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Quantity" field="quantity" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Unique Patients" field="uniquePatients" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Gross Sales" field="grossSales" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Discounts" field="discounts" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Net Revenue" field="netRevenue" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="% of Total" field="revenueShare" active={sortKey} direction={sortDirection} onSort={changeSort} />
                  <SortableHeading label="Avg / Sale" field="averageRevenuePerSale" active={sortKey} direction={sortDirection} onSort={changeSort} />
                </tr></thead>
                <tbody>{sortedRows.map((row) => <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-3 font-semibold text-slate-700">{row.rank}</td>
                  <td className="px-3 py-3 font-semibold text-slate-950">{row.name}</td>
                  <td className="px-3 py-3 text-slate-600">{row.category}</td>
                  <td className="px-3 py-3 text-slate-700">{row.quantity.toLocaleString()}</td>
                  <td className="px-3 py-3 text-slate-700">{row.uniquePatients.toLocaleString()}</td>
                  <td className="px-3 py-3 text-slate-700">{formatCurrency(row.grossSales)}</td>
                  <td className="px-3 py-3 text-amber-700">{formatCurrency(row.discounts)}</td>
                  <td className="px-3 py-3 font-semibold text-teal-800">{formatCurrency(row.netRevenue)}</td>
                  <td className="px-3 py-3 text-slate-700">{row.revenueShare.toFixed(1)}%</td>
                  <td className="px-3 py-3 text-slate-700">{formatCurrency(row.averageRevenuePerSale)}</td>
                </tr>)}</tbody>
              </table>
              {!sortedRows.length ? <EmptyState /> : null}
            </div>
            {data.meta.legacyPricingRows > 0 ? <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs text-amber-800">{data.meta.legacyPricingRows.toLocaleString()} older line item(s) predate VAT snapshots; their saved line total was used as the best available VAT-exclusive service value.</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No service sales for these filters.</div>;
}

function SortableHeading({ label, field, active, direction, onSort }: { label: string; field: SortKey; active: SortKey; direction: "asc" | "desc"; onSort: (field: SortKey) => void }) {
  return <th className="px-3 py-3"><button type="button" onClick={() => onSort(field)} className="whitespace-nowrap font-semibold hover:text-teal-700">{label}{active === field ? (direction === "asc" ? " ↑" : " ↓") : ""}</button></th>;
}
