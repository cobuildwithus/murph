import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("the persistent dashboard layout fences fresh vault authority to its server-rendered member", () => {
  const contextSource = readSource("src/lib/browser-vault/context.tsx");
  const layoutSource = readSource("app/(dashboard)/layout.tsx");
  const templateUrl = new URL("../app/(dashboard)/template.tsx", import.meta.url);

  assert.match(layoutSource, /BrowserVaultProvider/u);
  assert.equal(existsSync(templateUrl), false);
  assert.doesNotMatch(layoutSource, /getHostedBrowserVaultPageAuthority/u);
  assert.doesNotMatch(layoutSource, /authorized=/u);
  assert.match(layoutSource, /getHostedDashboardLayoutAuthSnapshot/u);
  assert.match(layoutSource, /DashboardLegalConsentGate/u);
  assert.match(layoutSource, /hasHostedHistoricalLaunchConsent\(consentStatus\)/u);
  assert.match(layoutSource, /!consentStatus\.launchGranted/u);
  assert.match(
    layoutSource,
    /initialMemberId=\{authenticatedMember\?\.id \?\? null\}/u,
  );
  assert.match(
    layoutSource,
    /browserVaultLoadEnabled = authenticatedMember\s*\?\s*consentStatus\?\.launchGranted \?\? true\s*:\s*false/u,
  );
  assert.match(layoutSource, /loadEnabled=\{browserVaultLoadEnabled\}/u);
  assert.match(contextSource, /expectedMemberId: initialMemberId/u);
  assert.match(contextSource, /reloadCurrentHostedAuthDocument/u);
  assert.doesNotMatch(contextSource, /requireFreshAuthority/u);
  assert.match(contextSource, /await existing/u);
  assert.match(contextSource, /authorityAdmitted \? client : null/u);
  assert.doesNotMatch(contextSource, /useState<BrowserVaultStatus>\(initialSnapshot/u);
});

test("dashboard route consumers no longer wrap their own BrowserVaultProvider", () => {
  const formerWrapperFiles = [
    "app/(dashboard)/overview/overview-page-client.tsx",
    "app/(dashboard)/history/history-page-client.tsx",
    "app/(dashboard)/biomarkers/biomarkers-page-client.tsx",
    "app/(dashboard)/experiments/experiments-page-client.tsx",
    "app/(dashboard)/experiments/[experimentId]/experiment-start-or-run-status.tsx",
    "app/(dashboard)/experiments/[experimentId]/active-run-summary-client.tsx",
    "app/(dashboard)/experiments/[experimentId]/results/results-tab-client.tsx",
    "src/components/home/browser-vault-onboarding-steps.tsx",
    "src/components/biomarkers/biomarker-detail/biomarker-overview.tsx",
  ];

  for (const relativePath of formerWrapperFiles) {
    assert.doesNotMatch(
      readSource(relativePath),
      /BrowserVaultProvider/u,
      `${relativePath} should rely on the dashboard route-group layout provider`,
    );
  }
});

test("the landing page does not start private browser-vault work", () => {
  const landingSource = readSource("app/page.tsx");
  assert.doesNotMatch(landingSource, /LandingBrowserVaultWarm/u);
  assert.doesNotMatch(landingSource, /startBrowserVaultWarmLoad/u);
});

test("authenticated landing links fetch current dashboard authority on click", () => {
  const authControlsSource = readSource("app/auth-controls.tsx");
  const heroSource = readSource("src/components/homepage/hero-clocks-in.tsx");

  assert.match(authControlsSource, /href="\/home"[\s\S]*?prefetch=\{false\}/u);
  assert.match(heroSource, /href="\/home" prefetch=\{false\}/u);
});

test("the dashboard loading boundary announces progress and respects reduced motion", async () => {
  const { default: DashboardLoading } = await import("../app/(dashboard)/loading");
  const markup = renderToStaticMarkup(createElement(DashboardLoading));

  assert.match(markup, /aria-busy="true"/u);
  assert.match(markup, /aria-live="polite"/u);
  assert.match(markup, /role="status"/u);
  assert.match(markup, />Loading dashboard</u);
  assert.match(markup, /aria-hidden="true"/u);

  const animatedSkeletonCount = markup.match(/animate-pulse/gu)?.length ?? 0;
  const reducedMotionSkeletonCount =
    markup.match(/motion-reduce:animate-none/gu)?.length ?? 0;
  assert.ok(animatedSkeletonCount > 0);
  assert.equal(reducedMotionSkeletonCount, animatedSkeletonCount);
});
