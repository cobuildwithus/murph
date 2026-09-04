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
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
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
      await study.screenshot({ path: path.join(outputDir, `astra-models-${width}.png`), animations: "disabled" });
    } finally {
      await context.close();
    }
  }
});
