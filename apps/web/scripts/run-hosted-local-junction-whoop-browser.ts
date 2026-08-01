import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

interface BrowserConfig {
  email: string;
  headless: boolean;
  hostedSessionCookie: string;
  otp: string | null;
  password: string;
  timeoutMs: number;
  webBaseUrl: string;
  webOrigin: string;
}

const AUTH_ACTIONS = [
  /^accept all$/i,
  /^accept cookies$/i,
  /^accept$/i,
  /^agree$/i,
  /^continue(?: with email| with whoop)?$/i,
  /^next$/i,
  /^log ?in$/i,
  /^sign in$/i,
  /^submit$/i,
  /^verify/i,
  /^authorize/i,
  /^allow/i,
  /^approve/i,
  /^grant/i,
  /^connect(?: whoop)?$/i,
] as const;

let stage = "configuration";
let activePage: Page | null = null;
let activeConfig: BrowserConfig | null = null;

async function main(): Promise<void> {
  const config = readBrowserConfig(process.env);
  activeConfig = config;
  clearSensitiveBrowserEnvironment();

  stage = "browser_launch";
  const browser = await chromium.launch({ headless: config.headless });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      reducedMotion: "reduce",
    });
    await addHostedSessionCookie(context, config);
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(config.timeoutMs);

    stage = "murph_connect_page";
    await page.goto(new URL("/connect", config.webBaseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "Sync your biomarkers" }).waitFor();

    stage = "murph_connect_start";
    const connectButton = page.getByRole("button", { name: /connect whoop/i });
    await Promise.all([
      page.waitForURL((url) => url.origin !== config.webOrigin, {
        timeout: config.timeoutMs,
      }),
      connectButton.click(),
    ]);

    stage = "junction_whoop_authorization";
    await completeExternalAuthorization(page, config);

    stage = "murph_callback_confirmation";
    const callbackUrl = new URL(page.url());
    if (callbackUrl.pathname !== "/api/device-sync/connect/junction/callback") {
      throw new Error("Junction returned to an unexpected Murph callback path.");
    }
    await page
      .getByRole("heading", { name: "Finish connecting your device" })
      .waitFor({ timeout: config.timeoutMs });
    await page.getByRole("button", { name: "Finish connection" }).click();

    stage = "murph_connected_completion";
    await page.getByText(/whoop is connected/i).waitFor({
      timeout: config.timeoutMs,
    });

    stage = "murph_persisted_connect_page";
    await page.goto(new URL("/connect", config.webBaseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    await assertWhoopConnectionState(page, "Whoop connected", config.timeoutMs);
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertWhoopConnectionState(page, "Whoop connected", config.timeoutMs);

    stage = "junction_cleanup";
    await disconnectJunctionAccount(page, config.timeoutMs);

    process.stdout.write(`MURPH_E2E_RESULT=${JSON.stringify({
      callbackConfirmed: true,
      connectedAfterCallback: true,
      connectedAfterReload: true,
      disconnectedDuringCleanup: true,
      provider: "junction",
      source: "whoop",
    })}\n`);
  } finally {
    await browser.close();
  }
}

async function addHostedSessionCookie(
  context: BrowserContext,
  config: BrowserConfig,
): Promise<void> {
  const pair = config.hostedSessionCookie.split(";", 1)[0]?.trim() ?? "";
  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("Hosted session cookie was malformed.");
  }

  await context.addCookies([{
    httpOnly: true,
    name: pair.slice(0, separatorIndex),
    sameSite: "Lax",
    secure: config.webBaseUrl.startsWith("https://"),
    url: config.webBaseUrl,
    value: decodeURIComponent(pair.slice(separatorIndex + 1)),
  }]);
}

async function completeExternalAuthorization(
  page: Page,
  config: BrowserConfig,
): Promise<void> {
  const deadline = Date.now() + config.timeoutMs;

  while (Date.now() < deadline) {
    if (readOrigin(page.url()) === config.webOrigin) {
      return;
    }

    await fillVisible(page, [
      'input[type="email"]',
      'input[autocomplete="email"]',
      'input[autocomplete="username"]',
      'input[name*="email" i]',
      'input[name="username"]',
    ], config.email);
    await fillVisible(page, [
      'input[type="password"]',
      'input[autocomplete="current-password"]',
    ], config.password);

    const otpInput = await findVisibleEditable(page, [
      'input[autocomplete="one-time-code"]',
      'input[name*="otp" i]',
      'input[name*="verification" i]',
    ]);
    if (otpInput) {
      if (config.otp) {
        await otpInput.fill(config.otp);
      } else if (config.headless) {
        throw new Error(
          "WHOOP requested a one-time code. Set MURPH_E2E_WHOOP_OTP or run headfully for manual entry.",
        );
      } else {
        await page.waitForTimeout(1_000);
        continue;
      }
    }

    await checkVisibleCheckboxes(page);
    const clicked = await clickFirstVisibleAction(page, AUTH_ACTIONS);
    if (!clicked && !config.headless) {
      // Headful runs permit manual CAPTCHA or one-time-code completion while
      // the test continues watching for the proof-bound Murph callback.
      await page.waitForTimeout(1_000);
      continue;
    }
    await page.waitForTimeout(clicked ? 750 : 1_000);
  }

  throw new Error("Timed out before Junction returned the browser to Murph.");
}

async function fillVisible(
  page: Page,
  selectors: readonly string[],
  value: string,
): Promise<void> {
  const input = await findVisibleEditable(page, selectors);
  if (input && await input.inputValue() !== value) {
    await input.fill(value);
  }
}

async function findVisibleEditable(
  page: Page,
  selectors: readonly string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    for (let index = 0; index < await candidates.count(); index += 1) {
      const candidate = candidates.nth(index);
      if (
        await candidate.isVisible().catch(() => false)
        && await candidate.isEditable().catch(() => false)
      ) {
        return candidate;
      }
    }
  }
  return null;
}

async function checkVisibleCheckboxes(page: Page): Promise<void> {
  const checkboxes = page.locator('input[type="checkbox"]');
  for (let index = 0; index < await checkboxes.count(); index += 1) {
    const checkbox = checkboxes.nth(index);
    if (
      await checkbox.isVisible().catch(() => false)
      && !await checkbox.isChecked()
    ) {
      await checkbox.check().catch(() => undefined);
    }
  }
}

async function clickFirstVisibleAction(
  page: Page,
  names: readonly RegExp[],
): Promise<boolean> {
  for (const name of names) {
    for (const role of ["button", "link"] as const) {
      const controls = page.getByRole(role, { name });
      for (let index = 0; index < await controls.count(); index += 1) {
        const control = controls.nth(index);
        if (
          await control.isVisible().catch(() => false)
          && await control.isEnabled().catch(() => false)
        ) {
          await control.click();
          return true;
        }
      }
    }
  }
  return false;
}

async function assertWhoopConnectionState(
  page: Page,
  text: string,
  timeoutMs: number,
): Promise<void> {
  await page.getByText(text, { exact: true }).waitFor({ timeout: timeoutMs });
}

async function disconnectJunctionAccount(
  page: Page,
  timeoutMs: number,
): Promise<void> {
  await page.getByRole("button", { name: "Disconnect account" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("heading", { name: "Disconnect account?" }).waitFor();
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByText("Source disconnected", { exact: true }).waitFor({
    timeout: timeoutMs,
  });
  await assertWhoopConnectionState(page, "Whoop not connected", timeoutMs);
}

function readBrowserConfig(env: NodeJS.ProcessEnv): BrowserConfig {
  const webBaseUrl = requireEnvironmentValue(env, "MURPH_E2E_WEB_BASE_URL");
  const parsedWebBaseUrl = new URL(webBaseUrl);
  const timeoutMs = Number.parseInt(
    env.MURPH_E2E_WHOOP_TIMEOUT_MS ?? "180000",
    10,
  );
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 600_000) {
    throw new Error(
      "MURPH_E2E_WHOOP_TIMEOUT_MS must be between 30000 and 600000.",
    );
  }

  return {
    email: requireEnvironmentValue(env, "MURPH_E2E_WHOOP_EMAIL"),
    headless: env.MURPH_E2E_WHOOP_HEADLESS !== "0",
    hostedSessionCookie: requireEnvironmentValue(
      env,
      "MURPH_E2E_HOSTED_SESSION_COOKIE",
    ),
    otp: env.MURPH_E2E_WHOOP_OTP?.trim() || null,
    password: requireEnvironmentValue(env, "MURPH_E2E_WHOOP_PASSWORD"),
    timeoutMs,
    webBaseUrl: parsedWebBaseUrl.toString().replace(/\/$/u, ""),
    webOrigin: parsedWebBaseUrl.origin,
  };
}

function clearSensitiveBrowserEnvironment(): void {
  for (const key of [
    "JUNCTION_API_KEY",
    "JUNCTION_CLIENT_USER_ID_SECRET",
    "JUNCTION_WEBHOOK_SECRET",
    "MURPH_E2E_HOSTED_SESSION_COOKIE",
    "MURPH_E2E_WHOOP_EMAIL",
    "MURPH_E2E_WHOOP_OTP",
    "MURPH_E2E_WHOOP_PASSWORD",
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
  ]) {
    delete process.env[key];
  }
}

function requireEnvironmentValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(
      `Hosted-local Junction WHOOP browser runner requires ${key}.`,
    );
  }
  return value;
}

function readOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function safePageLocation(page: Page | null): string {
  try {
    const url = new URL(page?.url() ?? "");
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unavailable";
  }
}

function sanitizeFailure(error: unknown, config: BrowserConfig | null): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [
    config?.email,
    config?.password,
    config?.otp,
    config?.hostedSessionCookie,
  ]) {
    if (secret) {
      message = message.replaceAll(secret, "[redacted]");
    }
  }
  message = message.replace(/https?:\/\/[^\s)]+/gu, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return "[url]";
    }
  });
  return message.slice(0, 600);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Junction WHOOP browser E2E failed at ${stage} (${safePageLocation(activePage)}): ${
      sanitizeFailure(error, activeConfig)
    }\n`,
  );
  process.exitCode = 1;
});