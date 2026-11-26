import { expect, test } from "@playwright/test";

test("a public win link opens the app from the same generic page at phone and desktop widths", async ({ page }) => {
  test.slow(); // The first request compiles the public layout on a cold smoke server.
  const ref = "s".repeat(43);
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return host === "localhost" || host === "127.0.0.1" ? route.continue() : route.abort();
  });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 820 });
    const response = await page.goto(`/wins/${ref}`, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "A new win in Murph" })).toBeVisible();
    const open = page.getByRole("link", { name: "Open in Murph" });
    await expect(open).toBeInViewport();
    await expect(open).toHaveAttribute("href", `ai.withmurph.app://wins/${ref}`);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/brand-logos\/murph-logo-avatar-light\.png$/);
  }
  expect((await page.goto("/wins/invalid"))?.status()).toBe(404);
  await expect(page.getByRole("link", { name: "Open in Murph" })).toHaveCount(0);
});
