import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const gameId = "game_synthetic";

test("public recap handoff and design proof", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
  });
  for (const { width, apple, theme } of [
    { width: 390, apple: true, theme: "light" },
    { width: 1280, apple: false, theme: "light" },
    { width: 1280, apple: false, theme: "dark" },
  ]) {
    await page.setExtraHTTPHeaders({ "User-Agent": apple
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15" });

    await page.setViewportSize({ width, height: 850 });
    const response = await page.goto(`/recap/${gameId}`);
    expect(response?.status()).toBe(200);
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
    await expect(page.getByRole("heading", { name: "Your recap is in Murph." })).toBeVisible();
    if (apple) {
      await expect(page.getByRole("link", { name: "Open in Murph", exact: true })).toHaveAttribute("href", `ai.withmurph.app://recap/${gameId}`);
    } else {
      await expect(page.getByText("Scan with your iPhone camera to watch it.", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Open in Murph", exact: true })).toHaveCount(0);
      await expect(page.locator('[role="img"] svg')).toBeVisible();
      await expect(page.locator('[role="img"]')).toHaveCSS("width", "176px");
    }
    await expect(page.getByRole("link", { name: "Get it on the App Store" })).toHaveAttribute("href", "https://apps.apple.com/us/app/murph-ai/id6786145859");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Your recap is in Murph");
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", "Open Murph to watch your recap.");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /^https?:\/\/[^/]+\/opengraph-image$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    if (process.env.DESIGN_PROOF_OUTPUT_DIR) {
      await mkdir(process.env.DESIGN_PROOF_OUTPUT_DIR, { recursive: true });
      await page.locator("main > div").screenshot({ path: path.join(process.env.DESIGN_PROOF_OUTPUT_DIR, `recap-${width}-${theme}.png`) });
    }
  }
  const invalid = await page.goto("/recap/bad");
  expect(invalid?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Murph" })).toHaveCount(0);

  await page.goto("/screenshots/groups#game-recap");
  const study = page.locator("#game-recap");
  await study.scrollIntoViewIfNeeded();
  await expect(study).toHaveAttribute("inert", "");
  await expect(study.locator("h1")).toBeVisible();
});


test("desktop handoff works without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto(`${baseURL}/recap/${gameId}`);
    await expect(page.getByText("Scan with your iPhone camera to watch it.", { exact: true })).toBeVisible();
    await expect(page.locator('[role="img"] svg')).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Murph", exact: true })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
