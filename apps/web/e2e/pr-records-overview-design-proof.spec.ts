import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`records overview and connection controls at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto("/screenshots/health#records-overview", { waitUntil: "load", timeout: 120_000 });
    const study = page.locator("#records-overview");
    await expect(page.locator("#clinical-records")).toHaveAttribute("data-preview-ready", "true");
    await study.scrollIntoViewIfNeeded();
    await expect(study.getByText("Northstar Health", { exact: true })).toBeVisible();
    await expect(study.getByText("Import incomplete", { exact: true })).toBeVisible();
    await expect(study.getByText("248 records added", { exact: true })).toBeVisible();
    await expect(study.getByRole("link", { name: "View lab results" })).toHaveAttribute("href", "/biomarkers");
    await expect(study.getByRole("link", { name: "Import again" })).toHaveAttribute("href", "/records/connect?launch=clinical-records");
    await expect(study.getByRole("button", { name: "Disconnect", exact: true })).toBeHidden();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const box = await study.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await study.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await study.screenshot({ path: path.join(output, `records-${width}.png`), style: "nextjs-portal { visibility: hidden; }" });
    }
    await study.evaluate((element) => {
      let ancestor: Element | null = element;
      while (ancestor) { ancestor.removeAttribute("inert"); ancestor = ancestor.parentElement; }
    });
    const details = study.locator("summary").filter({ hasText: "Import details" });
    await details.focus();
    await details.press("Enter");
    await expect(study.getByText("One-time import.", { exact: true })).toBeVisible();
    await expect(study.getByText(/12 items saved for reference/)).toBeVisible();
    await study.getByRole("button", { name: "Disconnect", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Disconnect Northstar Health?" })).toBeVisible();
    await expect(dialog.getByText(/Records already saved in your vault stay there/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(study.getByText("Import incomplete", { exact: true })).toBeVisible();
    const privacy = study.locator("summary").filter({ hasText: "Your records, your control" });
    await privacy.focus();
    await privacy.press("Enter");
    await expect(study.getByRole("link", { name: "How Murph uses your data" })).toBeVisible();
  });
}
