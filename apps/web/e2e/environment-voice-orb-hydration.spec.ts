import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test.describe(`Environment listening orb at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });

    test("hydrates with consistent SVG coordinates", async ({ page }) => {
      test.setTimeout(180_000);
      const hydrationErrors: string[] = [];
      page.on("console", (message) => {
        if (/hydration|hydrated|server rendered HTML/i.test(message.text()) &&
            /VoiceActivityOrb/.test(message.text())) {
          hydrationErrors.push("VoiceActivityOrb hydration mismatch");
        }
      });
      await page.route("**/*", (route) => {
        const hostname = new URL(route.request().url()).hostname;
        return ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
          ? route.continue() : route.abort();
      });
      await page.goto("/screenshots/health#environment-progressive-capture", { waitUntil: "load" });
      const orb = page.locator('#environment-progressive-capture svg[viewBox="0 0 40 40"]');
      await expect(orb).toHaveCount(1);
      await expect(orb.locator("circle")).toHaveCount(19);
      await expect.poll(() => orb.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactFiber$")),
      )).toBe(true);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await expect(orb.locator("..")).toHaveAttribute("aria-hidden", "true");
      // React can leave mismatched server attributes untouched without logging.
      // Compare the real markup to the coordinates React computed during hydration.
      const coordinates = await orb.locator("circle").evaluateAll((elements) =>
        elements.flatMap((element) => {
          const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
          if (!propsKey) throw new Error("Expected a hydrated orb circle.");
          const props = Reflect.get(element, propsKey);
          return ["cx", "cy"].map((attribute) => ({
            markup: element.getAttribute(attribute),
            hydrated: String(Reflect.get(props, attribute)),
          }));
        }),
      );
      for (const coordinate of coordinates) {
        expect(coordinate.markup).toBe(coordinate.hydrated);
      }
      expect(hydrationErrors).toEqual([]);
      const outputDir = process.env.DESIGN_PROOF_OUTPUT_DIR;
      if (outputDir) {
        await mkdir(outputDir, { recursive: true });
        await orb.locator("../../..").screenshot({ path: path.join(outputDir, `voice-orb-${width}.png`) });
      }
    });
  });
}
