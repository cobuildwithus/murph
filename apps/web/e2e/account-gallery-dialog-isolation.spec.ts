import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [412, 1440]) {
  test(`account studies isolate recovery dialogs at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return ["127.0.0.1", "localhost"].includes(host)
        ? route.continue() : route.abort();
    });
    await page.goto("/screenshots/account", { waitUntil: "load", timeout: 120_000 });
    await page.waitForLoadState("networkidle");

    for (const scenario of [
      {
        state: "usage-recovery-family-owner",
        trigger: "Upgrade to Edge",
        title: "Upgrade your Family access",
      },
      {
        state: "usage-recovery-family-sponsored",
        trigger: "Ask your Family owner",
        title: "Your Family owner controls the plan",
      },
    ]) {
      const study = page.locator(`[data-design-state="${scenario.state}"]`);
      // Catalog controls stay inert. Enable this synthetic study through its
      // inert ancestors without invoking any billing action.
      await study.locator("[inert]").evaluate((element) => {
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          ancestor.removeAttribute("inert");
        }
      });
      await study.getByRole("button", { name: scenario.trigger, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: scenario.title, exact: true });
      await expect(dialog).toBeVisible();
      await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(page.locator('[data-slot="dialog-overlay"][data-open]')).toHaveCount(0);
    }

    // The click-open assertions above prove hydration, so this cannot pass
    // merely because eager portals have not mounted yet.
    const target = page.locator('[data-design-section="settings-auth-required-payment-return"]');
    await expect(target).toBeVisible();
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    if (process.env.DESIGN_PROOF_OUTPUT_DIR) {
      await mkdir(process.env.DESIGN_PROOF_OUTPUT_DIR, { recursive: true });
      await target.screenshot({
        path: path.join(process.env.DESIGN_PROOF_OUTPUT_DIR, `account-settings-${width}.png`),
        animations: "disabled",
        style: "nextjs-portal { visibility: hidden !important; }",
      });
    }
  });
}
