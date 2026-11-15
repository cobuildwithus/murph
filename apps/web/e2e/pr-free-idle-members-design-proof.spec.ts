import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 900, 1440]) {
  test(`free idle member usage at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/screenshots/ops#ops-free-idle-members", { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    for (const state of ["ops-free-idle-members", "ops-free-idle-members-empty"]) {
      const surface = page.locator(`#${state}`);
      await expect(surface).toContainText("Free, no games, devices or groups");
      await expect(surface).toContainText(state.endsWith("empty") ? "No one right now." : "$10.94");
      expect(await surface.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      if (!state.endsWith("empty")) {
        const row = width >= 1280 ? surface.locator("tbody tr").first() : surface.locator("article").first();
        await expect(row).toBeVisible();
        await expect(row.getByRole("button", { name: "Suspend for hbm_design_free_01", includeHidden: true })).toBeVisible();
      }
      const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
      if (output) {
        await mkdir(output, { recursive: true });
        await surface.screenshot({ path: path.join(output, `${state}-${width}.png`), style: "nextjs-portal { visibility: hidden; }" });
      }
    }
  });
}
