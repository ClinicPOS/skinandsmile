"use client";

import type { ReactNode } from "react";

type ReportsFrameProps = {
  children: ReactNode;
};

export function ReportsFrame({ children }: ReportsFrameProps) {
  return (
    <main className="min-h-screen overflow-hidden text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.15),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(14,116,144,0.12),_transparent_28%),linear-gradient(180deg,_#f8fcff_0%,_#f4fbfc_45%,_#f8fbfd_100%)]" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </div>
    </main>
  );
}
