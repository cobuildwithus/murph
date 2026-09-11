import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function capture(page: Page, target: Locator, name: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await target.screenshot({ path: path.join(output, `${name}.png`), caret: "initial", style: "nextjs-portal { visibility: hidden; }" });
  }
}

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
});

for (const [method, width] of [["phone", 390], ["email", 390], ["phone", 1280], ["email", 1280]] as const) {
  test(`${method} at ${width}px login keeps confirmed authentication through a product-loading retry`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    const scripts: string[] = [];
    page.on("request", (request) => { if (request.resourceType() === "script") scripts.push(request.url()); });
    let sends = 0; let verifies = 0; let completes = 0;
    await page.route("**/api/auth/otp/send", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ kind: method }); sends += 1;
      await route.fulfill({ json: { ok: true } });
    });
    await page.route("**/api/auth/otp/verify", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ kind: method, code: "123456" }); verifies += 1;
      await route.fulfill({ json: { ok: true, memberId: "synthetic-ui-member" } });
    });
    await page.route("**/api/auth/complete", async (route) => {
      completes += 1;
      await route.fulfill({ status: 503, json: { ok: false, error: { code: "AUTH_PRODUCT_UNAVAILABLE", message: "Your account could not load. Try again." } } });
    });
    await page.goto("/", { waitUntil: "load", timeout: 90_000 });
    await page.getByRole("button", { name: "Signup", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Log in or sign up" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Telegram", exact: true })).toBeVisible();
    await capture(page, dialog, `login-entry-${width}`);
    if (method === "email") await dialog.getByRole("button", { name: "Email", exact: true }).click();
    const entry = dialog.getByLabel(method === "email" ? "Your email" : "Your phone", { exact: true });
    const sendButton = dialog.getByRole("button", { name: method === "email" ? "Email me a code" : "Send verification code", exact: true });
    await expect(sendButton).toHaveCSS("height", "56px");
    if (method === "email") {
      await expect(entry).toHaveAttribute("placeholder", "you@example.com");
      await expect(entry).toHaveCSS("height", "56px");
      await expect(sendButton).toBeEnabled();
      await capture(page, dialog, `login-email-empty-${width}`);
    }
    await entry.fill(method === "email" ? "member@example.test" : "2025550152");
    await capture(page, dialog, `login-${method}-${width}`);
    await dialog.getByRole("button", { name: method === "email" ? "Email me a code" : "Send verification code", exact: true }).click();
    const code = dialog.getByLabel("Verification code", { exact: true });
    await expect(code).toBeFocused();
    await capture(page, dialog, `login-code-${method}-${width}`);
    await code.fill("123456");
    await expect(dialog.getByText("You’re signed in. Continue to your account.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText("Your account could not load");
    await capture(page, dialog, `login-retry-${method}-${width}`);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.poll(() => completes).toBe(2);
    expect(sends).toBe(1); expect(verifies).toBe(1);
    expect(scripts.filter((url) => /privy-io|walletconnect|@reown/i.test(url))).toEqual([]);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

for (const width of [390, 1280]) {
  test(`account adoption presentation at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/design?tab=components", { waitUntil: "load", timeout: 90_000 });
    const study = page.locator("#better-auth-adoption");
    await expect(study).toBeVisible();
    await expect(study).toHaveAttribute("inert", "");
    for (const state of ["phone", "email", "connections", "unconnected", "compact-code", "initial-passkey", "messaging", "recovery"]) {
      const panel = study.locator(`[data-auth-study="${state}"]`);
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await panel.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await capture(page, panel, `account-${state}-${width}`);
    }
  });
}

for (const width of [390, 1280]) {
  test(`auth failure, resend and Telegram recovery at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      Object.defineProperty(window, "Telegram", { value: { Login: {
        auth: (_options: unknown, callback: (value: unknown) => void) => callback({ error: "popup_closed" }),
        close: () => undefined,
      } } });
    });
    let sends = 0;
    await page.route("**/api/auth/otp/send", (route) => {
      sends += 1;
      return route.fulfill(sends === 1 ? { status: 503, json: { ok: false, error: { code: "AUTH_DELIVERY_FAILED", message: "The code could not be sent. Try again." } } } : { json: { ok: true } });
    });
    await page.route("**/api/auth/otp/verify", (route) => route.fulfill({ status: 400, json: { ok: false, error: { code: "AUTH_CODE_INVALID", message: "That code did not work. Try again." } } }));
    await page.route("**/api/auth/telegram/start", (route) => route.fulfill({ json: { ok: true, clientId: "123456789", nonce: "n".repeat(43) } }));
    await page.goto("/", { waitUntil: "load", timeout: 90_000 });
    await page.getByRole("button", { name: "Signup", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Email", exact: true }).click();
    await dialog.getByLabel("Your email", { exact: true }).fill("member@example.test");
    await dialog.getByRole("button", { name: "Email me a code", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("The code could not be sent");
    await capture(page, dialog, `login-send-error-${width}`);
    await dialog.getByRole("button", { name: "Email me a code", exact: true }).click();
    const code = dialog.getByLabel("Verification code", { exact: true });
    await code.fill("000000");
    await expect(dialog.getByRole("alert")).toContainText("That code did not work");
    await capture(page, dialog, `login-code-error-${width}`);
    await dialog.getByRole("button", { name: "Resend code", exact: true }).click();
    await expect(code).toHaveValue("");
    expect(sends).toBe(3);
    await dialog.getByRole("button", { name: "Use another email", exact: true }).click();
    await dialog.getByRole("button", { name: "Phone", exact: true }).click();
    await expect(dialog.getByLabel("Your phone", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Telegram", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Continue with Telegram", exact: true })).toBeEnabled();
    await capture(page, dialog, `login-telegram-${width}`);
    await dialog.getByRole("button", { name: "Continue with Telegram", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Try Telegram again", exact: true })).toBeVisible();
    await capture(page, dialog, `login-telegram-error-${width}`);
    await dialog.getByRole("button", { name: "Try Telegram again", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Continue with Telegram", exact: true })).toBeEnabled();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}
