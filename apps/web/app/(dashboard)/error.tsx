"use client";

import { DashboardCriticalLoadError } from "@/src/components/dashboard/dashboard-critical-load-error";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DashboardCriticalLoadError onRetry={reset} />;
}
