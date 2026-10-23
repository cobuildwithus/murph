import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`group fund sponsor page at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/screenshots/groups", { waitUntil: "load" });
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    const study = page.locator('[data-design-study="group-usage-funding"]');
    const recovery = study.locator('[data-design-state="monthly-recovery"]');
    await expect(recovery.getByRole("heading", { level: 1 })).toHaveText("Support Murph inSunday sleep crew");
    await expect(recovery).toContainText("Payment needs attention");
    await expect(recovery).toContainText("3 one-time contributions");
    await expect(recovery).toContainText("$0 charged this month · Resets Aug 30, 2026");
    await expect(recovery.getByRole("button", { name: "$20", pressed: true })).toBeVisible();
    await expect(recovery.getByRole("button", { name: "Make a one-time contribution" })).toHaveCount(0);
    for (const state of ["monthly-recovery", "ordinary-sponsored-one-time", "monthly-active"]) {
      const surface = study.locator(`[data-design-state="${state}"]`);
      expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (!output) return;
    await mkdir(output, { recursive: true });
    const style = "nextjs-portal { visibility: hidden; }";
    for (const state of ["monthly-recovery", "ordinary-sponsored-one-time", "monthly-active"]) {
      await study.locator(`[data-design-state="${state}"]`).screenshot({ path: path.join(output, `group-fund-${state}-${width}.png`), style });
    }
  });
}
