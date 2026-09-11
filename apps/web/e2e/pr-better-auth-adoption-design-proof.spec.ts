import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

async function capture(page: Page, target: Locator, name: string) {
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
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
});

for (const [method, width] of [["phone", 390], ["email", 1280]] as const) {
  test(`${method} login keeps confirmed authentication through a product-loading retry`, async ({ page }) => {
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
    const entry = dialog.getByLabel(method === "email" ? "Email" : "Your phone", { exact: true });
    await entry.fill(method === "email" ? "member@example.test" : "2025550152");
    await capture(page, dialog, `login-${method}-${width}`);
    await dialog.getByRole("button", { name: "Send verification code", exact: true }).click();
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
    for (const state of ["phone", "email", "connections", "recovery"]) {
      const panel = study.locator(`[data-auth-study="${state}"]`);
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await panel.evaluate((element) => element.scrollIntoView({ block: "center" }));
      await capture(page, panel, `account-${state}-${width}`);
    }
  });
}
