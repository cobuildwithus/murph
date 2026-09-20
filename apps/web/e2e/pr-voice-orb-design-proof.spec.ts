import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.use({ actionTimeout: 10_000 });

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort());
});

for (const width of [390, 1280]) {
  test(`voice orb playground at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/design?tab=voice-orb");
    const study = page.locator("#voice-orb");
    const orb = page.getByRole("button", { name: "Activate orb demo" });
    const canvas = orb.locator("canvas");
    await expect(study).toBeVisible();
    await expect(canvas).toHaveCSS("opacity", "1");
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const before = await canvas.screenshot();
    await orb.click();
    await expect(orb).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "Awake" })).toBeVisible();
    const moving = await canvas.screenshot();
    expect(moving.equals(before)).toBe(false);
    await page.getByRole("radio", { name: "Ember" }).check();
    await page.getByRole("button", { name: "Dark surface" }).click();
    await expect(page.getByRole("button", { name: "Light surface" })).toBeVisible();
    await page.getByRole("slider", { name: "Size" }).press("End");
    await expect(page.getByRole("slider", { name: "Size" })).toHaveValue("280");
    await page.getByRole("slider", { name: "Drift" }).press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Drift" })).toHaveValue("0.8");
    await page.getByRole("slider", { name: "Cloud detail" }).press("End");
    await expect(page.getByRole("slider", { name: "Cloud detail" })).toHaveValue("1");
    await orb.scrollIntoViewIfNeeded();
    const orbBounds = await orb.boundingBox();
    const captionBounds = await page.getByRole("status").filter({ hasText: "Awake" }).boundingBox();
    expect(orbBounds).not.toBeNull();
    expect(captionBounds).not.toBeNull();
    expect(orbBounds!.y + orbBounds!.height).toBeLessThan(captionBounds!.y);
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await study.screenshot({ path: path.join(output, `voice-orb-${width}-ember.png`) });
    }
    await page.getByRole("button", { name: "Pause motion" }).click();
    await expect(page.getByRole("button", { name: "Resume motion" })).toHaveAttribute("aria-pressed", "true");
    await orb.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const paused = await canvas.screenshot();
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(paused)).toBe(true);
    await page.getByRole("button", { name: "Resume motion" }).click();
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Iris" })).toBeChecked();
    await expect(page.getByRole("slider", { name: "Size" })).toHaveValue("200");
    await expect(orb).toHaveAttribute("aria-pressed", "false");
    await orb.focus();
    await page.keyboard.press("Space");
    await expect(orb).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(orb).toHaveAttribute("aria-pressed", "false");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const still = await canvas.screenshot();
    await page.waitForTimeout(150);
    expect((await canvas.screenshot()).equals(still)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (output) {
      await mkdir(output, { recursive: true });
      await study.screenshot({ path: path.join(output, `voice-orb-${width}.png`) });
    }
  });
}

test("orb remains usable when graphics are unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await page.goto("/design?tab=voice-orb");
  const orb = page.getByRole("button", { name: "Activate orb demo" });
  await expect(orb).toBeVisible();
  await expect(orb.locator("canvas")).toHaveCSS("opacity", "0");
  await orb.click();
  await expect(orb).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("radio", { name: "Sage" }).check();
  await expect(page.getByRole("radio", { name: "Sage" })).toBeChecked();
});

test("orb restores rendering after graphics context loss", async ({ page }) => {
  await page.goto("/design?tab=voice-orb");
  const canvas = page.locator("#voice-orb canvas");
  await expect(canvas).toHaveCSS("opacity", "1");
  await canvas.evaluate((element: HTMLCanvasElement) => {
    const extension = element.getContext("webgl")?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Context-loss extension unavailable");
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 500);
  });
  await expect(canvas).toHaveCSS("opacity", "0");
  await expect(canvas).toHaveCSS("opacity", "1");
});
