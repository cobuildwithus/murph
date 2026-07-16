import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

import type { VercelSpeedInsightsBeforeSendEvent } from "@/src/lib/observability/analytics-redaction";

type AnalyticsMockProps = {
  beforeSend: (event: { type: "pageview"; url: string }) => { type: "pageview"; url: string };
};

type SpeedInsightsMockProps = {
  beforeSend: (
    event: VercelSpeedInsightsBeforeSendEvent,
  ) => VercelSpeedInsightsBeforeSendEvent;
};

const mocks = vi.hoisted((): {
  analyticsProps: AnalyticsMockProps[];
  speedInsightsProps: SpeedInsightsMockProps[];
} => ({
  analyticsProps: [],
  speedInsightsProps: [],
}));

vi.mock("@vercel/analytics/next", () => ({
  Analytics(input: AnalyticsMockProps) {
    mocks.analyticsProps.push(input);
    return null;
  },
}));

vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights(input: SpeedInsightsMockProps) {
    mocks.speedInsightsProps.push(input);
    return null;
  },
}));

import { redactPrivateAnalyticsUrl } from "@/src/lib/observability/analytics-redaction";
import { VercelTelemetry } from "@/src/components/observability/vercel-telemetry";

test("VercelTelemetry redacts private handoff tokens before analytics sends", () => {
  mocks.analyticsProps.length = 0;
  mocks.speedInsightsProps.length = 0;

  const markup = renderToStaticMarkup(createElement(VercelTelemetry));

  assert.equal(markup, "");
  assert.equal(mocks.analyticsProps.length, 1);
  assert.equal(mocks.speedInsightsProps.length, 1);

  const analyticsProps = mocks.analyticsProps[0];
  const speedInsightsProps = mocks.speedInsightsProps[0];

  if (!analyticsProps || !speedInsightsProps) {
    assert.fail("Vercel telemetry components did not receive beforeSend props.");
  }

  assert.deepEqual(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "https://join.example.test/computer/handoff/private-token?step=done#hash",
    }),
    {
      type: "pageview",
      url: "https://join.example.test/computer/handoff/[token]",
    },
  );
  assert.deepEqual(
    speedInsightsProps.beforeSend({
      route: "/computer/handoff/private-token",
      type: "vital",
      url: "https://join.example.test/computer/handoff/private-token",
    }),
    {
      route: "/computer/handoff/[token]",
      type: "vital",
      url: "https://join.example.test/computer/handoff/[token]",
    },
  );

  assert.equal(
    redactPrivateAnalyticsUrl("/api/computer/handoff/private-token/done"),
    "/api/computer/handoff/[token]/done",
  );
});

test("VercelTelemetry redacts Clinical Records claims and callback markers", () => {
  mocks.analyticsProps.length = 0;
  mocks.speedInsightsProps.length = 0;

  renderToStaticMarkup(createElement(VercelTelemetry));

  const analyticsProps = mocks.analyticsProps[0];
  const speedInsightsProps = mocks.speedInsightsProps[0];

  if (!analyticsProps || !speedInsightsProps) {
    assert.fail("Vercel telemetry components did not receive beforeSend props.");
  }

  const claim = `cr_${"0".repeat(32)}`;
  assert.deepEqual(
    analyticsProps.beforeSend({
      type: "pageview",
      url: `https://join.example.test/records/connect?source=assistant#keep=provider&clinicalRecordsIntent=${claim}`,
    }),
    {
      type: "pageview",
      url: "https://join.example.test/records/connect?source=assistant#keep=provider",
    },
  );
  assert.deepEqual(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "/records?clinicalRecords=failed&source=epic#details",
    }),
    {
      type: "pageview",
      url: "/records?source=epic#details",
    },
  );
  assert.deepEqual(
    speedInsightsProps.beforeSend({
      route: `/records/connect#clinicalRecordsIntent=${claim}&keep=route`,
      type: "vital",
      url: "https://join.example.test/records?clinicalRecords=connected&source=epic#summary",
    }),
    {
      route: "/records/connect#keep=route",
      type: "vital",
      url: "https://join.example.test/records?source=epic#summary",
    },
  );
});

test("redactPrivateAnalyticsUrl leaves unrelated routes unchanged", () => {
  assert.equal(
    redactPrivateAnalyticsUrl("https://join.example.test/home?from=/computer"),
    "https://join.example.test/home?from=/computer",
  );
  assert.equal(
    redactPrivateAnalyticsUrl("/computer/handoff"),
    "/computer/handoff",
  );
  assert.equal(
    redactPrivateAnalyticsUrl("/home?clinicalRecords=failed#clinicalRecordsIntent=not-a-claim"),
    "/home?clinicalRecords=failed#clinicalRecordsIntent=not-a-claim",
  );
});
