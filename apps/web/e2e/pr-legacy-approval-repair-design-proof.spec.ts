import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

// WebAuthn needs a domain relying party; the smoke server binds 127.0.0.1, so open it as localhost.
function proofUrl(path: string) {
  const base = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1:3210");
  base.hostname = "localhost";
  return `${base.origin}${path}`;
}

async function overflowOffenders(target: Locator) {
  return target.evaluate((element) => {
    const limit = element.getBoundingClientRect().right + 1;
    // Ignore clipped or invisible helpers such as the OTP library's hidden native input.
    return Array.from(element.querySelectorAll<HTMLElement>("*"))
      .filter((child) => {
        const style = getComputedStyle(child);
        return child.getBoundingClientRect().right > limit && child.offsetParent !== null
          && style.clipPath === "none" && style.opacity !== "0" && style.visibility !== "hidden";
      })
      .slice(0, 5)
      .map((child) => `${child.tagName.toLowerCase()}.${child.className.toString().slice(0, 80)}`);
  });
}

async function capture(page: Page, target: Locator, name: string) {
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const output = process.env.DESIGN_PROOF_OUTPUT_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await target.screenshot({ path: path.join(output, `${name}.png`), style: "nextjs-portal { visibility: hidden; }" });
  }
}

for (const width of [390, 1280]) {
  for (const fresh of [false, true]) {
    test(`legacy approval ${fresh ? "fresh proof" : "reauthentication cancel and retry"} at ${width}px`, async ({ page, context }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
      page.on("pageerror", (error) => { throw error; });
      const providerRequests: string[] = [];
      page.on("request", (request) => {
        if (/privy-io|privy\.io|walletconnect|@reown/i.test(request.url())) providerRequests.push(request.url());
      });
      await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort());
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
        protocol: "ctap2", transport: "internal", hasResidentKey: true,
        hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
      } });
      let authenticated = fresh;
      let registered = false;
      let registrations = 0;
      let assertions = 0;
      let decisions = 0;
      let challenges = 0;
      let completions = 0;
      const approvalId = "haa_" + "a".repeat(32);
      await page.route(`**/api/action-approvals/${approvalId}/challenge`, (route) => {
        challenges += 1;
        return route.fulfill({ json: { token: `synthetic-action-${challenges}` } });
      });
      await page.route("**/api/settings/approval-passkeys/authenticate", (route) => {
        if (registered) assertions += 1;
        return route.fulfill({ json: registered
          ? { method: "passkey", options: { challenge: "c3ludGhldGlj", rpId: "localhost", userVerification: "required" } }
          : { method: "legacy-repair" } });
      });
      await page.route("**/api/settings/approval-passkeys/legacy-options", (route) => route.fulfill(authenticated
        ? { json: { token: "synthetic-repair", options: {
          challenge: "c3ludGhldGlj", rp: { id: "localhost", name: "Murph" },
          user: { id: "bWVtYmVy", name: "member@example.test", displayName: "Synthetic member" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
        } } }
        : { status: 403, json: { error: { code: "SENSITIVE_ACTION_FRESH_LOGIN_REQUIRED", message: "Sign in again." } } }));
      await page.route("**/api/settings/approval-passkeys/register", (route) => {
        expect(route.request().postDataJSON()).toMatchObject({ legacyRepairToken: "synthetic-repair", response: { type: "public-key" } });
        expect(decisions).toBe(0);
        registrations += 1;
        registered = true;
        return route.fulfill({ json: { registered: true } });
      });
      await page.route(`**/api/action-approvals/${approvalId}/decision`, (route) => {
        expect(registered).toBe(true);
        expect(assertions).toBe(1);
        expect(route.request().postDataJSON()).toMatchObject({
          decision: "approved", authorization: { method: "passkey", token: `synthetic-action-${challenges}`, assertion: { type: "public-key" } },
        });
        decisions += 1;
        return route.fulfill({ json: { status: "approved", redirectTo: null } });
      });
      await page.route("**/api/auth/otp/send", (route) => {
        expect(route.request().postDataJSON()).toMatchObject({ reauthenticate: true, kind: "email", value: "member@example.test" });
        return route.fulfill({ json: { ok: true } });
      });
      await page.route("**/api/auth/otp/verify", (route) => {
        expect(route.request().postDataJSON()).toMatchObject({ reauthenticate: true, code: "123456" });
        authenticated = true;
        return route.fulfill({ json: { ok: true, memberId: "member" } });
      });
      await page.route("**/api/auth/complete", (route) => { completions += 1; return route.fulfill({ status: 500 }); });
      await page.goto(proofUrl("/screenshots/messages#action-approval-lifecycle"), { waitUntil: "load", timeout: 90_000 });
      const panel = page.locator('[data-approval-study="pending"]');
      await panel.evaluate((element) => {
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) ancestor.removeAttribute("inert");
      });
      await capture(page, panel, `approval-entry-${fresh}-${width}`);
      const approve = panel.getByRole("button", { name: "Approve with passkey", exact: true });
      // Other studies on this page may load provider chunks; the approval journey itself must not.
      providerRequests.length = 0;
      await approve.click();
      if (!fresh) {
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("heading", { name: "Sign in again", exact: true })).toBeVisible();
        await capture(page, dialog, `approval-reauth-${width}`);
        await page.keyboard.press("Escape");
        await expect(panel.getByRole("alert")).toContainText("Nothing was approved");
        expect(registrations).toBe(0);
        expect(decisions).toBe(0);
        await capture(page, panel, `approval-canceled-${width}`);
        await approve.click();
        await dialog.getByRole("button", { name: "Email", exact: true }).click();
        await dialog.getByLabel("Your email", { exact: true }).fill("member@example.test");
        await dialog.getByRole("button", { name: "Email me a code", exact: true }).click();
        await expect(dialog.getByLabel("Verification code", { exact: true })).toBeFocused();
        expect(await overflowOffenders(dialog)).toEqual([]);
        await capture(page, dialog, `approval-code-${width}`);
        await dialog.getByLabel("Verification code", { exact: true }).fill("123456");
        await expect(dialog).toHaveCount(0);
      }
      await expect(panel.getByText("Approval recorded.", { exact: true })).toBeVisible();
      expect(registrations).toBe(1);
      expect(decisions).toBe(1);
      expect(challenges).toBe(fresh ? 2 : 3);
      expect(completions).toBe(0);
      expect(providerRequests).toEqual([]);
      expect(await overflowOffenders(panel)).toEqual([]);
      await capture(page, panel, `approval-success-${fresh}-${width}`);
      await cdp.detach();
    });
  }
}
