import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("the dashboard template remounts one provider that revalidates before warm adoption", () => {
  const contextSource = readSource("src/lib/browser-vault/context.tsx");
  const layoutSource = readSource("app/(dashboard)/layout.tsx");
  const templateSource = readSource("app/(dashboard)/template.tsx");

  assert.doesNotMatch(layoutSource, /BrowserVaultProvider/u);
  assert.match(templateSource, /BrowserVaultProvider/u);
  assert.doesNotMatch(templateSource, /getHostedBrowserVaultPageAuthority/u);
  assert.doesNotMatch(templateSource, /authorized=/u);
  assert.doesNotMatch(templateSource, /memberId=/u);
  assert.match(contextSource, /requireFreshAuthority: true/u);
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
    "src/components/home/browser-vault-onboarding-steps.tsx",
    "src/components/biomarkers/biomarker-detail/biomarker-overview.tsx",
  ];

  for (const relativePath of formerWrapperFiles) {
    assert.doesNotMatch(
      readSource(relativePath),
      /BrowserVaultProvider/u,
      `${relativePath} should rely on the dashboard route-group template provider`,
    );
  }
});

test("the landing page only warms the browser vault for authenticated visitors", () => {
  const landingSource = readSource("app/page.tsx");
  assert.match(landingSource, /authenticated \? <LandingBrowserVaultWarm \/> : null/u);
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
