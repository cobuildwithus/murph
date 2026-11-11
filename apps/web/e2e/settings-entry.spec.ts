import { expect, test } from "@playwright/test";

test("retired dashboard routes lead to Settings without loading replicas", async ({ page }) => {
  const replicaRequests: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("browser-vault")) replicaRequests.push(url.pathname);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  for (const path of ["/training", "/history", "/journal", "/labs", "/overview"]) {
    const response = await page.request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe("/settings");
  }
  const callback = await page.request.get("/training?deviceSyncCompletion=1&connectSource=oura", { maxRedirects: 0 });
  expect(callback.headers().location).toBe("/settings?deviceSyncCompletion=1&connectSource=oura");
  await page.goto("/training");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Continue to Settings." })).toBeVisible();
  expect(replicaRequests).toEqual([]);
});

test("Settings navigation and retained billing confirmation fit phones and desktop", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await page.goto("/design?tab=components#dashboard-primary-navigation-component", { waitUntil: "load" });
  await expect.poll(() => page.locator("#dashboard-primary-navigation-component a").first().evaluate((element) =>
    Object.keys(element).some((key) => key.startsWith("__reactFiber$"))
  )).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.locator("#dashboard-primary-navigation-component");
    await expect(navigation.locator('a[href="/settings"]')).toHaveCount(1);
    await expect(navigation.locator('a[href="/home"]')).toHaveCount(1);
    await expect(navigation.locator('a[href="/training"], a[href="/connect"]')).toHaveCount(0);
    const billing = page.locator("#edge-to-pulse-confirmation");
    await expect(billing.getByText("Switch to Pulse", { exact: true }).first()).toBeVisible();
    await expect(billing.getByText(/You keep Edge through/)).toBeVisible();
    for (const [name, section] of [["settings-navigation", navigation], ["plan-switch", billing]] as const) {
      await section.scrollIntoViewIfNeeded();
      const box = await section.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      await section.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
    }
  }
});


test("Home remains usable and its real onboarding fits phones and desktop", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const replicaRequests: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("browser-vault")) replicaRequests.push(url.pathname);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await page.goto("/home");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Welcome to Murph" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect devices" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sync labs" })).toBeVisible();
  expect(replicaRequests).toEqual([]);
  await page.goto("/screenshots/home#home-onboarding-steps", { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, selector] of [["home-onboarding", "#home-onboarding-steps"], ["home-partial-load", "#home-partial-load-section"]]) {
      const section = page.locator(selector);
      await section.scrollIntoViewIfNeeded();
      const box = await section.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
      await section.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`) });
    }
    await expect(page.locator("#home-partial-load-section").getByText("Sync labs", { exact: true })).toHaveCount(0);
    await expect(page.locator("#home-partial-load-section").getByRole("button", { name: "Try again" })).toBeVisible();
  }
});
