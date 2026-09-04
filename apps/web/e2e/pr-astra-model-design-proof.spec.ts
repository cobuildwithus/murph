import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("Max model choice shows Astra on phone and desktop", async ({ browser }) => {
  const outputDir = process.env.DESIGN_PROOF_OUTPUT_DIR;
  test.skip(!outputDir, "Dedicated model-choice design proof");
  if (!outputDir) return;
  test.setTimeout(300_000);
  await mkdir(outputDir, { recursive: true });
  for (const width of [390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "no-preference",
    });
    try {
      const page = await context.newPage();
      const hydrationErrors: string[] = [];
      page.on("console", (message) => {
        if (/hydration|hydrated|server rendered HTML/i.test(message.text())) {
          hydrationErrors.push(message.text());
        }
      });
      await page.route("**/*", (route) => {
        const hostname = new URL(route.request().url()).hostname;
        return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
          ? route.continue() : route.abort();
      });
      await page.goto("/screenshots/settings#settings-model-provider-save-controls", { waitUntil: "load" });
      const study = page.locator("#settings-model-provider-save-controls");
      await expect(study).toBeVisible();
      await expect(study.getByText("Astra", { exact: true })).toBeVisible();
      await expect(study.getByText("Highest usage", { exact: true })).toBeVisible();
      await expect(study.locator('[id="assistant-model-gpt-6-astra"]')).toBeEnabled();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const bounds = await study.boundingBox();
      expect(bounds?.width).toBeLessThanOrEqual(width);
      const artwork = study.locator('[data-model-artwork="astra"]');
      await expect.poll(() => artwork.evaluate((element) =>
        element.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
      )).toBeGreaterThan(0);
      await study.screenshot({ path: path.join(outputDir, `astra-models-${width}.png`) });
      await artwork.scrollIntoViewIfNeeded();
      const star = artwork.locator('[data-depth="2"]').nth(2);
      const resting = await star.boundingBox();
      expect(resting).not.toBeNull();
      await page.mouse.move(resting!.x - 8, resting!.y);
      await expect.poll(async () => (await star.boundingBox())!.x - resting!.x).toBeGreaterThan(5);
      await page.mouse.move(0, 0);
      await expect.poll(async () => Math.abs((await star.boundingBox())!.x - resting!.x)).toBeLessThan(0.5);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => artwork.evaluate((element) =>
        element.getAnimations({ subtree: true }).length,
      )).toBe(0);
      await page.mouse.move(resting!.x - 8, resting!.y);
      await page.waitForTimeout(200);
      expect(Math.abs((await star.boundingBox())!.x - resting!.x)).toBeLessThan(0.5);
      await expect(study.locator('[id="assistant-model-gpt-6-astra"]')).toBeEnabled();
      await study.screenshot({ path: path.join(outputDir, `astra-models-${width}-reduced-motion.png`) });
      expect(hydrationErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
