import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`the auth catalog stays inert and starts no authentication requests at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const authRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/settings/") || url.hostname === "telegram.org") {
        authRequests.push(`${request.method()} ${url.pathname}`);
      }
    });
    // Unexpected effects are observed but never reach an API or provider.
    await page.route("**/*", (route) => ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort());
    await page.route("**/api/**", (route) => route.abort());
    await page.goto("/design?tab=components#better-auth-adoption");
    const study = page.locator("#better-auth-adoption");
    await expect(study).toBeVisible();
    await expect(study).toHaveAttribute("inert", "");
    await expect(study.locator("[data-auth-study]")).toHaveCount(10);
    await expect(study.locator('[data-auth-study="phone"] input[type="tel"]')).toBeVisible();
    await expect(study.locator('[data-auth-study="email"] input[type="email"]')).toBeVisible();
    // Allow hydrated mount continuations to settle, including late SDK preparation.
    await page.waitForTimeout(1_000);
    expect(authRequests).toEqual([]);
    expect(await study.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await study.screenshot({ path: testInfo.outputPath(`auth-study-${width}.png`), style: "nextjs-portal { visibility: hidden; }" });
  });
}
