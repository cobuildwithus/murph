import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1280]) {
  test(`reusable voice components at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.route("**/*", (route) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort());
    await page.goto("/screenshots/voice#live-voice-components");
    const examples = page.getByRole("region", { name: "Reusable orb examples" });
    await expect(examples).toBeVisible();
    const standalone = examples.locator("canvas").first();
    await expect(standalone).toHaveCSS("width", "72px");
    await expect(examples.getByRole("button", { name: "Start conversation" })).toHaveCSS("width", "80px");
    await expect(examples.locator('img[src="/design/voice-orb/ember.png"]')).toHaveCount(1);
    await expect(page.getByRole("radio", { name: "Willow Irish", exact: true }).first()).toBeChecked();
    await expect(page.getByRole("radio", { name: "Marin Original GPT-Live voice", exact: true }).last()).toBeDisabled();
    await expect(page.locator("#live-voice-components").getByRole("alert")).toContainText("Allow microphone access");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const assistant = page.locator("section").filter({ has: page.getByRole("heading", { name: "Assistant speaking", exact: true }) });
    await assistant.scrollIntoViewIfNeeded();
    const canvas = assistant.locator("canvas");
    await expect(canvas).toHaveCSS("opacity", "1");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    // The production control respects reduced motion even with active audio props.
    await expect(assistant.locator("button[data-speaker] > span")).toHaveCSS("transform", "none");
    const still = await canvas.screenshot();
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(still)).toBe(true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(assistant.locator("button[data-speaker] > span")).toHaveCSS("transform", "matrix(1.06, 0, 0, 1.06, 0, 0)");
    const moving = await canvas.screenshot();
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(moving)).toBe(false);

    if (process.env.DESIGN_PROOF_OUTPUT_DIR) {
      await mkdir(process.env.DESIGN_PROOF_OUTPUT_DIR, { recursive: true });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await examples.scrollIntoViewIfNeeded();
      await examples.screenshot({ path: path.join(process.env.DESIGN_PROOF_OUTPUT_DIR, `voice-components-${width}.png`) });
    }
  });
}
