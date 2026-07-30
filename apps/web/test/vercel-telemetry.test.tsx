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

test("VercelTelemetry drops Clinical Records routes before either vendor sends", () => {
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
  assert.equal(
    analyticsProps.beforeSend({
      type: "pageview",
      url: `https://join.example.test/records/connect?source=assistant#keep=provider&clinicalRecordsIntent=${claim}`,
    }),
    null,
  );
  assert.equal(
    analyticsProps.beforeSend({
      type: "pageview",
      url: "/records?clinicalRecords=failed&source=epic#details",
    }),
    null,
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
    "https://join.example.test/records/connect?source=assistant#keep=provider",
  );
  assert.equal(
    redactPrivateAnalyticsUrl(
      "/records?clinicalRecords=failed&source=epic#details",
    ),
    "/records?source=epic#details",
  );
});

test("VercelTelemetry does not mount outside the explicit page allowlist", () => {
  for (const pathname of [
    "/family/accept/private-invite",
    "/integrations/connect/private-claim",
    "/search",
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
      url: "https://www.example.test/home?initialVisit=true#persona",
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
      url: "https://www.example.test/home?initialVisit=true#persona",
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

test("Vercel telemetry ownership is explicit and matches the allowlist", () => {
  const pageOwners: Record<
    (typeof VERCEL_TELEMETRY_PATHNAMES)[number],
    string
  > = {
    "/": "app/page.tsx",
    "/changelog": "app/changelog/page.tsx",
    "/clubs": "app/clubs/page.tsx",
    "/home": "app/(dashboard)/home/page.tsx",
    "/pitch": "app/pitch/page.tsx",
  };
  const readAppFile = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const telemetryOwners = [
    ...readTypeScriptSources(new URL("../app/", import.meta.url), "app"),
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
  const expectedOwnerPaths = Object.values(pageOwners).sort();

  assert.deepEqual(Object.keys(pageOwners), [...VERCEL_TELEMETRY_PATHNAMES]);
  assert.deepEqual(
    telemetryOwners.map(({ path }) => path),
    expectedOwnerPaths,
  );

  for (const path of expectedOwnerPaths) {
    const source = readAppFile(path);
    const owner = telemetryOwners.find((candidate) => candidate.path === path);

    assert.equal(owner?.importCount, 1, `${path} should have one direct import`);
    assert.equal(owner?.mountCount, 1, `${path} should have one direct mount`);
    assert.match(source, /<VercelTelemetry \/>/u);
  }

  assert.doesNotMatch(readAppFile("app/layout.tsx"), /VercelTelemetry/u);
});

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
