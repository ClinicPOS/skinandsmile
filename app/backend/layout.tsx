import type { ReactNode } from "react";
import { BackendShell } from "../../components/backend-shell";

export default function BackendLayout({ children }: { children: ReactNode }) {
  return <BackendShell>{children}</BackendShell>;
}
