import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`game recovery at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    for (const [url, selector, copy] of [
      ["/screenshots/account#settings-account-auth-required-section", "#settings-account-auth-required-section", "Sign in to manage your account and health data consent."],
      ["/screenshots/groups#game-invite-cancelled", "#game-invite-cancelled", "Player called this one off. Ask for a new link."],
    ]) {
      await page.goto(url, { waitUntil: "load" });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      const surface = page.locator(selector);
      await expect(surface).toContainText(copy);
      expect(await surface.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
      if (output) {
        await mkdir(output, { recursive: true });
        await surface.screenshot({ path: path.join(output, `${selector.slice(1)}-${width}.png`), style: "nextjs-portal { visibility: hidden; }" });
      }
    }
    await page.goto("/settings#data-privacy", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Continue to Settings", includeHidden: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/settings");
  });
}
