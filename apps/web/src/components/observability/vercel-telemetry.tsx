"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";

import {
  redactVercelAnalyticsEvent,
  redactVercelSpeedInsightsEvent,
  shouldSuppressVercelTelemetryForPathname,
} from "@/src/lib/observability/analytics-redaction";

export function VercelTelemetry() {
  const pathname = usePathname();

  if (shouldSuppressVercelTelemetryForPathname(pathname)) {
    return null;
  }

  return (
    <>
      <Analytics beforeSend={redactVercelAnalyticsEvent} />
      <SpeedInsights beforeSend={redactVercelSpeedInsightsEvent} />
    </>
  );
}
