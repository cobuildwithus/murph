import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

import type { VercelSpeedInsightsBeforeSendEvent } from "@/src/lib/observability/analytics-redaction";

type AnalyticsMockProps = {
  beforeSend: (
    event: { type: "pageview"; url: string },
  ) => { type: "pageview"; url: string } | null;
};

type SpeedInsightsMockProps = {
  beforeSend: (
    event: VercelSpeedInsightsBeforeSendEvent,
  ) => VercelSpeedInsightsBeforeSendEvent | null;
};

const mocks = vi.hoisted((): {
  analyticsProps: AnalyticsMockProps[];
  pathname: string;
  speedInsightsProps: SpeedInsightsMockProps[];
} => ({
  analyticsProps: [],
  pathname: "/",
  speedInsightsProps: [],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
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

import {
  redactPrivateAnalyticsUrl,
  shouldSuppressVercelTelemetryForPathname,
} from "@/src/lib/observability/analytics-redaction";
import { VercelTelemetry } from "@/src/components/observability/vercel-telemetry";

test("VercelTelemetry redacts private handoff tokens before analytics sends", () => {
  mocks.pathname = "/";
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
  mocks.pathname = "/";
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

test("VercelTelemetry does not mount analytics on Murph Safe routes", () => {
  for (const pathname of ["/search", "/search/products/supplement_example"]) {
    mocks.pathname = pathname;
    mocks.analyticsProps.length = 0;
    mocks.speedInsightsProps.length = 0;

    const markup = renderToStaticMarkup(createElement(VercelTelemetry));

    assert.equal(markup, "");
    assert.equal(mocks.analyticsProps.length, 0);
    assert.equal(mocks.speedInsightsProps.length, 0);
  }
});

test("VercelTelemetry drops Murph Safe events before either vendor sends", () => {
  mocks.pathname = "/";
  mocks.analyticsProps.length = 0;
  mocks.speedInsightsProps.length = 0;

  renderToStaticMarkup(createElement(VercelTelemetry));

  const analyticsProps = mocks.analyticsProps[0];
  const speedInsightsProps = mocks.speedInsightsProps[0];

  if (!analyticsProps || !speedInsightsProps) {
    assert.fail("Vercel telemetry components did not receive beforeSend props.");
  }

  assert.equal(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "https://www.example.test/search",
    }),
    null,
  );
  assert.equal(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "/search/products/food_example",
    }),
    null,
  );
  assert.equal(
    speedInsightsProps.beforeSend({
      type: "vital",
      url: "https://www.example.test/search/products/food_example",
    }),
    null,
  );
  assert.equal(
    speedInsightsProps.beforeSend({
      route: "/search/products/[ref]",
      type: "vital",
      url: "https://www.example.test/home",
    }),
    null,
  );
});

test("VercelTelemetry suppresses device callback pages and their full URLs", () => {
  for (const pathname of [
    "/api/device-sync/connect/oura/callback",
    "/api/device-sync/oauth/junction/callback",
  ]) {
    mocks.pathname = pathname;
    mocks.analyticsProps.length = 0;
    mocks.speedInsightsProps.length = 0;

    renderToStaticMarkup(createElement(VercelTelemetry));

    assert.equal(mocks.analyticsProps.length, 0);
    assert.equal(mocks.speedInsightsProps.length, 0);
  }

  mocks.pathname = "/";
  renderToStaticMarkup(createElement(VercelTelemetry));

  const analyticsProps = mocks.analyticsProps[0];
  const speedInsightsProps = mocks.speedInsightsProps[0];
  if (!analyticsProps || !speedInsightsProps) {
    assert.fail("Vercel telemetry components did not receive beforeSend props.");
  }

  for (const url of [
    "https://join.example.test/api/device-sync/connect/oura/callback?code=provider-code&state=oauth-state",
    "/api/device-sync/oauth/junction/callback?murph_state=oauth-state&code=provider-code",
  ]) {
    assert.equal(analyticsProps.beforeSend({ type: "pageview", url }), null);
    assert.equal(speedInsightsProps.beforeSend({ type: "vital", url }), null);
  }
});

test("redactPrivateAnalyticsUrl leaves unrelated routes unchanged", () => {
  mocks.pathname = "/";
  assert.equal(shouldSuppressVercelTelemetryForPathname("/searching"), false);
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
