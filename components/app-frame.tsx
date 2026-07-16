import Link from "next/link";
import type { ReactNode } from "react";

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
};

export function AppFrame({
  children,
}: AppFrameProps) {

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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-teal-100/80 bg-white/88 px-5 py-3 shadow-[0_20px_80px_-30px_rgba(14,116,144,0.22)] backdrop-blur xl:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-700">
                Skin & Smile Dental Clinic
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
                {navigation.map((item) => (
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
            <img
              src="/images/logo3.png"
              alt="Skin and Smile logo"
              className="h-10 w-auto shrink-0 object-contain"
            />
          </div>
        </header>

        <section className="rounded-3xl border border-teal-100/80 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.22)] backdrop-blur sm:p-6 lg:p-8">
          {children}
        </section>
      </div>
    </main>
  );
}