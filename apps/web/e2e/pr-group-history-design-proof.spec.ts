import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`group history consent at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/screenshots/groups#group-join", { waitUntil: "load" });
    await page.locator('[data-design-study="group-join"]').evaluate((element) => element.removeAttribute("inert"));
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    const upgrade = page.locator('[data-design-state="group-join-history-upgrade"]');
    const choices = upgrade.getByRole("checkbox");
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toBeChecked();
    await expect(choices.nth(1)).not.toBeChecked();
    await expect(upgrade).toContainText("90 days");
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await upgrade.screenshot({ path: path.join(output, `history-existing-${width}.png`) });
    }
    await choices.nth(1).check();
    await expect(choices.nth(1)).toBeChecked();
    const fresh = page.locator('[data-design-state="group-join-comprehensive-default"]');
    await expect(fresh).toContainText("90 days");
    for (const choice of await fresh.getByRole("checkbox").all()) await expect(choice).toBeChecked();
    for (const surface of [upgrade, fresh]) {
      expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    if (output) await fresh.screenshot({ path: path.join(output, `history-new-${width}.png`) });
  });
}
