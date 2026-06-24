"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import {
  redactVercelAnalyticsEvent,
  redactVercelSpeedInsightsEvent,
} from "@/src/lib/observability/analytics-redaction";

export function VercelTelemetry() {
  return (
    <>
      <Analytics beforeSend={redactVercelAnalyticsEvent} />
      <SpeedInsights beforeSend={redactVercelSpeedInsightsEvent} />
    </>
  );
}
