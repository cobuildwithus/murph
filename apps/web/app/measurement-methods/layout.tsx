import type { ReactNode } from "react";

import { DashboardShell } from "@/src/components/dashboard/dashboard-shell";

export default function MeasurementMethodsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <DashboardShell padded={false}>{children}</DashboardShell>;
}
