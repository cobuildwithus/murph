import { expect, test } from "@playwright/test";

test("retired voice pages and admission return not found", async ({ page, request }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["localhost", "127.0.0.1"].includes(url.hostname) ? route.continue() : route.abort();
  });
  for (const pathname of ["/voice", "/screenshots/voice"]) {
    expect((await page.goto(pathname))?.status()).toBe(404);
  }
  for (const pathname of ["/api/voice", "/api/internal/hosted-mailbox/voice-input"]) {
    expect((await request.post(pathname, { data: { action: "reserve", callId: "synthetic-call" } })).status()).toBe(404);
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto("/design?tab=voice-orb"))?.status()).toBe(200);
    await expect(page.getByRole("link", { name: "Brand", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Voice orb", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `.next-smoke-retire-voice/design-${width}.png` });
  }
});
