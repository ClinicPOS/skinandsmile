import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "Dashboard" },
  { href: "/backend", label: "Backend" },
  { href: "/search-patients", label: "Search Patients" },
  { href: "/receipt-history", label: "Receipt History" },
  { href: "/treatment-history", label: "Treatment History" },
  { href: "/receipts", label: "POS" },
];

const dailyQuotes = [
  "Your smile at the desk can calm someone’s whole day.",
  "Patience and kindness are your superpowers at reception.",
  "Every warm welcome builds trust before treatment begins.",
  "You are the first impression and the lasting comfort.",
  "Busy day or not, your professionalism shines through.",
  "One clear explanation can make a patient feel safe.",
  "You keep the clinic moving with grace and heart.",
  "Behind every smooth shift is a focused receptionist.",
  "Your calm tone turns stress into reassurance.",
  "Great service starts with how you greet each patient.",
  "You handle people, pressure, and details like a pro.",
  "Today, your kindness will be remembered by many.",
];

function getDailyQuote() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  return dailyQuotes[dayOfYear % dailyQuotes.length];
}

type AppFrameProps = {
  title: string;
  description: string;
  children: ReactNode;
  actionLabel?: string;
  actionHref?: string;
};

export function AppFrame({
  title,
  description,
  children,
  actionLabel = "Back to Home",
  actionHref = "/",
}: AppFrameProps) {
  const quoteOfTheDay = getDailyQuote();

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
        <header className="rounded-3xl border border-teal-100/80 bg-white/88 p-5 shadow-[0_20px_80px_-30px_rgba(14,116,144,0.22)] backdrop-blur xl:p-6">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-700">
                  Skin & Smile Dental Clinic
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Office POS application for daily clinic operations
                </p>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
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

            <div className="relative flex flex-col gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#7db8b3] to-[#6aa8a2] px-8 py-8 text-white shadow-inner shadow-[#5a9890]/35 lg:flex-row lg:items-center lg:justify-between">
              {/* Large background logo */}
              <img
                src="/images/logo3.png"
                alt="Background logo"
                className="absolute inset-0 h-full w-full object-contain p-12 opacity-15"
                style={{
                  zIndex: 1,
                }}
              />

              <div className="relative z-10 flex flex-col items-center gap-3 text-center lg:flex-1">
                <img
                  src="/images/logo3.png"
                  alt="Skin and Smile logo"
                  className="h-[120px] w-auto object-contain drop-shadow-md"
                />
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.3em] text-amber-100/90">
                    Skin & Smile Dental Clinic
                  </p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                    {title}
                  </h1>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-amber-50/90 sm:text-base">
                    {description}
                  </p>
                </div>
              </div>

              <div className="relative z-10 flex-1 rounded-2xl border border-white/30 bg-white/15 px-6 py-5 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-100/90">
                  Quote Of The Day
                </p>
                <p className="mt-3 text-lg leading-7 text-white/95">
                  "{quoteOfTheDay}"
                </p>
              </div>
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-teal-100/80 bg-white/92 p-5 shadow-[0_20px_80px_-35px_rgba(14,116,144,0.22)] backdrop-blur sm:p-6 lg:p-8">
          {children}
        </section>
      </div>
    </main>
  );
}