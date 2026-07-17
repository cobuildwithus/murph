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
});
