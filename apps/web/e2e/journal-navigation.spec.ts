import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("Journal calendar and selected-week summaries work on phone and desktop", async ({ browser }) => {
  test.setTimeout(300_000);
  const outputDir = process.env.DESIGN_PROOF_OUTPUT_DIR;
  if (outputDir) await mkdir(outputDir, { recursive: true });
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        return ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort();
      });
      const page = await context.newPage();
      await page.goto("/design?tab=components#journal-study", { timeout: 180_000 });
      await page.waitForFunction(() => {
        const element = document.querySelector('[aria-label="Journal ready state"]');
        return element && Object.keys(element).some((key) => key.startsWith("__reactFiber$"));
      });
      const ready = page.getByRole("region", { name: "Journal ready state", includeHidden: true });
      await expect(ready.getByRole("heading", { name: "Journal", exact: true, includeHidden: true })).toBeVisible();
      // The public study stays inert; enable only this synthetic production component for interaction proof.
      await ready.evaluate((element) => element.removeAttribute("inert"));
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      expect(await ready.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await ready.scrollIntoViewIfNeeded();
      if (outputDir) await ready.screenshot({ path: path.join(outputDir, `journal-${width}.png`), style: "nextjs-portal, main > .sticky { visibility: hidden; }" });
      if (width < 1024) await ready.getByRole("button", { name: /Choose a Journal date/ }).click();
      const calendar = page.getByRole("region", { name: "Journal calendar" }).filter({ visible: true });
      const date = calendar.getByRole("button", { name: "Thursday, June 11, 2026" });
      expect((await date.boundingBox())?.height).toBeGreaterThanOrEqual(40);
      await date.focus();
      await expect(date).toBeFocused();
      if (outputDir) await calendar.screenshot({ path: path.join(outputDir, `journal-calendar-${width}.png`), style: "nextjs-portal { visibility: hidden; }" });
      await date.press("Enter");
      const stats = ready.getByRole("region", { name: "Seven days at a glance" }).filter({ visible: true });
      await expect(stats).toContainText("Jun 5–11");
      await expect(stats).not.toContainText("Last 7 days");
      await expect(ready.locator('[id^="journal-day-"]').first()).toHaveAttribute("id", "journal-day-2026-06-11");
      if (width < 1024) await ready.getByRole("button", { name: /Choose a Journal date/ }).click();
      await expect(calendar.getByRole("button", { name: "Thursday, June 11, 2026" })).toHaveAttribute("aria-pressed", "true");
      await expect(calendar.getByRole("button", { name: "Saturday, June 13, 2026" })).toHaveAttribute("aria-current", "date");
      if (width < 1024) await page.getByRole("button", { name: "Return to today" }).click();
      else await ready.getByRole("button", { name: "Today", exact: true }).click();
      await expect(stats).toContainText("Last 7 days");
      // Change zone after catalog hydration, then exercise the production chart in UTC+14.
      const browserSession = await context.newCDPSession(page);
      await browserSession.send("Emulation.setTimezoneOverride", { timezoneId: "Pacific/Kiritimati" });
      await stats.getByRole("button", { name: "Show avg sleep time details" }).click();
      const chart = page.getByRole("img", { name: "Sleep time trend for this week" });
      await expect(chart).toBeVisible();
      await expect(chart.locator("..")).toContainText("Sun");
      await expect(chart.locator("..")).toContainText("Sat");
      if (outputDir) await chart.locator("..").screenshot({ path: path.join(outputDir, `journal-sleep-chart-${width}.png`) });
      const empty = page.getByRole("region", { name: "Journal empty state", includeHidden: true });
      await expect(empty.locator('[role="status"]')).toHaveAttribute("aria-label", "Updating latest data");
      expect(await empty.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    } finally { await context.close(); }
  }
});
