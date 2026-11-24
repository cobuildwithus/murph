"use client";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";

export default function DashboardError() {
  return <DashboardCriticalLoadError onRetry={() => window.location.reload()} />;
}
