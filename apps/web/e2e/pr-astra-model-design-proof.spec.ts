import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("Premium model choice shows Astra on phone and desktop", async ({ browser }) => {
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
      const displacements: number[] = [];
      for (const depth of [0, 1, 2]) {
        const star = artwork.locator(`[data-depth="${depth}"]`).nth(2);
        const resting = (await star.boundingBox())!;
        await page.mouse.move(resting.x - 24, resting.y);
        await expect.poll(async () => resting.x - (await star.boundingBox())!.x).toBeGreaterThan(0.8);
        await page.waitForTimeout(750);
        displacements.push(resting.x - (await star.boundingBox())!.x);
        await page.mouse.move(0, 0);
        await expect.poll(async () => Math.abs((await star.boundingBox())!.x - resting.x)).toBeLessThan(0.1);
      }
      expect(Math.max(...displacements) - Math.min(...displacements)).toBeLessThan(0.5);
      expect(Math.max(...displacements)).toBeLessThan(3);
      await artwork.evaluate((element) => {
        const rotation = element.getAnimations({ subtree: true }).find((animation) =>
          animation instanceof CSSAnimation && animation.animationName.includes("galaxy-rotation"));
        if (!rotation) throw new Error("Galaxy rotation is missing");
        rotation.pause();
        rotation.currentTime = 60_000;
      });
      const rotatedStar = artwork.locator('[data-depth]').nth(100);
      const rotatedResting = (await rotatedStar.boundingBox())!;
      await page.mouse.move(rotatedResting.x - 24, rotatedResting.y);
      await expect.poll(async () => rotatedResting.x - (await rotatedStar.boundingBox())!.x).toBeGreaterThan(0.8);
      await page.mouse.move(0, 0);
      await expect.poll(async () => Math.abs((await rotatedStar.boundingBox())!.x - rotatedResting.x)).toBeLessThan(0.1);
      await artwork.evaluate((element) => {
        for (const animation of element.getAnimations({ subtree: true })) animation.play();
      });
      const star = artwork.locator('[data-depth="2"]').nth(2);
      const resting = (await star.boundingBox())!;
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => artwork.evaluate((element) =>
        element.getAnimations({ subtree: true }).length,
      )).toBe(0);
      await page.mouse.move(resting!.x - 24, resting!.y);
      await page.waitForTimeout(200);
      expect(Math.abs((await star.boundingBox())!.x - resting!.x)).toBeLessThan(0.5);
      await expect(study.locator('[id="assistant-model-gpt-6-astra"]')).toBeEnabled();
      await study.screenshot({ path: path.join(outputDir, `astra-models-${width}-reduced-motion.png`) });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      const disabledStudy = page.locator('[data-design-variant="venice-terra-sol-locked"]');
      const disabledArtwork = disabledStudy.locator('[data-model-artwork="astra"]');
      const disabledRadio = disabledStudy.locator('[id="assistant-model-gpt-6-astra"]');
      await expect(disabledRadio).toBeDisabled();
      // Exercise native pointer targeting and disabled controls outside the inert study shell.
      await disabledArtwork.evaluate((element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          parent.removeAttribute("inert");
        }
      });
      await disabledArtwork.scrollIntoViewIfNeeded();
      const disabledStar = disabledArtwork.locator('[data-depth="0"]').nth(2);
      const disabledResting = (await disabledStar.boundingBox())!;
      await page.mouse.move(disabledResting.x - 24, disabledResting.y);
      await expect.poll(async () => disabledResting.x - (await disabledStar.boundingBox())!.x).toBeGreaterThan(0.8);
      await page.mouse.click(disabledResting.x - 24, disabledResting.y);
      await expect(disabledRadio).not.toBeChecked();
      await expect(disabledStudy.locator('[id="assistant-model-gpt-5.6-terra"]')).toBeChecked();
      await page.mouse.move(0, 0);
      await expect.poll(async () => Math.abs((await disabledStar.boundingBox())!.x - disabledResting.x)).toBeLessThan(0.1);
      expect(hydrationErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }
});
