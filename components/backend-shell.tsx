"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { clearClinicAccessSession, getClinicAccessLabel, useClinicAccess } from "../lib/clinic-access";
import { backendNavigation, getBackendPageTitle, type BackendNavItem } from "../app/backend/navigation";

const BACKEND_SELECTED_CLINIC_KEY = "backendSelectedClinicId";

type BackendShellProps = {
  children: ReactNode;
};

type ClinicOption = {
  id: string;
  name: string;
  room?: string | null;
};

export function BackendShell({ children }: BackendShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { accessSession, isLoaded } = useClinicAccess();
  const isManager = accessSession?.mode === "manager";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navSearch, setNavSearch] = useState(searchParams.get("q") || "");
  const [clinics, setClinics] = useState<ClinicOption[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState(searchParams.get("clinicId") || "");

  useEffect(() => {
    if (isLoaded && !accessSession) {
      router.replace("/login");
    }
  }, [accessSession, isLoaded, router]);

  useEffect(() => {
    if (!isLoaded || !accessSession || isManager) return;
    router.replace("/receipts");
  }, [accessSession, isLoaded, isManager, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      const savedClinicId = window.localStorage.getItem(BACKEND_SELECTED_CLINIC_KEY) || "";
      if (!searchParams.get("clinicId")) {
        setSelectedClinicId(savedClinicId);
      }
    };

    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", sync);
    };
  }, [searchParams]);

  useEffect(() => {
    setNavSearch(searchParams.get("q") || "");
    setSelectedClinicId(searchParams.get("clinicId") || "");
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase.from("clinics").select("id, name, room").order("name");
      if (cancelled || error) return;
      setClinics((data || []) as ClinicOption[]);
      if (!selectedClinicId && data && data.length > 0) {
        const savedClinicId = typeof window !== "undefined" ? window.localStorage.getItem(BACKEND_SELECTED_CLINIC_KEY) || "" : "";
        const fallbackClinicId = savedClinicId && data.some((clinic) => clinic.id === savedClinicId) ? savedClinicId : data[0].id;
        setSelectedClinicId(fallbackClinicId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedClinicId]);

  const filteredNavigation = useMemo(() => {
    const keyword = navSearch.trim().toLowerCase();
    if (!keyword) return backendNavigation;
    return backendNavigation.filter((item) => {
      const haystack = [item.label, ...(item.keywords || [])].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [navSearch]);

  const groupedNavigation = useMemo(() => ({
    core: filteredNavigation.filter((item) => item.group === "core"),
    branding: filteredNavigation.filter((item) => item.group === "branding"),
    security: filteredNavigation.filter((item) => item.group === "security"),
  }), [filteredNavigation]);

  const pageTitle = getBackendPageTitle(pathname);
  const selectedClinic = clinics.find((clinic) => clinic.id === selectedClinicId) || null;

  function buildHref(href: string, clinicIdOverride?: string) {
    const params = new URLSearchParams(searchParams.toString());
    const clinicId = clinicIdOverride !== undefined ? clinicIdOverride : selectedClinicId;
    if (clinicId) params.set("clinicId", clinicId);
    else params.delete("clinicId");
    if (navSearch.trim()) params.set("q", navSearch.trim());
    else params.delete("q");
    const queryString = params.toString();
    return queryString ? `${href}?${queryString}` : href;
  }

  function handleClinicSwitch(nextClinicId: string) {
    setSelectedClinicId(nextClinicId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BACKEND_SELECTED_CLINIC_KEY, nextClinicId);
    }
    router.replace(buildHref(pathname, nextClinicId));
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstMatch = filteredNavigation[0];
    router.push(buildHref(firstMatch?.href || pathname));
    setSidebarOpen(false);
  }

  if (!isLoaded || !accessSession) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm text-slate-200 backdrop-blur">
            Loading backend dashboard...
          </div>
        </div>
      </main>
    );
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="backend-shell__sidebar-meta text-[11px] font-semibold uppercase tracking-[0.35em]">
              {getClinicAccessLabel(accessSession)}
            </p>
            <h1 className="backend-shell__sidebar-title mt-2 text-xl font-semibold">Clinic Admin</h1>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="backend-shell__close-button rounded-xl border border-white/10 px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {[
          { label: "Core", items: groupedNavigation.core },
          { label: "Branding", items: groupedNavigation.branding },
          { label: "Security", items: groupedNavigation.security },
        ].map(({ label, items }: { label: string; items: BackendNavItem[] }) =>
          items.length > 0 ? (
            <div key={label} className="mb-5">
              <p className="backend-shell__sidebar-section px-3 text-[11px] font-semibold uppercase tracking-[0.28em]">
                {label}
              </p>
              <div className="mt-2 space-y-1">
                {items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={buildHref(item.href)}
                      onClick={() => setSidebarOpen(false)}
                      className={`backend-shell__nav-link flex items-center justify-between rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                        active
                          ? "backend-shell__nav-link--active bg-cyan-400/20 ring-1 ring-cyan-300/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                          : ""
                      }`}
                    >
                      <span>{item.label}</span>
                      {active ? <span className="backend-shell__nav-state text-[10px] uppercase tracking-[0.2em]">Open</span> : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null
        )}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <Link
          href="/login"
          onClick={() => clearClinicAccessSession()}
          className="backend-shell__switch-link flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/10"
        >
          Switch Clinic
        </Link>
      </div>
    </div>
  );

  return (
    <main className="backend-shell min-h-screen w-full overflow-x-clip bg-[#06111a] text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.10),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.08),_transparent_26%),linear-gradient(180deg,_#08131f_0%,_#0c1724_40%,_#eef7fb_40%,_#f6fbff_100%)]" />
      <div className="backend-shell__layout min-h-screen w-full">
        <aside className="backend-shell__sidebar w-[252px] shrink-0 border-r border-white/10 bg-slate-950/90 backdrop-blur">
          {sidebarContent}
        </aside>

        {sidebarOpen ? (
          <div className="backend-shell__mobile-overlay fixed inset-0 z-50">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 bg-slate-950/70"
            />
            <aside className="absolute left-0 top-0 h-full w-[252px] border-r border-white/10 bg-slate-950/95 backdrop-blur">
              {sidebarContent}
            </aside>
          </div>
        ) : null}

        <div className="backend-shell__main flex min-w-0 flex-1 flex-col">
          <header className="backend-shell__topbar sticky top-0 z-30 border-b border-slate-200/80 bg-white/88 backdrop-blur">
            <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6 xl:px-8">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="backend-shell__menu-button inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
                >
                  Menu
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-700">Backend Dashboard</p>
                  <h2 className="truncate text-xl font-semibold text-slate-950">{pageTitle}</h2>
                </div>
                <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Admin Access
                </div>
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Clinic</span>
                    <select
                      value={selectedClinicId}
                      onChange={(e) => handleClinicSwitch(e.target.value)}
                      className="min-w-[220px] rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                    >
                      {clinics.map((clinic) => (
                        <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                      ))}
                    </select>
                    {selectedClinic?.room ? (
                      <span className="rounded-full bg-cyan-100 px-3 py-1 text-xs font-semibold text-cyan-700">
                        {selectedClinic.room}
                      </span>
                    ) : null}
                  </div>
                </div>

                <form onSubmit={handleSearchSubmit} className="flex w-full gap-2 xl:max-w-md">
                  <input
                    value={navSearch}
                    onChange={(e) => setNavSearch(e.target.value)}
                    placeholder="Global search sections, branding, access..."
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
                  />
                  <button
                    type="submit"
                    className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Go
                  </button>
                </form>
              </div>
            </div>
          </header>

          <section className="backend-shell__content min-w-0 flex-1">
            {children}
          </section>
        </div>
      </div>
    </main>
  );
}
