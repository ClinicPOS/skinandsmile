import { Suspense, type ReactNode } from "react";
import { BackendShell } from "../../components/backend-shell";

export default function BackendLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p>Loading backend…</p>}><BackendShell>{children}</BackendShell></Suspense>;
}
