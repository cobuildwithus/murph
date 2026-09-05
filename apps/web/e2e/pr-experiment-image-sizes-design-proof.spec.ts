import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [412, 1440]) {
  test(`experiment image selection at ${width}px`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      baseURL, viewport: { width, height: 900 },
      deviceScaleFactor: width === 412 ? 2.625 : 1,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        return ["127.0.0.1", "localhost"].includes(host)
          ? route.continue() : route.abort();
      });
      expect((await page.goto("/experiments", { waitUntil: "load", timeout: 90_000 }))?.status()).toBe(200);
      const cards = page.locator('a[href^="/experiments/"]').filter({ has: page.locator("img") });
      await expect(cards.first()).toBeVisible();
      await cards.nth(5).scrollIntoViewIfNeeded();
      await page.waitForTimeout(2_000);
      const images = await cards.locator("img").evaluateAll((elements) => elements.slice(0, 6).map((node) => {
        const img = node as HTMLImageElement;
        return {
          source: new URL(img.currentSrc).searchParams.get("url"),
          selectedWidth: Number(new URL(img.currentSrc).searchParams.get("w")),
          renderedWidth: img.getBoundingClientRect().width,
          dpr: devicePixelRatio,
          sizes: img.sizes,
          loaded: img.complete && img.naturalWidth > 0,
        };
      }));
      expect(images).toHaveLength(6);
      for (const image of images) {
        expect(image.loaded).toBe(true);
        expect(image.selectedWidth).toBeGreaterThanOrEqual(image.renderedWidth * image.dpr);
        if (width === 412) expect(image.selectedWidth).toBe(1080);
      }
      await cards.first().scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
      if (output) {
        await mkdir(output, { recursive: true });
        await cards.first().screenshot({ path: path.join(output, `experiment-${width}.png`) });
        await writeFile(path.join(output, `images-${width}.json`), JSON.stringify(images, null, 2));
      }
    } finally {
      await context.close();
    }
  });
}
