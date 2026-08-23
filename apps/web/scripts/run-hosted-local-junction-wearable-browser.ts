import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import { KernelComputerClient } from "../src/lib/computer-use/kernel-client.ts";
import {
  buildHostedLocalBrowserSessionCookie,
  clearHostedLocalBrowserEnvironment,
  formatHostedLocalBrowserResult,
  readHostedLocalBrowserEnvironmentValue,
  readHostedLocalBrowserTimeout,
} from "./hosted-local-browser-process.ts";
import { isHostedLocalProviderChallengeSurface } from "./hosted-local-provider-challenge.ts";

type WearableSource = "garmin" | "oura" | "whoop";

interface BrowserConfig {
  browserChannel: "chrome" | undefined;
  browserTransport: "kernel" | "local";
  disclosureSourceName: "Garmin" | "Oura" | "Whoop";
  email: string;
  headless: boolean;
  hostedSessionCookie: string;
  kernelApiKey: string | null;
  kernelCliPath: string | null;
  label: "Garmin" | "Oura" | "WHOOP";
  manualAuthorizationAllowed: boolean;
  otp: string | null;
  password: string | null;
  source: WearableSource;
  startUrl: string;
  timeoutMs: number;
  webBaseUrl: string;
  webOrigin: string;
}

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  kernelClient: KernelComputerClient | null;
  kernelSessionId: string | null;
  kernelTunnel: OwnedKernelTunnel | null;
}

interface OwnedKernelTunnel {
  child: ChildProcess;
  processId: number;
  removeParentExitHandler: () => void;
  spawnFailed: boolean;
}

const RUNNER_NAME = "Hosted-local Junction wearable browser runner";
const AUTH_ACTIONS = [
  /\baccept\b/i,
  /\bagree\b/i,
  /\bcontinue\b/i,
  /\bnext\b/i,
  /\blog ?in\b/i,
  /\bsign in\b/i,
  /\bsubmit\b/i,
  /\bverify\b/i,
  /\bauthorize\b/i,
  /\ballow\b/i,
  /\bapprove\b/i,
  /\bgrant\b/i,
  /\bconfirm\b/i,
  /\bconnect\b/i,
] as const;
const AUTH_ACTION_PATTERN = new RegExp(
  AUTH_ACTIONS.map((pattern) => pattern.source).join("|"),
  "iu",
);
const NEGATIVE_AUTH_ACTION_PATTERN =
  /\b(?:cancel|decline|deny|disallow|do not|don't|not now|reject|skip)\b/iu;
const WHOOP_RENDERED_GRANT_PATTERN = /^\s*grant\s*$/iu;
const TRUSTED_AUTHORIZATION_DOMAINS = [
  "junction.com",
  "tryvital.io",
] as const;
const PROVIDER_AUTHORIZATION_DOMAINS = {
  garmin: ["garmin.com"],
  oura: ["ouraring.com"],
  whoop: ["whoop.com"],
} as const;
const REQUIRED_CONSENT_PATTERN = /\b(?:authorization|required|privacy|terms)\b/iu;
const OPTIONAL_MARKETING_PATTERN = /\b(?:marketing|newsletter|offers?|promotions?)\b/iu;
const GARMIN_PARTNER_CONSENT_CHECKBOX_COUNT = 3;
const PROVIDER_AUTOMATION_BLOCKED_GRACE_MS = 15_000;
const KERNEL_TUNNEL_SETUP_TIMEOUT_MS = 60_000;
const KERNEL_TUNNEL_STOP_GRACE_MS = 5_000;
const SENSITIVE_BROWSER_ENVIRONMENT_KEYS = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_WEBHOOK_SECRET",
  "KERNEL_API_KEY",
  "MURPH_E2E_CONNECT_URL",
  "MURPH_E2E_GARMIN_EMAIL",
  "MURPH_E2E_GARMIN_PASSWORD",
  "MURPH_E2E_HOSTED_SESSION_COOKIE",
  "MURPH_E2E_JUNCTION_WEARABLE_SOURCES",
  "MURPH_E2E_KERNEL_CLI_PATH",
  "MURPH_E2E_PROVIDER_EMAIL",
  "MURPH_E2E_PROVIDER_BROWSER",
  "MURPH_E2E_PROVIDER_HEADLESS",
  "MURPH_E2E_PROVIDER_OTP",
  "MURPH_E2E_PROVIDER_PASSWORD",
  "MURPH_E2E_PROVIDER_SOURCE",
  "MURPH_E2E_PROVIDER_TIMEOUT_MS",
  "MURPH_E2E_OURA_EMAIL",
  "MURPH_E2E_OURA_OTP",
  "MURPH_E2E_OURA_PASSWORD",
  "MURPH_E2E_WHOOP_EMAIL",
  "MURPH_E2E_WHOOP_OTP",
  "MURPH_E2E_WHOOP_PASSWORD",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
] as const;

let stage = "configuration";
let activePage: Page | null = null;
let activeConfig: BrowserConfig | null = null;

async function main(): Promise<void> {
  const config = readBrowserConfig(process.env);
  activeConfig = config;
  clearHostedLocalBrowserEnvironment(SENSITIVE_BROWSER_ENVIRONMENT_KEYS);

  stage = "browser_launch";
  const session = await openBrowserSession(config);
  let failure: unknown;
  let failed = false;
  try {
    await session.context.addCookies([
      buildHostedLocalBrowserSessionCookie({
        sessionCookie: config.hostedSessionCookie,
        webBaseUrl: config.webBaseUrl,
      }),
    ]);
    const page = await session.context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(config.timeoutMs);

    stage = "murph_connect_intent";
    await navigateToHostedLocalStart(page, config, session.kernelTunnel);

    stage = "murph_vital_disclosure";
    await page
      .getByRole("dialog")
      .getByRole("button", {
        exact: true,
        name: `Continue to ${config.disclosureSourceName}`,
      })
      .click({ timeout: config.timeoutMs });

    stage = "murph_connect_start";
    await page.waitForURL((url) => url.origin !== config.webOrigin, {
      timeout: config.timeoutMs,
    });

    stage = `junction_${config.source}_authorization`;
    await completeAuthorizationAndRequireCallback(page, config);

    stage = "murph_connected_completion";
    await page.waitForURL(
      (url) => url.origin === config.webOrigin && url.pathname === "/home",
      { timeout: config.timeoutMs },
    );
    await page.getByRole("heading", { name: `${config.label} is connected` }).waitFor({
      timeout: config.timeoutMs,
    });

    stage = "murph_persisted_connect_page";
    await page.goto(new URL("/connect", config.webBaseUrl).toString(), {
      waitUntil: "domcontentloaded",
    });
    await assertWearableConnectionState(page, config, "connected");
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertWearableConnectionState(page, config, "connected");

    stage = "junction_cleanup";
    await disconnectJunctionAccount(page, config);

  } catch (error) {
    failed = true;
    failure = error;
  }

  try {
    stage = failed ? `${stage}_cleanup` : "browser_cleanup";
    await closeBrowserSession(session, config);
  } catch (error) {
    if (!failed) {
      failed = true;
      failure = error;
    }
  }

  if (failed) {
    throw failure;
  }

  process.stdout.write(formatHostedLocalBrowserResult({
    callbackAutoCompleted: true,
    connectedAfterCallback: true,
    connectedAfterReload: true,
    disconnectedDuringCleanup: true,
    provider: "junction",
    source: config.source,
  }));
}

async function openBrowserSession(config: BrowserConfig): Promise<BrowserSession> {
  if (config.browserTransport === "local") {
    const browser = await chromium.launch({
      channel: config.browserChannel,
      headless: config.headless,
    });
    try {
      const context = await browser.newContext({
        locale: "en-US",
        reducedMotion: "reduce",
      });
      return {
        browser,
        context,
        kernelClient: null,
        kernelSessionId: null,
        kernelTunnel: null,
      };
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  const apiKey = config.kernelApiKey;
  const cliPath = config.kernelCliPath;
  if (!apiKey || !cliPath) {
    throw new Error("Kernel browser configuration lost its required authority or CLI path.");
  }
  const tunnelPort = requireKernelTunnelPort(config.webBaseUrl);
  const kernelClient = new KernelComputerClient({ apiKey });
  const kernelProfile = `murph-junction-${config.source}-canary`;
  await kernelClient.ensureProfile(kernelProfile);
  const kernelBrowser = await kernelClient.createAutomationBrowser({
    headless: config.headless,
    profileName: kernelProfile,
    saveChanges: true,
    timeoutSeconds: Math.ceil((config.timeoutMs + 60_000) / 1_000),
  });
  let kernelTunnel: OwnedKernelTunnel | null = null;

  try {
    kernelTunnel = startKernelTunnel({
      apiKey,
      cliPath,
      port: tunnelPort,
      sessionId: kernelBrowser.sessionId,
    });
    const browser = await chromium.connectOverCDP(kernelBrowser.cdpWsUrl, {
      timeout: config.timeoutMs,
    });
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("Kernel browser did not expose its persistent context.");
    }
    return {
      browser,
      context,
      kernelClient,
      kernelSessionId: kernelBrowser.sessionId,
      kernelTunnel,
    };
  } catch (error) {
    if (kernelTunnel) {
      await stopKernelTunnel(kernelTunnel).catch(() => undefined);
    }
    await kernelClient.deleteBrowserByIdOrName(kernelBrowser.sessionId)
      .catch(() => undefined);
    throw error;
  }
}

async function closeBrowserSession(
  session: BrowserSession,
  config: BrowserConfig,
): Promise<void> {
  if (!session.kernelClient || !session.kernelSessionId || !session.kernelTunnel) {
    await session.browser.close();
    return;
  }

  const cleanupErrors: unknown[] = [];
  await session.context.clearCookies({
    domain: new URL(config.webBaseUrl).hostname,
  }).catch((error: unknown) => cleanupErrors.push(error));
  await stopKernelTunnel(session.kernelTunnel)
    .catch((error: unknown) => cleanupErrors.push(error));
  try {
    await session.kernelClient.deleteBrowserByIdOrName(session.kernelSessionId);
  } catch (error) {
    cleanupErrors.push(error);
    await session.browser.close()
      .catch((browserError: unknown) => cleanupErrors.push(browserError));
  }

  if (cleanupErrors.length > 0) {
    throw new Error("Kernel browser cleanup did not complete.");
  }
}

function startKernelTunnel(input: {
  apiKey: string;
  cliPath: string;
  port: number;
  sessionId: string;
}): OwnedKernelTunnel {
  const child = spawn(
    input.cliPath,
    buildKernelTunnelArguments(input.sessionId, input.port),
    {
      detached: true,
      env: buildKernelCliEnvironment(input.apiKey, process.env),
      // Kernel's SSH command opens a remote shell in addition to the reverse
      // forward. Keep its stdin open so EOF does not close that shell and tear
      // down the tunnel before the browser reaches hosted-local Web.
      stdio: ["pipe", "ignore", "ignore"],
    },
  );
  if (child.pid === undefined) {
    child.once("error", () => undefined);
    throw new Error("Kernel reverse tunnel did not start.");
  }
  const tunnel: OwnedKernelTunnel = {
    child,
    processId: child.pid,
    removeParentExitHandler: () => undefined,
    spawnFailed: false,
  };
  const handleParentExit = () => {
    signalOwnedKernelTunnel(tunnel, "SIGTERM");
  };
  process.once("exit", handleParentExit);
  tunnel.removeParentExitHandler = () => {
    process.off("exit", handleParentExit);
  };
  child.once("error", () => {
    tunnel.spawnFailed = true;
  });
  return tunnel;
}

function buildKernelTunnelArguments(sessionId: string, port: number): string[] {
  return [
    "browsers",
    "ssh",
    sessionId,
    "-R",
    `${port}:localhost:${port}`,
  ];
}

function buildKernelCliEnvironment(
  apiKey: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnvironment: NodeJS.ProcessEnv = {
    KERNEL_API_KEY: apiKey,
    NODE_ENV: environment.NODE_ENV ?? "production",
  };
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"] as const) {
    const value = environment[key];
    if (value !== undefined) {
      childEnvironment[key] = value;
    }
  }
  return childEnvironment;
}

function requireKernelTunnelPort(webBaseUrl: string): number {
  const url = new URL(webBaseUrl);
  const port = Number(url.port);
  if (
    url.protocol !== "http:"
    || url.hostname !== "localhost"
    || !Number.isInteger(port)
    || port < 1
    || port > 65_535
  ) {
    throw new Error(
      "Kernel browser transport requires an explicit http://localhost:<port> hosted-local Web URL.",
    );
  }
  return port;
}

async function navigateToHostedLocalStart(
  page: Page,
  config: BrowserConfig,
  tunnel: OwnedKernelTunnel | null,
): Promise<void> {
  if (!tunnel) {
    await page.goto(config.startUrl, { waitUntil: "domcontentloaded" });
    return;
  }

  const deadline = Date.now() + Math.min(
    config.timeoutMs,
    KERNEL_TUNNEL_SETUP_TIMEOUT_MS,
  );
  while (Date.now() < deadline) {
    if (
      tunnel.spawnFailed
      || tunnel.child.exitCode !== null
      || tunnel.child.signalCode !== null
    ) {
      throw new Error("Kernel reverse tunnel exited before reaching hosted-local Web.");
    }
    const remainingMs = deadline - Date.now();
    try {
      await page.goto(config.startUrl, {
        timeout: Math.min(5_000, remainingMs),
        waitUntil: "domcontentloaded",
      });
      return;
    } catch {
      await page.waitForTimeout(Math.min(500, Math.max(1, remainingMs)));
    }
  }
  throw new Error("Kernel reverse tunnel did not reach hosted-local Web in time.");
}

async function stopKernelTunnel(tunnel: OwnedKernelTunnel): Promise<void> {
  tunnel.removeParentExitHandler();
  if (tunnel.child.exitCode !== null || tunnel.child.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) => {
    tunnel.child.once("exit", () => resolve());
    tunnel.child.once("error", () => resolve());
  });
  tunnel.child.kill("SIGTERM");
  if (await resolvesWithin(exited, KERNEL_TUNNEL_STOP_GRACE_MS)) {
    return;
  }

  // This detached process group contains only the Kernel CLI process started
  // above and its SSH child, so its complete ownership is explicit.
  signalOwnedKernelTunnel(tunnel, "SIGKILL");
  if (!await resolvesWithin(exited, KERNEL_TUNNEL_STOP_GRACE_MS)) {
    throw new Error("Kernel reverse tunnel did not stop.");
  }
}

function signalOwnedKernelTunnel(
  tunnel: OwnedKernelTunnel,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-tunnel.processId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

async function resolvesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  const result = await Promise.race([promise.then(() => true as const), timedOut]);
  if (timeout !== undefined) {
    clearTimeout(timeout);
  }
  return result;
}

async function completeExternalAuthorization(
  page: Page,
  config: BrowserConfig,
  now: () => number = Date.now,
): Promise<void> {
  const deadline = now() + config.timeoutMs;
  let automationBlockedObservedAt: number | null = null;
  let blockedWindowObservedChallenge = false;

  while (now() < deadline) {
    if (readOrigin(page.url()) === config.webOrigin) {
      return;
    }

    assertTrustedAuthorizationUrl(page.url(), config);
    const providerChallenge = isHostedLocalProviderChallengeSurface({
      frameUrls: page.frames().map((frame) => frame.url()),
      title: await page.title().catch(() => ""),
    });
    if (providerChallenge) {
      if (config.manualAuthorizationAllowed) {
        await page.waitForTimeout(1_000);
        continue;
      }
    } else {
      await fillVisible(page, [
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[name*="email" i]',
        'input[name="username"]',
      ], config.email);
      if (config.password) {
        await fillVisible(page, [
          'input[type="password"]',
          'input[autocomplete="current-password"]',
        ], config.password);
      }

      const otpInput = await findVisibleEditable(page, [
        'input[autocomplete="one-time-code"]',
        'input[name*="otp" i]',
        'input[name*="verification" i]',
      ]);
      if (otpInput) {
        const currentOtp = await otpInput.inputValue().catch(() => "");
        if (config.otp) {
          if (currentOtp !== config.otp) {
            await otpInput.fill(config.otp);
          }
        } else if (!config.manualAuthorizationAllowed) {
          throw new Error(
            `${config.label} requested a one-time code. Set MURPH_E2E_PROVIDER_OTP; manual entry is available only in a headed non-CI run.`,
          );
        } else if (!currentOtp.trim()) {
          await page.waitForTimeout(1_000);
          continue;
        }
      }

      const completedGarminPartnerConsent = await completeGarminPartnerConsent(
        page,
        config.source,
      );
      if (completedGarminPartnerConsent) {
        automationBlockedObservedAt = null;
        blockedWindowObservedChallenge = false;
        await page.waitForTimeout(750);
        continue;
      }

      await checkRequiredConsentCheckboxes(page);
      const clicked = await clickFirstVisibleAction(
        page,
        AUTH_ACTIONS,
        config.source,
      );
      if (clicked) {
        automationBlockedObservedAt = null;
        blockedWindowObservedChallenge = false;
        await page.waitForTimeout(750);
        continue;
      }
      if (config.manualAuthorizationAllowed) {
        // Headful runs permit manual CAPTCHA or one-time-code completion while
        // the test continues watching for the proof-bound Murph callback.
        await page.waitForTimeout(1_000);
        continue;
      }
    }

    automationBlockedObservedAt ??= now();
    blockedWindowObservedChallenge ||= providerChallenge;
    if (
      now() - automationBlockedObservedAt
        >= PROVIDER_AUTOMATION_BLOCKED_GRACE_MS
    ) {
      if (blockedWindowObservedChallenge) {
        throw new Error(
          `${config.label} authorization was blocked by an external provider challenge.`,
        );
      }
      const surface = await describeAuthorizationSurface(page);
      throw new Error(
        `${config.label} did not expose an automated authorization action. ${surface} Manual completion is available only in a headed non-CI run.`,
      );
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error("Timed out before Junction returned the browser to Murph.");
}

async function completeGarminPartnerConsent(
  page: Page,
  source: BrowserConfig["source"],
): Promise<boolean> {
  const url = new URL(page.url());
  if (
    source !== "garmin"
    || url.hostname !== "connect.garmin.com"
    || url.pathname !== "/partner/oauthConfirm"
  ) {
    return false;
  }

  const checkboxes = page.getByRole("checkbox");
  if (await checkboxes.count() !== GARMIN_PARTNER_CONSENT_CHECKBOX_COUNT) {
    throw new Error(
      `Garmin consent expected exactly ${GARMIN_PARTNER_CONSENT_CHECKBOX_COUNT} data-sharing checkboxes.`,
    );
  }
  for (
    let index = 0;
    index < GARMIN_PARTNER_CONSENT_CHECKBOX_COUNT;
    index += 1
  ) {
    const checkbox = checkboxes.nth(index);
    if (
      !await checkbox.isVisible().catch(() => false)
      || !await checkbox.isEnabled().catch(() => false)
    ) {
      throw new Error("Garmin consent data-sharing checkbox was unavailable.");
    }
    await checkbox.check();
    if (!await checkbox.isChecked().catch(() => false)) {
      throw new Error("Garmin consent data-sharing checkbox was not selected.");
    }
  }

  const save = page.getByRole("button", { exact: true, name: "Save" });
  if (await save.count() !== 1) {
    throw new Error("Garmin consent did not expose one enabled Save action.");
  }
  const saveAction = save.nth(0);
  if (await readAuthorizationActionState(saveAction) !== "enabled") {
    throw new Error("Garmin consent did not expose one enabled Save action.");
  }
  await clickAuthorizationControl(saveAction);
  return true;
}

async function completeAuthorizationAndRequireCallback(
  page: Page,
  config: BrowserConfig,
): Promise<void> {
  const [callbackResponse] = await Promise.all([
    page.waitForResponse(
      (response) => isExpectedJunctionCallbackResponse(response, config.webOrigin),
      { timeout: config.timeoutMs },
    ),
    completeExternalAuthorization(page, config),
  ]);
  if (callbackResponse.status() !== 302) {
    throw new Error("Murph did not complete the Junction callback redirect.");
  }
}

function isExpectedJunctionCallbackResponse(
  response: Pick<Response, "url">,
  webOrigin: string,
): boolean {
  const url = new URL(response.url());
  return url.origin === webOrigin
    && url.pathname === "/api/device-sync/connect/junction/callback";
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

async function checkRequiredConsentCheckboxes(page: Page): Promise<void> {
  const checkboxes = page.getByRole("checkbox");
  for (let index = 0; index < await checkboxes.count(); index += 1) {
    const checkbox = checkboxes.nth(index);
    if (
      !await checkbox.isVisible().catch(() => false)
      || await checkbox.isChecked().catch(() => false)
    ) {
      continue;
    }

    const surroundingText = await checkbox.evaluate((element) => [
      element.getAttribute("aria-label"),
      element.closest("label")?.textContent,
      element.parentElement?.textContent,
    ].filter(Boolean).join(" "));
    if (
      REQUIRED_CONSENT_PATTERN.test(surroundingText)
      && !OPTIONAL_MARKETING_PATTERN.test(surroundingText)
    ) {
      await checkbox.check();
    }
  }
}

async function clickFirstVisibleAction(
  page: Page,
  names: readonly RegExp[],
  source: BrowserConfig["source"],
): Promise<boolean> {
  for (const name of names) {
    for (const role of ["button", "link"] as const) {
      const controls = page.getByRole(role, { name });
      const negativeControls = page.getByRole(role, {
        name: NEGATIVE_AUTH_ACTION_PATTERN,
      });
      for (let index = 0; index < await controls.count(); index += 1) {
        const control = controls.nth(index);
        if (
          await hasNegativeAccessibleName(control, negativeControls)
          || await readAuthorizationActionState(control) !== "enabled"
        ) {
          continue;
        }
        await clickAuthorizationControl(control);
        return true;
      }
    }
  }

  return source === "whoop" && await clickWhoopRenderedGrant(page);
}

async function clickWhoopRenderedGrant(page: Page): Promise<boolean> {
  // WHOOP documents its consent action as a rendered "GRANT" button, while the
  // live button can expose a different accessible name. Element handles bind
  // discovery, safety checks, and the click to one exact element; a rerender
  // detaches that handle instead of rebinding approved text to another control.
  const grantButtons = page.getByRole("button").filter({
    hasText: WHOOP_RENDERED_GRANT_PATTERN,
  });
  const negativeButtons = page.getByRole("button", {
    name: NEGATIVE_AUTH_ACTION_PATTERN,
  });
  const candidates = await grantButtons.elementHandles();
  const hasNegativeAccessibleName = async (
    candidate: (typeof candidates)[number],
  ): Promise<boolean> => {
    const currentNegatives = await negativeButtons.elementHandles();
    try {
      for (const negative of currentNegatives) {
        const matches = await candidate.evaluate(
          (candidateElement, negativeElement) =>
            candidateElement === negativeElement,
          negative,
        ).catch(() => null);
        if (matches === null || matches) return true;
      }
      return false;
    } finally {
      await Promise.all(currentNegatives.map((handle) =>
        handle.dispose().catch(() => undefined)
      ));
    }
  };

  try {
    for (const candidate of candidates) {
      const renderedText = await candidate.innerText().catch(() => "");
      if (
        !WHOOP_RENDERED_GRANT_PATTERN.test(renderedText)
        || await hasNegativeAccessibleName(candidate)
        || !await candidate.isVisible().catch(() => false)
        || !await candidate.isEnabled().catch(() => false)
      ) {
        continue;
      }
      const currentText = await candidate.innerText().catch(() => "");
      if (
        !WHOOP_RENDERED_GRANT_PATTERN.test(currentText)
        || await hasNegativeAccessibleName(candidate)
      ) {
        continue;
      }
      await clickAuthorizationControl(candidate);
      return true;
    }
    return false;
  } finally {
    await Promise.all(candidates.map((handle) =>
      handle.dispose().catch(() => undefined)
    ));
  }
}

async function clickAuthorizationControl(
  control: Pick<Locator, "click">,
): Promise<void> {
  try {
    await control.click();
  } catch (error) {
    const category = error instanceof Error && error.name === "TimeoutError"
      ? "timeout"
      : "other";
    throw new Error(`Authorization action failed (${category}).`);
  }
}

async function hasNegativeAccessibleName(
  control: Locator,
  negativeControls: Locator,
): Promise<boolean> {
  return await control.and(negativeControls).count().catch(() => 1) > 0;
}

async function readAuthorizationActionText(
  control: Locator,
): Promise<string> {
  const [ariaLabel, innerText] = await Promise.all([
    control.getAttribute("aria-label").catch(() => null),
    control.innerText().catch(() => ""),
  ]);
  return [ariaLabel, innerText].filter(Boolean).join(" ");
}

async function readAuthorizationActionState(
  control: Locator,
): Promise<"disabled" | "enabled" | null> {
  const actionText = await readAuthorizationActionText(control);
  if (
    NEGATIVE_AUTH_ACTION_PATTERN.test(actionText)
    || !await control.isVisible().catch(() => false)
  ) {
    return null;
  }
  return await control.isEnabled().catch(() => false) ? "enabled" : "disabled";
}

async function describeAuthorizationSurface(page: Page): Promise<string> {
  const countScope = async (scope: Pick<Page, "getByRole">) => {
    const countActions = async (controls: Locator) => {
      let actions = 0;
      let enabledActions = 0;
      for (let index = 0; index < await controls.count(); index += 1) {
        const state = await readAuthorizationActionState(controls.nth(index));
        if (state !== null) actions += 1;
        if (state === "enabled") enabledActions += 1;
      }
      return { actions, enabledActions };
    };
    let actions = 0;
    let allActions = 0;
    let enabledActions = 0;
    for (const role of ["button", "link"] as const) {
      const all = await countActions(scope.getByRole(role));
      const recognized = await countActions(
        scope.getByRole(role, { name: AUTH_ACTION_PATTERN }),
      );
      allActions += all.actions;
      actions += recognized.actions;
      enabledActions += recognized.enabledActions;
    }
    const checkboxes = scope.getByRole("checkbox");
    let uncheckedCheckboxes = 0;
    for (let index = 0; index < await checkboxes.count(); index += 1) {
      const checkbox = checkboxes.nth(index);
      if (
        await checkbox.isVisible().catch(() => false)
        && !await checkbox.isChecked().catch(() => false)
      ) {
        uncheckedCheckboxes += 1;
      }
    }
    return {
      actions,
      enabledActions,
      otherActions: Math.max(0, allActions - actions),
      uncheckedCheckboxes,
    };
  };
  const mainFrame = page.mainFrame();
  const childFrames = page.frames().filter((frame) => frame !== mainFrame);
  const [main, ...children] = await Promise.all([
    countScope(mainFrame),
    ...childFrames.map(countScope),
  ]);
  const child = children.reduce((total, current) => ({
    actions: total.actions + current.actions,
    enabledActions: total.enabledActions + current.enabledActions,
    otherActions: total.otherActions + current.otherActions,
    uncheckedCheckboxes:
      total.uncheckedCheckboxes + current.uncheckedCheckboxes,
  }), {
    actions: 0,
    enabledActions: 0,
    otherActions: 0,
    uncheckedCheckboxes: 0,
  });
  return [
    "Authorization surface:",
    `childFrames=${childFrames.length}`,
    `mainActions=${main.actions}`,
    `mainEnabledActions=${main.enabledActions}`,
    `mainOtherActions=${main.otherActions}`,
    `childActions=${child.actions}`,
    `childEnabledActions=${child.enabledActions}`,
    `childOtherActions=${child.otherActions}`,
    `mainUncheckedCheckboxes=${main.uncheckedCheckboxes}`,
    `childUncheckedCheckboxes=${child.uncheckedCheckboxes}.`,
  ].join(" ");
}

async function assertWearableConnectionState(
  page: Page,
  config: BrowserConfig,
  state: "connected" | "idle",
): Promise<void> {
  const wearableCard = page
    .getByRole("heading", { name: new RegExp(`^${config.label}$`, "i") })
    .locator("xpath=ancestor::div[.//*[@data-connection-state]][1]");
  await wearableCard.locator(`[data-connection-state="${state}"]`).waitFor({
    timeout: config.timeoutMs,
  });
}

async function disconnectJunctionAccount(
  page: Page,
  config: BrowserConfig,
): Promise<void> {
  await page
    .getByRole("button", { name: new RegExp(`^Disconnect (?:${config.label}|account)$`, "i") })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("heading", {
      name: new RegExp(`^Disconnect (?:${config.label}|account)\\?$`, "i"),
    })
    .waitFor();
  await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page.getByText("Source disconnected", { exact: true }).waitFor({
    timeout: config.timeoutMs,
  });
  await assertWearableConnectionState(page, config, "idle");
}

function readBrowserConfig(environment: NodeJS.ProcessEnv): BrowserConfig {
  const source = requireWearableSource(environment.MURPH_E2E_PROVIDER_SOURCE);
  const label = source === "garmin"
    ? "Garmin"
    : source === "oura"
    ? "Oura"
    : "WHOOP";
  const headless = environment.MURPH_E2E_PROVIDER_HEADLESS !== "0";
  const browserTransport = requireBrowserTransport(
    environment.MURPH_E2E_PROVIDER_BROWSER,
  );
  const ci = environment.CI?.trim().toLowerCase();
  const manualAuthorizationAllowed = !headless && ci !== "1" && ci !== "true";
  const otp = environment.MURPH_E2E_PROVIDER_OTP?.trim() || null;
  const password = environment.MURPH_E2E_PROVIDER_PASSWORD?.trim() || null;
  if ((source === "garmin" || source === "whoop") && !password) {
    throw new Error(
      `Hosted-local Junction ${label} browser runner requires MURPH_E2E_PROVIDER_PASSWORD.`,
    );
  }
  if (source === "oura" && !manualAuthorizationAllowed && !otp) {
    throw new Error(
      "Hosted-local Junction Oura browser runner requires a current MURPH_E2E_PROVIDER_OTP unless it is a headed non-CI run with manual code entry.",
    );
  }
  if (
    browserTransport === "kernel"
    && (
      source === "oura"
      || manualAuthorizationAllowed
      || (source === "whoop" && !headless)
    )
  ) {
    throw new Error(
      "Kernel browser transport requires unattended Garmin or headless WHOOP authorization.",
    );
  }
  const kernelApiKey = browserTransport === "kernel"
    ? readHostedLocalBrowserEnvironmentValue(
      environment,
      "KERNEL_API_KEY",
      RUNNER_NAME,
    )
    : null;
  const kernelCliPath = browserTransport === "kernel"
    ? readHostedLocalBrowserEnvironmentValue(
      environment,
      "MURPH_E2E_KERNEL_CLI_PATH",
      RUNNER_NAME,
    )
    : null;
  if (kernelCliPath && !path.isAbsolute(kernelCliPath)) {
    throw new Error("MURPH_E2E_KERNEL_CLI_PATH must be an absolute path.");
  }
  const webBaseUrl = readHostedLocalBrowserEnvironmentValue(
    environment,
    "MURPH_E2E_WEB_BASE_URL",
    RUNNER_NAME,
  );
  const parsedWebBaseUrl = new URL(webBaseUrl);
  if (browserTransport === "kernel") {
    requireKernelTunnelPort(parsedWebBaseUrl.toString());
  }
  const startUrl = new URL(readHostedLocalBrowserEnvironmentValue(
    environment,
    "MURPH_E2E_CONNECT_URL",
    RUNNER_NAME,
  ));
  const connectIntentParams = new URLSearchParams(startUrl.hash.slice(1));
  if (
    startUrl.origin !== parsedWebBaseUrl.origin
    || startUrl.pathname !== "/connect"
    || !connectIntentParams.has("deviceConnectIntent")
    || connectIntentParams.get("connectSource") !== source
  ) {
    throw new Error(
      `MURPH_E2E_CONNECT_URL must be a signed ${label} /connect device intent on the hosted-local Web origin.`,
    );
  }

  return {
    browserChannel: browserTransport === "local"
        && !headless
        && !manualAuthorizationAllowed
      ? "chrome"
      : undefined,
    browserTransport,
    disclosureSourceName: source === "garmin"
      ? "Garmin"
      : source === "oura"
      ? "Oura"
      : "Whoop",
    email: readHostedLocalBrowserEnvironmentValue(
      environment,
      "MURPH_E2E_PROVIDER_EMAIL",
      RUNNER_NAME,
    ),
    headless,
    hostedSessionCookie: readHostedLocalBrowserEnvironmentValue(
      environment,
      "MURPH_E2E_HOSTED_SESSION_COOKIE",
      RUNNER_NAME,
    ),
    kernelApiKey,
    kernelCliPath,
    label,
    manualAuthorizationAllowed,
    otp,
    password,
    source,
    startUrl: startUrl.toString(),
    timeoutMs: readHostedLocalBrowserTimeout({
      defaultMs: 180_000,
      environment,
      key: "MURPH_E2E_PROVIDER_TIMEOUT_MS",
      maximumMs: 600_000,
      minimumMs: 30_000,
      runnerName: RUNNER_NAME,
    }),
    webBaseUrl: parsedWebBaseUrl.toString().replace(/\/$/u, ""),
    webOrigin: parsedWebBaseUrl.origin,
  };
}

export {
  buildKernelCliEnvironment as buildKernelCliEnvironmentForTest,
  buildKernelTunnelArguments as buildKernelTunnelArgumentsForTest,
  closeBrowserSession as closeHostedLocalJunctionBrowserSessionForTest,
  completeAuthorizationAndRequireCallback as completeHostedLocalJunctionAuthorizationForTest,
  completeExternalAuthorization as completeExternalJunctionAuthorizationForTest,
  openBrowserSession as openHostedLocalJunctionBrowserSessionForTest,
  readBrowserConfig as readHostedLocalJunctionBrowserConfigForTest,
  sanitizeFailure as sanitizeHostedLocalJunctionBrowserFailureForTest,
  stopKernelTunnel as stopHostedLocalJunctionKernelTunnelForTest,
};

function assertTrustedAuthorizationUrl(
  value: string,
  config: BrowserConfig,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Junction or ${config.label} opened an invalid authorization URL.`);
  }

  const hostname = url.hostname.toLowerCase();
  const trustedDomains = [
    ...TRUSTED_AUTHORIZATION_DOMAINS,
    ...PROVIDER_AUTHORIZATION_DOMAINS[config.source],
  ];
  const trusted = trustedDomains.some((domain) =>
    hostname === domain || hostname.endsWith(`.${domain}`)
  );
  if (!trusted || url.protocol !== "https:") {
    throw new Error(
      `Refusing to enter ${config.label} credentials at unexpected authorization host ${hostname}.`,
    );
  }
}

function requireWearableSource(value: string | undefined): WearableSource {
  const source = value?.trim();
  if (source === "garmin" || source === "oura" || source === "whoop") {
    return source;
  }
  throw new Error("MURPH_E2E_PROVIDER_SOURCE must be garmin, oura, or whoop.");
}

function requireBrowserTransport(
  value: string | undefined,
): "kernel" | "local" {
  const transport = value?.trim() || "local";
  if (transport === "kernel" || transport === "local") {
    return transport;
  }
  throw new Error("MURPH_E2E_PROVIDER_BROWSER must be kernel or local.");
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
    config?.kernelApiKey,
    config?.startUrl,
  ]) {
    if (secret) {
      message = message.replaceAll(secret, "[redacted]");
    }
  }
  message = message.replace(/(?:https?|wss?):\/\/[^\s)"']+/gu, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === "ws:" || url.protocol === "wss:") {
        return "[redacted-url]";
      }
      return `${url.origin}${url.pathname}`;
    } catch {
      return "[url]";
    }
  });
  return message.slice(0, 600);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Junction wearable browser E2E failed at ${stage} (${safePageLocation(activePage)}): ${
        sanitizeFailure(error, activeConfig)
      }\n`,
    );
    process.exitCode = 1;
  });
}
