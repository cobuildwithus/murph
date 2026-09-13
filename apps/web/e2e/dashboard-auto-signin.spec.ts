import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["127.0.0.1", "localhost"].includes(host)
      ? route.continue() : route.abort();
  });
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 1000 },
]) {
  test(`dashboard entry opens usable sign-in at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(viewport);
    await page.goto("/patterns", { waitUntil: "load", timeout: 120_000 });
    const dialog = page.getByRole("dialog", { name: "Log in or sign up" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[type="tel"]')).toBeVisible();
    await expect.poll(() => dialog.evaluate((element) =>
      element.contains(document.activeElement))).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    if (process.env.DESIGN_PROOF_OUTPUT_DIR) {
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await mkdir(process.env.DESIGN_PROOF_OUTPUT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(process.env.DESIGN_PROOF_OUTPUT_DIR, `dashboard-signin-${viewport.width}.png`),
      });
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Patterns", exact: true })).toBeVisible();
    if (viewport.width >= 1024) {
      await page.locator('a[href="/home"]').first().click();
    } else {
      await page.goto("/home");
    }
    await expect(dialog).toBeVisible();
  });
}

test("public pages do not automatically open sign-in", async ({ page }) => {
  await page.goto("/changelog", { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "What’s new with Murph", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
