import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("pattern cards show every measure on phones and retain result details", async ({ page }) => {
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
    const element = document.querySelector('[data-patterns-layout="mobile"] button');
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
  await expect(mobile.locator("select")).toHaveCount(0);
  const running = mobile.locator('[data-pattern-factor-row="running"]');
  await expect(running.getByRole("heading", { name: "Running", exact: true })).toBeVisible();
  await expect(running.locator("dt")).toHaveText([
    "HRV", "Sleep duration", "Resting heart rate", "Readiness score", "Deep sleep",
    "Respiratory rate", "Sleep quality", "SpO₂",
  ]);
  const result = running.getByRole("button", { name: /^Your HRV was higher after running/ });
  await result.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("running");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(running.getByText("No clear change", { exact: true }).first()).toBeVisible();
  const sparse = mobile.locator('[data-pattern-factor-row="housework"]');
  const pending = sparse.locator("details");
  await expect(pending).not.toHaveAttribute("open", "");
  await pending.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(pending).toHaveAttribute("open", "");
  await pending.getByRole("button", { name: /^Not enough comparable data/ }).first().click();
  await expect(page.getByRole("dialog")).toContainText("No comparable days");
  await page.keyboard.press("Escape");
  await pending.locator("summary").click();
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
      expect(await mobile.locator("li").evaluateAll((cards) => cards.every((card) => {
        const bounds = card.getBoundingClientRect();
        return Array.from(card.querySelectorAll("button")).every((button) => {
          const target = button.getBoundingClientRect();
          return target.width === 0 || (target.left >= bounds.left && target.right <= bounds.right);
        });
      }))).toBe(true);
      const bounds = await result.boundingBox();
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
    }
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      if (width === 390) {
        await populated.locator("h1").evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({
          path: path.join(output, "patterns-phone-overview.png"),
          style: "nextjs-portal, main > .sticky { visibility: hidden !important; }",
        });
        await pending.locator("summary").click();
        await sparse.screenshot({
          path: path.join(output, "patterns-expanded.png"),
          style: "nextjs-portal, main > .sticky { visibility: hidden !important; }",
        });
        await pending.locator("summary").click();
        await sparse.screenshot({
          path: path.join(output, "patterns-sparse.png"),
          style: "nextjs-portal, main > .sticky { visibility: hidden !important; }",
        });
        await mobile.locator('[data-pattern-factor-row="high-filtering-amber-red-or-orange-evening-glasses-with-spectral-data-when-available"]').screenshot({
          path: path.join(output, "patterns-long-label.png"),
          style: "nextjs-portal, main > .sticky { visibility: hidden !important; }",
        });
      }
      await (width < 640 ? running : populated).screenshot({
        path: path.join(output, `patterns-${width}.png`),
        style: "nextjs-portal, main > .sticky { visibility: hidden !important; }",
      });
    }
  }
});
