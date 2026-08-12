import { expect, test } from "@playwright/test";

const PROOF_VIEWPORTS = [
  { name: "mobile", width: 390 },
  { name: "desktop", width: 1440 },
] as const;
const OVERFLOW_TOLERANCE_PX = 1;

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "127.0.0.1"
      || hostname === "localhost"
      || hostname === "[::1]";
  } catch {
    return false;
  }
}

test.describe("member-owned provider setup design proof", () => {
  test.use({ deviceScaleFactor: 3 });

  test("the real source card keeps prerequisite and disconnect ownership safe", async ({
    page,
  }, testInfo) => {
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
        "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}nextjs-portal{display:none!important}";
      (document.head ?? document.documentElement).appendChild(style);
    });

    for (const viewport of PROOF_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: 1000 });
      const response = await page.goto(
        `/design?tab=sections&proofViewport=${viewport.name}#connect-source-card-actions`,
        { waitUntil: "load" },
      );
      expect(response?.status()).toBe(200);
      await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });

      const study = page.locator(
        '[data-design-study="connect-source-card-actions"]',
      );
      const stravaHeadings = study.getByRole("heading", {
        exact: true,
        name: "Strava",
      });
      await expect(stravaHeadings).toHaveCount(2);

      const prerequisiteCard = stravaHeadings.nth(0).locator("xpath=../../..");
      const disconnectCard = stravaHeadings.nth(1).locator("xpath=../../..");
      await expect(prerequisiteCard.getByRole("button", {
        name: "Continue in Strava for Strava",
      })).toHaveCount(1);
      await expect(prerequisiteCard.getByRole("button", {
        name: "Cancel setup for Strava",
      })).toHaveCount(1);
      await expect(disconnectCard.getByRole("button", {
        name: "Disconnect Strava first",
      })).toHaveCount(1);
      await expect(disconnectCard.getByRole("button")).toHaveCount(1);

      for (const [state, card] of [
        ["prerequisite", prerequisiteCard],
        ["disconnect-first", disconnectCard],
      ] as const) {
        await expect(card).toBeVisible();
        const overflowPx = await card.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        );
        expect(overflowPx).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

        await page.locator("nextjs-portal").evaluateAll((elements) => {
          for (const element of elements) {
            element.remove();
          }
        });
        const screenshotPath = testInfo.outputPath(
          `member-owned-provider-${state}-${viewport.name}.png`,
        );
        await card.screenshot({ path: screenshotPath });
        await testInfo.attach(
          `member-owned-provider-${state}-${viewport.name}`,
          { contentType: "image/png", path: screenshotPath },
        );
      }
    }
  });
});
