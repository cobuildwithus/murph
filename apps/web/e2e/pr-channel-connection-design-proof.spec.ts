import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`connected-channel recovery at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/*", (route) => {
      const hostname = new URL(route.request().url()).hostname;
      return ["127.0.0.1", "localhost", "[::1]"].includes(hostname)
        ? route.continue() : route.abort();
    });
    const response = await page.goto("/screenshots/channel-connection", {
      waitUntil: "load", timeout: 120_000,
    });
    expect(response?.status()).toBe(200);
    const study = page.locator('[data-design-section="channel-connection"]');
    await expect(study).toBeVisible();
    const settings = study.locator('[data-channel-state="settings"]');
    await expect(settings.locator('a[href^="sms:"]')).toHaveText("Text Murph");
    await expect(settings.locator('a[href^="mailto:"]')).toHaveText("Email Murph");
    await expect(settings.getByText("Change", { exact: true })).toHaveCount(2);
    const retry = study.locator('[data-channel-state="retry"]');
    await expect(retry.locator("input")).toHaveValue("connected@example.test");
    await expect(retry.locator("input")).toBeDisabled();
    await expect(retry.locator("button")).toHaveText("Retry saving");
    const saving = study.locator('[data-channel-state="saving"]');
    await expect(saving.locator("button")).toHaveText("Saving...");
    await expect(saving.locator("button")).toBeDisabled();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      document.querySelectorAll("nextjs-portal").forEach((portal) => portal.remove());
    });
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      for (const state of ["settings", "retry", "saving"]) {
        const surface = study.locator(`[data-channel-state="${state}"]`);
        await surface.scrollIntoViewIfNeeded();
        expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await surface.screenshot({
          animations: "disabled", path: path.join(output, `${state}-${width}.png`),
        });
      }
    }
  });
}
