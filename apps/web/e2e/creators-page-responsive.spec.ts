import { expect, test } from "@playwright/test";

const WIDTHS = [320, 390, 768, 1280] as const;
const OVERFLOW_TOLERANCE_PX = 1;

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  } catch {
    return false;
  }
}

for (const width of WIDTHS) {
  test(`creators page stays contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (route) => {
      if (isLoopbackUrl(route.request().url())) {
        route.continue();
      } else {
        route.abort();
      }
    });

    const response = await page.goto("/creators", { waitUntil: "load" });
    expect(response?.status(), "/creators should respond 200").toBe(200);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Give every member a personal health guide grounded in your work.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Explore a partnership" }).first(),
    ).toBeVisible();

    await page.evaluate(async () => {
      await document.fonts?.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      width: document.documentElement.scrollWidth,
    }));
    expect(layout.width - layout.viewport).toBeLessThanOrEqual(
      OVERFLOW_TOLERANCE_PX,
    );
  });
}
