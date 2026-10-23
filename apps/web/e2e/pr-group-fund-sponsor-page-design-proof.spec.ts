import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`group fund sponsor page at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/screenshots/groups#group-funding-monthly-recovery", { waitUntil: "load" });
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
    const confirmedManagement = { authorizationId: "hgsa_design_recovery", chargedThisPeriodMinor: 500, monthlyCapMinor: 2_000, pendingMonthlyCapMinor: null, pendingThisPeriodMinor: 0, periodEnd: "2026-08-30T16:00:00.000Z", status: "active" };
    await page.route("**/api/design/group-sponsorship-management", (route) => route.fulfill({ body: JSON.stringify({ checkout: { purchaseId: "hucp_design_recovery", status: "fulfilled" }, management: confirmedManagement }), contentType: "application/json", status: 200 }));
    await page.locator('[data-screenshot-category="groups"]').evaluate((element) => element.removeAttribute("inert"));
    await recovery.getByRole("button", { name: "Review payment" }).click();
    await expect(recovery.getByRole("status")).toContainText("Payment confirmedAutomatic refills are on.");
    await recovery.screenshot({ path: path.join(output, `group-fund-payment-confirmed-${width}.png`), style });
  });
}
