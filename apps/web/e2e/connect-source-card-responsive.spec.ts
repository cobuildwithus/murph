import { expect, test } from "@playwright/test";

const PROOF_VIEWPORTS = [
  { name: "mobile", width: 390 },
  { name: "desktop", width: 1440 },
] as const;
const OVERFLOW_TOLERANCE_PX = 1;

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

test.describe("Mobvoi Health Connect design proof", () => {
  test.use({ deviceScaleFactor: 3 });

  test(
    "the real source card stays complete and contained",
    async ({ page }, testInfo) => {
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
        await page.setViewportSize({ width: viewport.width, height: 1000 });
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
        const cardHeading = study.getByRole("heading", {
          exact: true,
          name: "Mobvoi / TicWatch",
        });
        const card = cardHeading.locator("xpath=../../..");
        const downloadLink = card.locator(
          'a[aria-label="Get Murph for Android for Mobvoi / TicWatch"]',
        );
        const status = card.locator('[data-connection-state]');

        await expect(cardHeading).toHaveCount(1);
        await expect(card).toBeVisible();
        await expect(status).toHaveCount(0);
        await expect(
          card.getByText(
            "Supported TicWatch data through direct Health Connect sharing or a Google Fit fallback.",
            { exact: true },
          ),
        ).toBeVisible();
        const logo = card.locator("img").first();
        await expect(logo).toHaveAttribute("src", /mobvoi-health\.png/u);
        await expect(logo).toHaveClass(/rounded-full/u);
        await expect(downloadLink).toHaveAttribute(
          "href",
          "https://play.google.com/store/apps/details?id=ai.withmurph.app",
        );
        await expect(
          card.getByText(
            "First, enable direct Health Connect sharing in Mobvoi Health if your installed version offers it. Otherwise, enable Google Fit sharing in Mobvoi Health and Sync Fit with Health Connect in Google Fit. Then connect Health Connect in Murph for Android. If no data appears, recheck Mobvoi Health's sharing controls for your version and Health Connect permissions. Categories and history depend on what the apps write.",
            { exact: true },
          ),
        ).toBeVisible();

        const overflowPx = await card.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        );
        expect(
          overflowPx,
          `Mobvoi card should not overflow at ${viewport.width}px`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);

        const screenshotPath = testInfo.outputPath(
          `mobvoi-health-connect-${viewport.name}.png`,
        );
        await card.screenshot({ path: screenshotPath });
        await testInfo.attach(`mobvoi-health-connect-${viewport.name}`, {
          contentType: "image/png",
          path: screenshotPath,
        });
      }
    },
  );
});
