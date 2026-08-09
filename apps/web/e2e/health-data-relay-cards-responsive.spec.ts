import { expect, test } from "@playwright/test";

const RELAY_SOURCE_NAMES = [
  "Health Connect",
  "Samsung Health",
  "Mobvoi / TicWatch",
  "Wyze Scale",
  "Eufy Smart Scale / eufyLife",
  "VeSync / Etekcity",
  "A&D Heart Track",
  "Microlife Connected Health+",
] as const;
const ANDROID_RELAY_SOURCE_NAMES = new Set<string>([
  "Health Connect",
  "Samsung Health",
  "Mobvoi / TicWatch",
]);
const PROOF_VIEWPORTS = [
  { name: "mobile", width: 390 },
  { name: "desktop", width: 1440 },
] as const;
const OVERFLOW_TOLERANCE_PX = 1;

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return (
      hostname === "127.0.0.1"
      || hostname === "localhost"
      || hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

test.describe("health data relay source catalog", () => {
  test.use({ deviceScaleFactor: 2 });

  test("every relay card stays complete and contained", async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    await page.route("**/*", (route) => {
      if (isLoopbackUrl(route.request().url())) {
        route.continue();
      } else {
        route.abort();
      }
    });
    await page.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent =
        "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}";
      (document.head ?? document.documentElement).appendChild(style);
    });

    for (const viewport of PROOF_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: 1200 });
      const response = await page.goto(
        `/design?tab=sections&proofViewport=${viewport.name}#connect-source-card-actions`,
        { waitUntil: "load" },
      );
      expect(
        response?.status(),
        `/design should respond 200 at ${viewport.width}px`,
      ).toBe(200);
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });

      const study = page.locator(
        '[data-design-study="connect-source-card-actions"]',
      );

      for (const sourceName of RELAY_SOURCE_NAMES) {
        const heading = study.getByRole("heading", {
          exact: true,
          name: sourceName,
        });
        const card = heading.locator("xpath=../../..");
        const downloadLink = card.locator(
          `a[aria-label="Download app for ${sourceName}"]`,
        );

        await expect(heading).toHaveCount(1);
        await expect(card).toBeVisible();
        await expect(downloadLink).toHaveAttribute(
          "href",
          ANDROID_RELAY_SOURCE_NAMES.has(sourceName)
            ? "https://play.google.com/store/apps/details?id=ai.withmurph.app"
            : "https://apps.apple.com/us/app/murph-ai/id6786145859",
        );

        const overflowPx = await card.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        );
        expect(
          overflowPx,
          `${sourceName} should not overflow at ${viewport.width}px`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
      }

      const screenshotPath = testInfo.outputPath(
        `health-data-relay-catalog-${viewport.name}.png`,
      );
      await study.screenshot({ path: screenshotPath });
      await testInfo.attach(`health-data-relay-catalog-${viewport.name}`, {
        contentType: "image/png",
        path: screenshotPath,
      });
    }
  });
});
