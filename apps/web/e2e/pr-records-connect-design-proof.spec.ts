import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`records provider search at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/screenshots/health#clinical-records", { waitUntil: "load", timeout: 120_000 });
    const study = page.locator("#clinical-records");
    await expect(study).toHaveAttribute("data-preview-ready", "true");
    const search = study.locator("section").first();
    await search.scrollIntoViewIfNeeded();
    await expect(search.getByText("Cleveland Clinic", { exact: true })).toBeVisible();
    await expect(search.locator("img").first()).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const box = await search.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await search.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await study.evaluate((element) => {
      let ancestor: Element | null = element;
      while (ancestor) { ancestor.removeAttribute("inert"); ancestor = ancestor.parentElement; }
    });
    const input = search.getByRole("textbox", { name: "Hospital or clinic" });
    const rows = search.getByRole("button", { name: /Continue to/ });
    await input.focus();
    await expect(input).toBeFocused();
    await input.press("ArrowDown");
    await expect(rows.nth(0)).toBeFocused();
    await rows.nth(0).press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    await rows.nth(1).press("ArrowUp");
    await rows.nth(0).press("ArrowUp");
    await expect(input).toBeFocused();
    await input.blur();
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await search.screenshot({ path: path.join(output, `provider-search-${width}.png`), style: "nextjs-portal { visibility: hidden; }" });
    }
  });
}
