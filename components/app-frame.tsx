"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { clearClinicAccessSession, getClinicAccessLabel, useClinicAccess } from "../lib/clinic-access";

const navigation = [
  { href: "/receipts", label: "POS" },
  { href: "/add-patient", label: "Add Patient" },
  { href: "/backend", label: "Backend" },
  { href: "/reports", label: "Reports" },
];

type AppFrameProps = {
  title: string;
  description: string;
  children: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  workspaceType?: "default" | "pos";
};

export function AppFrame({
  children,
  workspaceType = "default",
}: AppFrameProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { accessSession, isLoaded } = useClinicAccess();
  const isManager = accessSession?.mode === "manager";
  const isPosWorkspace = workspaceType === "pos";
  const visibleNavigation = isManager
    ? navigation
    : navigation.filter((item) => item.href !== "/backend" && item.href !== "/reports");

  useEffect(() => {
    if (isLoaded && !accessSession) {
      router.replace("/login");
    }
  }, [accessSession, isLoaded, router]);

  useEffect(() => {
    if (!isLoaded || !accessSession || isManager) return;
    if (pathname === "/backend" || pathname === "/reports") {
      router.replace("/receipts");
    }
  }, [accessSession, isLoaded, isManager, pathname, router]);

  if (!isLoaded || !accessSession) {
    return (
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4">
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-500 shadow-sm">
            Loading clinic access...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.15),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(14,116,144,0.12),_transparent_28%),linear-gradient(180deg,_#f6fffd_0%,_#eefafc_55%,_#f8fcff_100%)]" />
      <div
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage: "url('/images/logo2.png')",
          backgroundRepeat: "repeat",
          backgroundSize: "220px",
          backgroundPosition: "center",
        }}
      />
      <div className={`mx-auto flex w-full flex-col gap-6 py-6 ${isPosWorkspace ? "max-w-[1720px] px-3 sm:px-4 lg:px-5" : "max-w-6xl px-4 sm:px-6 lg:px-8"}`}>
        <header className="rounded-3xl border border-teal-100/80 bg-white/88 px-5 py-3 shadow-[0_20px_80px_-30px_rgba(14,116,144,0.22)] backdrop-blur xl:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-700">
                {getClinicAccessLabel(accessSession)}
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
                {visibleNavigation.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="shrink-0 rounded-full border border-teal-200 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-2 text-sm font-semibold text-teal-800 transition hover:-translate-y-0.5 hover:border-teal-300 hover:from-teal-100 hover:to-cyan-100 hover:text-teal-900 hover:shadow-sm"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                onClick={() => clearClinicAccessSession()}
                className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-teal-300 hover:text-teal-800"
              >
                Switch Clinic
              </Link>
              <img
                src="/images/logo3.png"
                alt="Skin and Smile logo"
                className="h-10 w-auto shrink-0 object-contain"
              />
            </div>
          </div>
        </header>

        <section
          className={
            isPosWorkspace
              ? "p-0"
              : "rounded-3xl border border-teal-100/80 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.22)] backdrop-blur sm:p-6 lg:p-8"
          }
        >
          {children}
        </section>
      </div>
    </main>
  );
}