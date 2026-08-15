import { pathToFileURL } from "node:url";

import {
  chromium,
  type Frame,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import {
  buildHostedLocalBrowserSessionCookie,
  clearHostedLocalBrowserEnvironment,
  formatHostedLocalBrowserResult,
  readHostedLocalBrowserEnvironmentValue,
  readHostedLocalBrowserTimeout,
} from "./hosted-local-browser-process.ts";
import { isHostedLocalProviderChallengeSurface } from "./hosted-local-provider-challenge.ts";

interface BrowserConfig {
  browserChannel: "chrome" | undefined;
  disclosureSourceName: "Oura" | "Whoop";
  email: string;
  headless: boolean;
  hostedSessionCookie: string;
  label: "Oura" | "WHOOP";
  manualAuthorizationAllowed: boolean;
  otp: string | null;
  password: string | null;
  source: "oura" | "whoop";
  startUrl: string;
  timeoutMs: number;
  webBaseUrl: string;
  webOrigin: string;
}

interface AuthorizationActionSummary {
  negative: number;
  positive: number;
  positiveHidden: number;
  positiveInChildFrames: number;
  positiveVisible: number;
  positiveVisibleDisabled: number;
  positiveVisibleEnabled: number;
  positiveVisibleEnabledInChildFrames: number;
}

interface AuthorizationCheckboxSummary {
  total: number;
  visible: number;
  visibleChecked: number;
  visibleUnchecked: number;
}

interface PositiveAuthorizationControlSummary {
  total: number;
  visible: number;
  visibleEnabled: number;
}

interface AuthorizationSurfaceSummary {
  actions: AuthorizationActionSummary;
  challengeFrameCount: number;
  checkboxes: AuthorizationCheckboxSummary;
  crossOriginFrameCount: number;
  formCount: number;
  frameCount: number;
  readyState: "complete" | "interactive" | "loading" | "unknown";
}

type AuthorizationRoot = Frame | Page;

const RUNNER_NAME = "Hosted-local Junction wearable browser runner";
const POSITIVE_AUTH_ACTION_PATTERN =
  /\b(?:accept|agree|continue|next|log ?in|sign in|submit|verify|authorize|allow|approve|grant|confirm|connect)\b/iu;
const NEGATIVE_AUTH_ACTION_PATTERN =
  /\b(?:cancel|decline|deny|disallow|do not|don(?:\u0027|\u2019)t|not now|reject|skip)\b/iu;
const SAFE_AUTH_ACTION_PATTERN = new RegExp(
  `^(?![\\s\\S]*${NEGATIVE_AUTH_ACTION_PATTERN.source})[\\s\\S]*${
    POSITIVE_AUTH_ACTION_PATTERN.source
  }`,
  "iu",
);
const TRUSTED_AUTHORIZATION_DOMAINS = [
  "junction.com",
  "tryvital.io",
] as const;
const PROVIDER_AUTHORIZATION_DOMAINS = {
  oura: ["ouraring.com"],
  whoop: ["whoop.com"],
} as const;
const REQUIRED_CONSENT_PATTERN = /\b(?:authorization|required|privacy|terms)\b/iu;
const OPTIONAL_MARKETING_PATTERN = /\b(?:marketing|newsletter|offers?|promotions?)\b/iu;
const PROVIDER_AUTOMATION_BLOCKED_GRACE_MS = 15_000;
const SENSITIVE_BROWSER_ENVIRONMENT_KEYS = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "JUNCTION_WEBHOOK_SECRET",
  "MURPH_E2E_CONNECT_URL",
  "MURPH_E2E_HOSTED_SESSION_COOKIE",
  "MURPH_E2E_JUNCTION_WEARABLE_SOURCES",
  "MURPH_E2E_PROVIDER_EMAIL",
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
  const browser = await chromium.launch({
    channel: config.browserChannel,
    headless: config.headless,
  });
  try {
    const context = await browser.newContext({
      locale: "en-US",
      reducedMotion: "reduce",
    });
    await context.addCookies([
      buildHostedLocalBrowserSessionCookie({
        sessionCookie: config.hostedSessionCookie,
        webBaseUrl: config.webBaseUrl,
      }),
    ]);
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(config.timeoutMs);

    stage = "murph_connect_intent";
    await page.goto(config.startUrl, {
      waitUntil: "domcontentloaded",
    });

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

    process.stdout.write(formatHostedLocalBrowserResult({
      callbackAutoCompleted: true,
      connectedAfterCallback: true,
      connectedAfterReload: true,
      disconnectedDuringCleanup: true,
      provider: "junction",
      source: config.source,
    }));
  } finally {
    await browser.close();
  }
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

      await checkRequiredConsentCheckboxes(page);
      const clicked = await clickFirstVisibleAction(page);
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
      const surface = await summarizeAuthorizationSurface(page);
      throw new Error(
        `${config.label} did not expose an automated authorization action. Manual completion is available only in a headed non-CI run. Authorization surface: ${JSON.stringify(surface)}.`,
      );
    }
    await page.waitForTimeout(1_000);
  }

  throw new Error("Timed out before Junction returned the browser to Murph.");
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
): Promise<boolean> {
  for (const role of ["button", "link"] as const) {
    const controls = page.getByRole(role, { name: SAFE_AUTH_ACTION_PATTERN });
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index);
      if (
        !await control.isVisible().catch(() => false)
        || !await control.isEnabled().catch(() => false)
      ) {
        continue;
      }
      await control.click();
      return true;
    }
  }
  return false;
}

async function summarizeAuthorizationSurface(
  page: Page,
): Promise<AuthorizationSurfaceSummary> {
  const pageOrigin = readOrigin(page.url());
  const frames = page.frames();
  const frameUrls = frames.map((frame) => frame.url());
  const roots: AuthorizationRoot[] = [page, ...frames.slice(1)];
  const readyState = await page.evaluate(() => document.readyState).catch(() => "unknown");

  return {
    actions: await summarizeAuthorizationActions(roots),
    challengeFrameCount: frameUrls.filter((url) =>
      isHostedLocalProviderChallengeSurface({ frameUrls: [url], title: "" })
    ).length,
    checkboxes: await summarizeAuthorizationCheckboxes(roots),
    crossOriginFrameCount: frameUrls.filter((url) => {
      const origin = readOrigin(url);
      return origin !== null && pageOrigin !== null && origin !== pageOrigin;
    }).length,
    formCount: await sumLocatorCounts(roots, "form"),
    frameCount: frameUrls.length,
    readyState: readyState === "complete"
        || readyState === "interactive"
        || readyState === "loading"
      ? readyState
      : "unknown",
  };
}

async function summarizeAuthorizationActions(
  roots: readonly AuthorizationRoot[],
): Promise<AuthorizationActionSummary> {
  const summary: AuthorizationActionSummary = {
    negative: 0,
    positive: 0,
    positiveHidden: 0,
    positiveInChildFrames: 0,
    positiveVisible: 0,
    positiveVisibleDisabled: 0,
    positiveVisibleEnabled: 0,
    positiveVisibleEnabledInChildFrames: 0,
  };

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    if (!root) {
      continue;
    }
    const inChildFrame = rootIndex > 0;
    for (const role of ["button", "link"] as const) {
      summary.negative += await root
        .getByRole(role, {
          includeHidden: true,
          name: NEGATIVE_AUTH_ACTION_PATTERN,
        })
        .count()
        .catch(() => 0);
      const allPositiveControls = root.getByRole(role, {
        includeHidden: true,
        name: SAFE_AUTH_ACTION_PATTERN,
      });
      const positive = await allPositiveControls.evaluateAll((elements) => {
        let visible = 0;
        let visibleEnabled = 0;

        for (const element of elements) {
          const bounds = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          if (
            style.visibility === "hidden"
            || style.visibility === "collapse"
            || bounds.width === 0
            || bounds.height === 0
          ) {
            continue;
          }

          visible += 1;
          let disabled = element.matches(":disabled");
          for (
            let current: Element | null = element;
            !disabled && current;
            current = current.parentElement
          ) {
            disabled = current.getAttribute("aria-disabled")?.toLowerCase() === "true";
          }
          if (!disabled) {
            visibleEnabled += 1;
          }
        }

        return {
          total: elements.length,
          visible,
          visibleEnabled,
        };
      }).catch((): PositiveAuthorizationControlSummary => ({
        total: 0,
        visible: 0,
        visibleEnabled: 0,
      }));

      summary.positive += positive.total;
      summary.positiveHidden += positive.total - positive.visible;
      summary.positiveVisible += positive.visible;
      summary.positiveVisibleDisabled += positive.visible - positive.visibleEnabled;
      summary.positiveVisibleEnabled += positive.visibleEnabled;
      if (inChildFrame) {
        summary.positiveInChildFrames += positive.total;
        summary.positiveVisibleEnabledInChildFrames += positive.visibleEnabled;
      }
    }
  }

  return summary;
}

async function summarizeAuthorizationCheckboxes(
  roots: readonly AuthorizationRoot[],
): Promise<AuthorizationCheckboxSummary> {
  const summary: AuthorizationCheckboxSummary = {
    total: 0,
    visible: 0,
    visibleChecked: 0,
    visibleUnchecked: 0,
  };
  for (const root of roots) {
    const checkboxes = root.getByRole("checkbox", { includeHidden: true });
    const count = await checkboxes.count().catch(() => 0);
    summary.total += count;
    for (let index = 0; index < count; index += 1) {
      const checkbox = checkboxes.nth(index);
      if (!await checkbox.isVisible().catch(() => false)) {
        continue;
      }
      summary.visible += 1;
      if (await checkbox.isChecked().catch(() => false)) {
        summary.visibleChecked += 1;
      } else {
        summary.visibleUnchecked += 1;
      }
    }
  }

  return summary;
}

async function sumLocatorCounts(
  roots: readonly AuthorizationRoot[],
  selector: string,
): Promise<number> {
  let total = 0;
  for (const root of roots) {
    total += await root.locator(selector).count().catch(() => 0);
  }
  return total;
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
  const label = source === "oura" ? "Oura" : "WHOOP";
  const headless = environment.MURPH_E2E_PROVIDER_HEADLESS !== "0";
  const ci = environment.CI?.trim().toLowerCase();
  const manualAuthorizationAllowed = !headless && ci !== "1" && ci !== "true";
  const otp = environment.MURPH_E2E_PROVIDER_OTP?.trim() || null;
  const password = environment.MURPH_E2E_PROVIDER_PASSWORD?.trim() || null;
  if (source === "whoop" && !password) {
    throw new Error(
      "Hosted-local Junction WHOOP browser runner requires MURPH_E2E_PROVIDER_PASSWORD.",
    );
  }
  if (source === "oura" && !manualAuthorizationAllowed && !otp) {
    throw new Error(
      "Hosted-local Junction Oura browser runner requires a current MURPH_E2E_PROVIDER_OTP unless it is a headed non-CI run with manual code entry.",
    );
  }
  const webBaseUrl = readHostedLocalBrowserEnvironmentValue(
    environment,
    "MURPH_E2E_WEB_BASE_URL",
    RUNNER_NAME,
  );
  const parsedWebBaseUrl = new URL(webBaseUrl);
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
    browserChannel: !headless && !manualAuthorizationAllowed ? "chrome" : undefined,
    disclosureSourceName: source === "oura" ? "Oura" : "Whoop",
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
  completeAuthorizationAndRequireCallback as completeHostedLocalJunctionAuthorizationForTest,
  completeExternalAuthorization as completeExternalJunctionAuthorizationForTest,
  readBrowserConfig as readHostedLocalJunctionBrowserConfigForTest,
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

function requireWearableSource(value: string | undefined): "oura" | "whoop" {
  const source = value?.trim();
  if (source === "oura" || source === "whoop") {
    return source;
  }
  throw new Error("MURPH_E2E_PROVIDER_SOURCE must be oura or whoop.");
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
    config?.startUrl,
  ]) {
    if (secret) {
      message = message.replaceAll(secret, "[redacted]");
    }
  }
  message = message.replace(/https?:\/\/[^\s)"']+/gu, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
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
