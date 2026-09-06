import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("patterns fit phones and retain measure selection, sorting and details", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["127.0.0.1", "localhost"].includes(host)
      ? route.continue() : route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/design?tab=components#personal-patterns-component", { waitUntil: "load", timeout: 120_000 });
  const study = page.locator('[data-design-component="personal-patterns"]');
  await expect(study).toBeVisible();
  // The catalog is inert for safe presentation; this synthetic study has no writes.
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-patterns-layout="mobile"] select');
    return element && Object.keys(element).some((key) => key.startsWith("__reactFiber$"));
  });
  await study.evaluate((element) => {
    let ancestor: Element | null = element;
    while (ancestor) {
      ancestor.removeAttribute("inert");
      ancestor = ancestor.parentElement;
    }
  });
  const populated = study.locator("section[aria-labelledby]");
  const mobile = populated.locator('[data-patterns-layout="mobile"]');
  await expect(mobile).toBeVisible();
  await expect(mobile.locator("li")).toHaveCount(15);
  const measure = mobile.getByLabel("Health measure");
  await measure.selectOption({ label: "Sleep quality" });
  await expect(mobile.getByRole("list", { name: "Sleep quality patterns" })).toBeVisible();
  const sort = mobile.getByRole("button", { name: "Sort by Sleep quality, descending", exact: true });
  await sort.click();
  await expect(mobile.getByRole("button", { name: "Sort by Sleep quality, ascending", exact: true })).toBeVisible();
  await measure.selectOption({ label: "HRV" });
  const result = mobile.locator('[data-pattern-factor-row="running"] button[data-pattern-state="effect"]');
  await result.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("running");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await populated.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(mobile.locator("li")).toHaveCount(19);
  await populated.getByRole("button", { name: "Show less", exact: true }).click();
  await expect(mobile.locator("li")).toHaveCount(15);

  for (const width of [320, 390, 640, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await populated.scrollIntoViewIfNeeded();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const layout = width < 640 ? mobile : populated.locator('[data-patterns-layout="desktop"]');
    await expect(layout).toBeVisible();
    if (width < 640) {
      expect(await mobile.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const bounds = await result.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await populated.screenshot({
        path: path.join(output, `patterns-${width}.png`),
        style: "nextjs-portal, main > .sticky { visibility: hidden !important; }",
      });
    }
  }
});
