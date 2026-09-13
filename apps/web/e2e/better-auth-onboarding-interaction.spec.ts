import { expect, test } from "@playwright/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--disable-popup-blocking"] } });

test("an early Telegram click reuses its window after preparation outlasts the click gesture", async ({ page, context }) => {
  let release!: () => void;
  const prepared = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/telegram/start", async (route) => {
    await prepared;
    await route.fulfill({ json: { ok: true, nonce: "n".repeat(43), clientId: "123456789" } });
  });
  // The SDK's public auth port opens this named window. Exercise Chromium's
  // real popup policy without contacting an identity provider or signing in.
  await page.route("https://telegram.org/js/telegram-login.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.Telegram = { Login: {
      auth() { this.popup = window.open('/telegram-browser-proof', 'telegram_oidc_login', 'popup,width=550,height=650'); },
      close() { this.popup?.close(); }
    } };`,
  }));
  await context.route("**/telegram-browser-proof", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Provider window proof</title>" }));
  await page.goto("/design?tab=components");
  const study = page.locator("#better-auth-adoption");
  await study.evaluate((element) => element.removeAttribute("inert"));
  const phone = study.locator('[data-auth-study="phone"]');
  const telegram = phone.getByRole("button", { name: "Telegram", exact: true });
  await expect(telegram).toBeEnabled();
  await expect(telegram.locator(".animate-spin")).toHaveCount(0);
  const popupReady = page.waitForEvent("popup");
  await telegram.click();
  const popup = await popupReady;
  expect(popup.url()).toBe("about:blank");
  // Transient browser activation lasts about five seconds. Retain the same
  // popup beyond it so this proves reuse rather than permissive launch flags.
  await page.waitForTimeout(6_000);
  release();
  await expect(popup).toHaveURL(/\/telegram-browser-proof$/u);
  expect(context.pages()).toHaveLength(2);
  await expect(telegram.locator(".animate-spin")).toHaveCount(0);
  await phone.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
});

test("messaging setup presents the phone input and Telegram action at desktop and phone widths", async ({ page }, testInfo) => {
  await page.route("**/api/auth/telegram/start", (route) => route.fulfill({ json: { ok: true, nonce: "n".repeat(43), clientId: "123456789" } }));
  await page.route("https://telegram.org/js/telegram-login.js", (route) => route.fulfill({ contentType: "text/javascript", body: "window.Telegram={Login:{auth(){},close(){}}};" }));
  await page.goto("/design?tab=components");
  const setup = page.locator('[data-auth-study="messaging"]');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(setup.locator('input[type="tel"]')).toBeVisible();
    await expect(setup.getByText("Connect Telegram", { exact: true })).toBeVisible();
    await expect(setup.getByText("Connect phone", { exact: true })).toHaveCount(0);
    await expect(setup.getByText("Set up a passkey")).toHaveCount(0);
    expect(await setup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await setup.screenshot({ path: testInfo.outputPath(`messaging-${width}.png`) });
  }
});
