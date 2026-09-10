import { chromium, request, type Page } from "@playwright/test";

const origin = "https://localhost:3443";
const email = process.env.MURPH_E2E_AUTH_TEST_EMAIL?.trim();
const otp = process.env.MURPH_E2E_AUTH_TEST_OTP?.trim();
delete process.env.MURPH_E2E_AUTH_TEST_EMAIL;
delete process.env.MURPH_E2E_AUTH_TEST_OTP;
let stage = "configuration";

async function main() {
  if (!email || !otp || !/^\d{6}$/u.test(otp)) throw new Error("Missing browser credentials.");
  const browser = await chromium.launch({ headless: true });
  try {
    // Only the generated loopback TLS certificate is untrusted. No auth storage,
    // cookies, scripts, request mocks, screenshots or traces are installed.
    const context = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(120_000);
    stage = "anonymous";
    if ((await context.cookies()).length !== 0) throw new Error("Expected empty browser.");
    await requireStatus(await context.request.get("/api/legal/consent/status"), 401);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    stage = "provider_login";
    await page.getByRole("button", { name: "Signup", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Email", exact: true }).click();
    await dialog.getByLabel("Your email", { exact: true }).fill(email);
    await dialog.getByRole("button", { name: "Email me a code", exact: true }).click();
    const completed = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/hosted-onboarding/privy/complete"
      && response.request().method() === "POST" && response.status() === 200);
    await dialog.getByLabel("Verification code", { exact: true }).fill(otp);
    stage = "app_completion";
    await completed;
    const sessionCookie = (await context.cookies()).find((cookie) => cookie.name === "__Host-murph-session");
    if (!sessionCookie?.secure || !sessionCookie.httpOnly || sessionCookie.sameSite !== "Lax") {
      throw new Error("Browser did not accept the production session cookie.");
    }
    stage = "consent";
    // A fresh local fixture has no consent. The real combined prompt commits
    // both scopes through ordinary HTTP and the canonical legal owner.
    const granted = page.waitForResponse(async (response) => {
      if (new URL(response.url()).pathname !== "/api/legal/consent/accept"
        || response.request().method() !== "POST" || response.status() !== 200) return false;
      const body: unknown = await response.json();
      return isRecord(body) && body.launchGranted === true;
    });
    await page.getByRole("button", { name: "Consent", exact: true }).click();
    await granted;
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const consent = await context.request.get("/api/legal/consent/status");
    await requireStatus(consent, 200);
    const consentBody: unknown = await consent.json();
    if (!isRecord(consentBody) || consentBody.launchGranted !== true) throw new Error("Consent did not persist.");
    stage = "settings_write";
    const targetTone = await setDifferentTone(page);
    stage = "reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await openTonePicker(page);
    if (!await page.locator(`input[type="radio"][value="${targetTone}"]`).isChecked()) {
      throw new Error("Settings did not survive a fresh server-rendered document.");
    }
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    stage = "logout";
    await page.getByRole("button", { name: "Open user menu", exact: true }).click();
    const loggedOut = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/hosted-onboarding/session/logout"
      && response.request().method() === "POST");
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await requireStatus(await loggedOut, 200);
    stage = "revocation";
    await requireStatus(await context.request.get("/api/legal/consent/status"), 401);
    await requireStatus(await context.request.post("/api/settings/assistant-style", {
      data: { tone: targetTone }, headers: { origin },
    }), 401);
    // A cleared browser cookie alone cannot prove server-side revocation.
    // Replay the original credential from an isolated API client, only in memory.
    const replay = await request.newContext({
      baseURL: origin, ignoreHTTPSErrors: true,
      extraHTTPHeaders: { cookie: `${sessionCookie.name}=${sessionCookie.value}` },
    });
    try { await requireStatus(await replay.get("/api/legal/consent/status"), 401); }
    finally { await replay.dispose(); }
    await context.close();
    process.stdout.write("MURPH_E2E_AUTH_RESULT=passed\n");
  } finally { await browser.close(); }
}

async function openTonePicker(page: Page) {
  const row = page.locator("div.grid").filter({ has: page.getByText("How Murph talks", { exact: true }) });
  await row.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("dialog", { name: "Pick Murph's tone", exact: true }).waitFor();
}

async function setDifferentTone(page: Page): Promise<"formal" | "casual"> {
  await openTonePicker(page);
  const formal = page.locator('input[type="radio"][value="formal"]');
  const tone = await formal.isChecked() ? "casual" : "formal";
  await page.locator(`label:has(input[type="radio"][value="${tone}"])`).click();
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings/assistant-style"
    && response.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  const response = await saved;
  await requireStatus(response, 200);
  const body: unknown = await response.json();
  if (!isRecord(body) || body.assistantTone !== tone || body.updated !== true) throw new Error("Settings write failed.");
  return tone;
}

async function requireStatus(response: { status(): number }, status: number) {
  if (response.status() !== status) throw new Error("Unexpected HTTP status.");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

void main().catch(() => {
  // Errors from SDK/browser assertions may contain tokens, email or complete
  // response bodies. The fixed stage is the entire durable diagnostic contract.
  process.stderr.write(`Browser auth journey failed: stage=${stage}.\n`);
  process.exitCode = 1;
});
