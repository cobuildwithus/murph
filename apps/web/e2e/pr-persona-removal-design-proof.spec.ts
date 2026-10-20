import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`retained Murph style controls without persona selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return ["localhost", "127.0.0.1", "[::1]"].includes(host) ? route.continue() : route.abort();
    });
    await page.goto("/design?tab=components#murph-style-settings", { waitUntil: "load", timeout: 120_000 });
    const surface = page.locator("#murph-style-settings");
    await expect(surface).toContainText("How Murph talks");
    await expect(surface).toContainText("Style levels");
    await expect(surface).toContainText("Voice");
    await expect(surface).not.toContainText("Personality");
    await surface.scrollIntoViewIfNeeded();
    await page.evaluate(async () => { await document.fonts.ready; });
    const output = path.resolve("../../.artifacts/review-gpt/persona-removal");
    await mkdir(output, { recursive: true });
    await surface.screenshot({ path: path.join(output, `settings-${width}.png`), animations: "disabled" });
  });
}
