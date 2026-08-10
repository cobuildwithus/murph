import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

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
  VERCEL_TELEMETRY_PATHNAMES,
} from "@/src/lib/observability/analytics-redaction";
import { VercelTelemetry } from "@/src/components/observability/vercel-telemetry";

test("VercelTelemetry drops private handoff routes before either vendor sends", () => {
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

  assert.equal(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "https://join.example.test/computer/handoff/private-token?step=done#hash",
    }),
    null,
  );
  assert.equal(
    speedInsightsProps.beforeSend({
      route: "/computer/handoff/private-token",
      type: "vital",
      url: "https://join.example.test/computer/handoff/private-token",
    }),
    null,
  );

  assert.equal(
    redactPrivateAnalyticsUrl("/api/computer/handoff/private-token/done"),
    "/api/computer/handoff/[token]/done",
  );
});

test("VercelTelemetry strips Clinical Records URL state before either vendor sends", () => {
  mocks.pathname = "/records/connect";
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
      url: "https://join.example.test/records/connect",
    },
  );
  assert.deepEqual(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "/records?clinicalRecords=failed&source=epic#details",
    }),
    {
      type: "pageview",
      url: "/records",
    },
  );
  assert.deepEqual(
    speedInsightsProps.beforeSend({
      route: `/records/connect#clinicalRecordsIntent=${claim}&keep=route`,
      type: "vital",
      url: `https://join.example.test/records/connect?source=assistant#clinicalRecordsIntent=${claim}`,
    }),
    {
      route: "/records/connect",
      type: "vital",
      url: "https://join.example.test/records/connect",
    },
  );
  assert.equal(
    speedInsightsProps.beforeSend({
      route: `/records/connect#clinicalRecordsIntent=${claim}&keep=route`,
      type: "vital",
      url: "https://join.example.test/records?clinicalRecords=connected&source=epic#summary",
    }),
    null,
  );

  assert.equal(
    redactPrivateAnalyticsUrl(
      `https://join.example.test/records/connect?source=assistant#keep=provider&clinicalRecordsIntent=${claim}`,
    ),
    "https://join.example.test/records/connect",
  );
  assert.equal(
    redactPrivateAnalyticsUrl(
      "/records?clinicalRecords=failed&source=epic#details",
    ),
    "/records",
  );
});

test("VercelTelemetry does not mount outside the explicit page allowlist", () => {
  for (const pathname of [
    "/approve/private-approval",
    "/computer/handoff/private-token",
    "/family/accept/private-invite",
    "/groups/fund/private-code",
    "/groups/join/private-code",
    "/integrations/connect/private-claim",
    "/join/private-invite",
    "/experiments/runs/private-run",
    "/unknown/private-segment",
  ]) {
    mocks.pathname = pathname;
    mocks.analyticsProps.length = 0;
    mocks.speedInsightsProps.length = 0;

    const markup = renderToStaticMarkup(createElement(VercelTelemetry));

    assert.equal(markup, "");
    assert.equal(mocks.analyticsProps.length, 0);
    assert.equal(mocks.speedInsightsProps.length, 0);
  }
});

test("VercelTelemetry drops non-allowlisted events before either vendor sends", () => {
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
      url: "https://www.example.test/join/private-invite",
    }),
    null,
  );
  assert.equal(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "/computer/handoff/private-token",
    }),
    null,
  );
  assert.equal(
    speedInsightsProps.beforeSend({
      type: "vital",
      url: "https://www.example.test/experiments/runs/private-run",
    }),
    null,
  );
  assert.equal(
    speedInsightsProps.beforeSend({
      route: "/family/accept/[inviteCode]",
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

test("VercelTelemetry drops malformed and pathless vendor URLs", () => {
  mocks.pathname = "/";
  mocks.analyticsProps.length = 0;
  mocks.speedInsightsProps.length = 0;

  renderToStaticMarkup(createElement(VercelTelemetry));

  const analyticsProps = mocks.analyticsProps[0];
  const speedInsightsProps = mocks.speedInsightsProps[0];

  if (!analyticsProps || !speedInsightsProps) {
    assert.fail("Vercel telemetry components did not receive beforeSend props.");
  }

  for (const url of [
    "",
    "?private=1",
    "#private",
    ".",
    " /home",
    "//www.example.test/home",
    "\\home",
    "https:home",
    "https:/home",
  ]) {
    assert.equal(
      analyticsProps.beforeSend({ type: "pageview", url }),
      null,
      `Analytics should reject ${JSON.stringify(url)}`,
    );
    assert.equal(
      speedInsightsProps.beforeSend({
        route: "/home",
        type: "vital",
        url,
      }),
      null,
      `Speed Insights should reject ${JSON.stringify(url)}`,
    );
  }

  assert.equal(
    speedInsightsProps.beforeSend({
      route: "https:home",
      type: "vital",
      url: "https://www.example.test/home",
    }),
    null,
  );
});

test("VercelTelemetry canonicalizes allowlisted paths and strips URL state", () => {
  mocks.pathname = "/home";
  mocks.analyticsProps.length = 0;
  mocks.speedInsightsProps.length = 0;

  renderToStaticMarkup(createElement(VercelTelemetry));

  const analyticsProps = mocks.analyticsProps[0];
  const speedInsightsProps = mocks.speedInsightsProps[0];

  if (!analyticsProps || !speedInsightsProps) {
    assert.fail("Vercel telemetry components did not receive beforeSend props.");
  }

  assert.deepEqual(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "https://www.example.test/home?tab=persona#persona",
    }),
    {
      type: "pageview",
      url: "https://www.example.test/home",
    },
  );
  assert.deepEqual(
    speedInsightsProps.beforeSend({
      route: "/home?panel=usage",
      type: "vital",
      url: "https://www.example.test/home?tab=persona#persona",
    }),
    {
      route: "/home",
      type: "vital",
      url: "https://www.example.test/home",
    },
  );
  assert.equal(
    speedInsightsProps.beforeSend({
      route: "/clubs",
      type: "vital",
      url: "https://www.example.test/home",
    }),
    null,
  );
});

test("VercelTelemetry aggregates public dynamic routes without sending identifiers", () => {
  const routes = [
    {
      expected: "/blog/[article]",
      pathname: "/blog/how-to-run-a-useful-health-experiment",
      route: "/blog/[slug]",
    },
    {
      expected: "/biomarkers/[biomarker]",
      pathname: "/biomarkers/resting-heart-rate",
      route: "/biomarkers/[biomarkerId]",
    },
    {
      expected: "/biomarkers/[biomarker]/research",
      pathname: "/biomarkers/resting-heart-rate/research",
      route: "/biomarkers/[biomarkerId]/research",
    },
    {
      expected: "/biomarkers/results/[metric]",
      pathname: "/biomarkers/results/ldl_cholesterol",
      route: "/biomarkers/results/[metricKey]",
    },
    {
      expected: "/experiments/[experiment]",
      pathname: "/experiments/sleep-consistency",
      route: "/experiments/[experimentId]",
    },
    {
      expected: "/experiments/[experiment]/research",
      pathname: "/experiments/sleep-consistency/research",
      route: "/experiments/[experimentId]/research",
    },
    {
      expected: "/experiments/[experiment]/results",
      pathname: "/experiments/sleep-consistency/results",
      route: "/experiments/[experimentId]/results",
    },
    {
      expected: "/measurement-methods/[method]",
      pathname: "/measurement-methods/resting-heart-rate",
      route: "/measurement-methods/[measurementMethodId]",
    },
    {
      expected: "/search/products/[product]",
      pathname: "/search/products/supplement_example",
      route: "/search/products/[productRef]",
    },
  ] as const;

  for (const { expected, pathname, route } of routes) {
    mocks.pathname = pathname;
    mocks.analyticsProps.length = 0;
    mocks.speedInsightsProps.length = 0;

    renderToStaticMarkup(createElement(VercelTelemetry));

    const analyticsProps = mocks.analyticsProps[0];
    const speedInsightsProps = mocks.speedInsightsProps[0];

    if (!analyticsProps || !speedInsightsProps) {
      assert.fail(`Vercel telemetry did not mount for ${pathname}.`);
    }

    assert.deepEqual(
      analyticsProps.beforeSend({
        type: "pageview",
        url: `https://www.example.test${pathname}?private=query#private-fragment`,
      }),
      {
        type: "pageview",
        url: `https://www.example.test${expected}`,
      },
    );
    assert.deepEqual(
      speedInsightsProps.beforeSend({
        route,
        type: "vital",
        url: `https://www.example.test${pathname}?private=query#private-fragment`,
      }),
      {
        route: expected,
        type: "vital",
        url: `https://www.example.test${expected}`,
      },
    );
  }
});

test("redactPrivateAnalyticsUrl canonicalizes allowlisted routes", () => {
  mocks.pathname = "/";
  assert.equal(shouldSuppressVercelTelemetryForPathname("/searching"), true);
  assert.equal(shouldSuppressVercelTelemetryForPathname("/home/"), false);
  assert.equal(
    redactPrivateAnalyticsUrl("https://join.example.test/home?from=/computer"),
    "https://join.example.test/home",
  );
  assert.equal(
    redactPrivateAnalyticsUrl("/computer/handoff"),
    "/computer/handoff",
  );
  assert.equal(
    redactPrivateAnalyticsUrl("/home?clinicalRecords=failed#clinicalRecordsIntent=not-a-claim"),
    "/home",
  );
});

test("Vercel telemetry has one fail-closed root owner", () => {
  const appSources = readTypeScriptSources(
    new URL("../app/", import.meta.url),
    "app",
  );
  const telemetryOwners = [
    ...appSources,
    ...readTypeScriptSources(new URL("../src/", import.meta.url), "src"),
  ]
    .map(({ path, source }) => ({
      importCount:
        source.match(/from\s+["'][^"']*vercel-telemetry["'];/gu)?.length ?? 0,
      mountCount: source.match(/<VercelTelemetry\b[^>]*\/>/gu)?.length ?? 0,
      path,
    }))
    .filter(({ importCount, mountCount }) => importCount > 0 || mountCount > 0)
    .sort((left, right) => left.path.localeCompare(right.path));

  assert.deepEqual(
    [...VERCEL_TELEMETRY_PATHNAMES].sort(),
    listStaticPagePathnames(appSources),
  );
  assert.deepEqual(telemetryOwners, [
    {
      importCount: 1,
      mountCount: 1,
      path: "app/layout.tsx",
    },
  ]);
});

function listStaticPagePathnames(
  appSources: Array<{ path: string; source: string }>,
): string[] {
  return appSources
    .filter(({ path }) => path === "app/page.tsx" || path.endsWith("/page.tsx"))
    .flatMap(({ path }) => {
      const segments = path
        .split("/")
        .slice(1, -1)
        .filter((segment) => !/^\(.+\)$/u.test(segment));

      if (segments.some((segment) => segment.startsWith("["))) {
        return [];
      }

      return [segments.length === 0 ? "/" : `/${segments.join("/")}`];
    })
    .sort();
}

function readTypeScriptSources(
  directory: URL,
  relativeDirectory: string,
): Array<{ path: string; source: string }> {
  const sources: Array<{ path: string; source: string }> = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${relativeDirectory}/${entry.name}`;
    const url = new URL(entry.name, directory);

    if (entry.isDirectory()) {
      sources.push(...readTypeScriptSources(new URL(`${entry.name}/`, directory), path));
      continue;
    }

    if (!entry.isFile() || !/\.[cm]?tsx?$/u.test(entry.name)) {
      continue;
    }

    sources.push({
      path,
      source: readFileSync(url, "utf8"),
    });
  }

  return sources;
}
