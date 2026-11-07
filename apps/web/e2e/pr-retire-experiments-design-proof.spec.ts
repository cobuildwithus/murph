import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.use({ deviceScaleFactor: 3 });

for (const width of [390, 1280]) {
  test(`navigation after experiment retirement at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/design?tab=components#dashboard-primary-navigation-component", { waitUntil: "load", timeout: 120_000 });
    const study = page.locator("#dashboard-primary-navigation-component");
    await study.scrollIntoViewIfNeeded();
    await expect(study).toBeVisible();
    await expect(study.locator('a[href="/experiments"]')).toHaveCount(0);
    await expect(study.locator('a[href="/home"]')).toHaveCount(1);
    await expect(study.getByRole("link", { name: "Devices", includeHidden: true })).toHaveAttribute("href", "/connect");
    await expect(study.getByRole("link", { name: "Settings", includeHidden: true })).toHaveAttribute("href", "/settings");
    await expect(study.locator('a[href="/environment"]')).toHaveCount(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await page.evaluate(() => window.scrollBy(0, -120));
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await study.screenshot({ path: path.join(output, `navigation-${width}.png`), style: "nextjs-portal { visibility: hidden; }" });
    }
    const response = await page.goto("/experiments", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(404);
  });
}
