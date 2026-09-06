import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// In the Turbopack smoke lane, distinguish SDK chunks from the small async loader.
// Cold public navigation must leave the SDK behind its intent boundary.
for (const width of [412, 1440]) {
  test(`public auth loading at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return ["127.0.0.1", "localhost"].includes(host)
        ? route.continue() : route.abort();
    });
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
    for (const route of ["/experiments", "/goals", "/"]) {
      scripts.length = 0;
      expect((await page.goto(route, { waitUntil: "load", timeout: 90_000 }))?.status()).toBe(200);
      await page.waitForTimeout(5_000);
      expect(scripts.filter((url) => /@privy-io|@walletconnect|@reown/i.test(url))).toEqual([]);
    }
    const signup = page.getByRole("button", { name: "Signup", exact: true });
    await signup.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Log in or sign up" })).toBeVisible();
    await expect(dialog.getByRole("textbox").first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    if (output) {
      await mkdir(output, { recursive: true });
      await dialog.screenshot({ path: path.join(output, `auth-${width}.png`) });
    }
  });
}
