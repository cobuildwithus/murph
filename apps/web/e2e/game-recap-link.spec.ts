import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const gameId = "game_synthetic";

test("public recap handoff and design proof", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    const response = await page.goto(`/recap/${gameId}`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Your recap is in Murph." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Murph", exact: true })).toHaveAttribute("href", `ai.withmurph.app://recap/${gameId}`);
    await expect(page.getByRole("link", { name: "Get it on the App Store" })).toHaveAttribute("href", "https://apps.apple.com/us/app/murph-ai/id6786145859");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Your recap is in Murph");
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", "Open Murph to watch your recap.");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https?:\/\/[^/]+\/opengraph-image$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    if (process.env.DESIGN_PROOF_OUTPUT_DIR) {
      await mkdir(process.env.DESIGN_PROOF_OUTPUT_DIR, { recursive: true });
      await page.locator("main").screenshot({ path: path.join(process.env.DESIGN_PROOF_OUTPUT_DIR, `recap-${width}.png`) });
    }
  }
  const invalid = await page.goto("/recap/bad");
  expect(invalid?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  await expect(page.getByText("Page not found.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Murph" })).toHaveCount(0);

  await page.goto("/screenshots/groups#game-recap");
  const study = page.locator("#game-recap");
  await study.scrollIntoViewIfNeeded();
  await expect(study).toHaveAttribute("inert", "");
  await expect(study.locator("h1")).toBeVisible();
});
