import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Frame,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";

import type { HostedAppSessionForTest } from "./hosted-member-seeds";

const DEFAULT_BROWSER_TIMEOUT_MS = 120_000;

export type HostedBillingBrowserSurface =
  | "murph-family-accept"
  | "murph-join"
  | "murph-settings"
  | "stripe-checkout"
  | "stripe-portal";

export interface HostedBillingBrowserDiagnostic {
  step: string;
  surface: HostedBillingBrowserSurface;
  status: "failed" | "passed" | "started";
}

export interface HostedBillingBrowserDriverInput {
  diagnosticsPath: string;
  runId: string;
  timeoutMs?: number;
  webBaseUrl: string;
}

export interface HostedBillingBrowserActor {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export interface HostedBillingCheckoutStart {
  sessionId: string;
}

export interface HostedFamilyInviteStart {
  acceptUrl: string;
}

export class HostedBillingBrowserDriver {
  readonly runId: string;
  readonly timeoutMs: number;
  readonly webBaseUrl: string;

  private readonly diagnosticsPath: string;
  private readonly diagnostics: HostedBillingBrowserDiagnostic[] = [];
  private browser: Browser | null = null;

  constructor(input: HostedBillingBrowserDriverInput) {
    this.diagnosticsPath = input.diagnosticsPath;
    this.runId = input.runId;
    this.timeoutMs = input.timeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS;
    this.webBaseUrl = input.webBaseUrl;
  }

  async start(input: { headless?: boolean } = {}): Promise<void> {
    if (this.browser) {
      throw new Error("Hosted billing browser driver is already started.");
    }
    this.browser = await chromium.launch({
      env: buildSanitizedBrowserEnvironmentForTest(process.env),
      headless: input.headless ?? true,
    });
  }

  async createActor(session: HostedAppSessionForTest): Promise<HostedBillingBrowserActor> {
    const browser = this.requireBrowser();
    const context = await browser.newContext({
      locale: "en-US",
      reducedMotion: "reduce",
    });
    const cookieUrl = new URL(this.webBaseUrl);
    if (session.cookieName.startsWith("__Host-")) {
      cookieUrl.protocol = "https:";
    }
    await context.addCookies([{
      httpOnly: true,
      name: session.cookieName,
      sameSite: "Lax",
      secure: session.secureCookieMode,
      url: cookieUrl.toString(),
      value: session.cookieValue,
    }]);
    const page = await context.newPage();
    page.setDefaultTimeout(this.timeoutMs);
    page.setDefaultNavigationTimeout(this.timeoutMs);
    return {
      close: async () => context.close(),
      context,
      page,
    };
  }

  async activateStarterUsage(
    actor: HostedBillingBrowserActor,
    inviteCode: string,
  ): Promise<void> {
    await this.runStep("starter-usage-activate", "murph-join", async () => {
      const [response, navigation] = await Promise.all([
        actor.page.waitForResponse(
          isApiResponse("/api/hosted-onboarding/starter/enroll", "POST"),
        ),
        actor.page.goto(
          this.murphUrl(`/join/${encodeURIComponent(inviteCode)}`),
          { waitUntil: "commit" },
        ),
      ]);
      assertSuccessfulNavigation(navigation, "Murph invite");
      await assertSuccessfulResponse(response);
      await actor.page.waitForURL(
        (url) => url.origin === new URL(this.webBaseUrl).origin
          && url.pathname === "/home",
      );
    });
  }

  async beginDirectPlanCheckout(
    actor: HostedBillingBrowserActor,
    planName: "Edge" | "Pulse",
  ): Promise<HostedBillingCheckoutStart> {
    return this.runStep("direct-plan-checkout-open", "murph-settings", async () => {
      await this.openSettings(actor);
      const [response] = await Promise.all([
        actor.page.waitForResponse(
          isApiResponse("/api/settings/billing/checkout", "POST"),
        ),
        clickHydratedMurphControl(
          actor.page,
          actor.page.getByRole("button", {
            exact: true,
            name: `Choose ${planName}`,
          }),
        ),
      ]);
      await assertSuccessfulResponse(response);
      await this.waitForStripeSurface(actor.page, "checkout");
      return { sessionId: readStripeCheckoutSessionId(actor.page.url()) };
    });
  }

  async beginFamilyCheckout(
    actor: HostedBillingBrowserActor,
  ): Promise<HostedBillingCheckoutStart> {
    return this.runStep("family-checkout-open", "murph-settings", async () => {
      await this.openSettings(actor);
      await clickHydratedMurphControl(
        actor.page,
        actor.page.getByRole("button", {
          exact: true,
          name: "Start your own Family plan",
        }),
      );
      const [response] = await Promise.all([
        actor.page.waitForResponse(
          isApiResponse("/api/settings/billing/family/checkout", "POST"),
        ),
        clickHydratedMurphControl(
          actor.page,
          actor.page.getByRole("button", {
            exact: true,
            name: "Start a plan I pay for",
          }),
        ),
      ]);
      await assertSuccessfulResponse(response);
      await this.waitForStripeSurface(actor.page, "checkout");
      return { sessionId: readStripeCheckoutSessionId(actor.page.url()) };
    });
  }

  async convertPaidIndividualToFamily(
    actor: HostedBillingBrowserActor,
  ): Promise<void> {
    await this.runStep("settings-convert-paid-individual-to-family", "murph-settings", async () => {
      await this.openSettings(actor);
      await clickHydratedMurphControl(
        actor.page,
        actor.page.getByRole("button", {
          exact: true,
          name: "Start your own Family plan",
        }),
      );
      const [response] = await Promise.all([
        actor.page.waitForResponse(
          isApiResponse("/api/settings/billing/family/checkout", "POST"),
        ),
        clickHydratedMurphControl(
          actor.page,
          actor.page.getByRole("button", {
            exact: true,
            name: "Start a plan I pay for",
          }),
        ),
      ]);
      const payload = await readJsonResponse(response);
      if (readOptionalBoolean(payload, "alreadyActive") !== false) {
        throw new Error("Murph did not start the paid individual to Family conversion.");
      }
      if (readOptionalUrl(payload, "url") !== null) {
        throw new Error("Paid individual to Family unexpectedly required a new Checkout.");
      }
      await actor.page.getByRole("status").filter({
        hasText: "Your Family plan is syncing with Stripe.",
      }).waitFor();
    });
  }

  async assertStripeCheckoutReady(actor: HostedBillingBrowserActor): Promise<void> {
    await this.runStep("stripe-checkout-provider-boundary", "stripe-checkout", async () => {
      assertStripeSurface(actor.page.url(), "checkout");
      await assertStripeHostedCardFieldsReady(actor.page, this.timeoutMs);
      await assertStripePositiveActionVisible(actor.page, [
        /^Subscribe$/iu,
        /^Pay$/iu,
        /^Complete order$/iu,
      ]);
    });
  }

  async openPaidPulseEdgeConfirmation(actor: HostedBillingBrowserActor): Promise<void> {
    await this.runStep("settings-paid-pulse-open-edge-portal", "murph-settings", async () => {
      await this.openSettings(actor);
      const [response] = await Promise.all([
        actor.page.waitForResponse(
          isApiResponse("/api/settings/billing/upgrade-plan", "POST"),
        ),
        clickHydratedMurphControl(
          actor.page,
          actor.page.getByRole("button", {
            exact: true,
            name: "Choose Edge",
          }),
        ),
      ]);
      await assertSuccessfulResponse(response);
      await this.waitForStripeSurface(actor.page, "portal");
      await assertStripePlanActionVisible({
        actionNames: [
          /^Confirm/iu,
          /^Confirm change$/iu,
          /^Update subscription$/iu,
          /^Switch plan$/iu,
        ],
        page: actor.page,
        planName: "Edge",
        timeoutMs: this.timeoutMs,
      });
    });
  }

  async schedulePulseAtRenewal(actor: HostedBillingBrowserActor): Promise<void> {
    await this.runStep("settings-schedule-pulse", "murph-settings", async () => {
      await this.openSettings(actor);
      await clickHydratedMurphControl(
        actor.page,
        actor.page.getByRole("button", {
          exact: true,
          name: "Choose Pulse",
        }),
      );
      const dialog = actor.page.getByRole("dialog");
      await dialog.getByRole("heading", { name: "Switch to Pulse" }).waitFor();
      const [response] = await Promise.all([
        actor.page.waitForResponse(
          isApiResponse("/api/settings/billing/switch-to-pulse", "POST"),
        ),
        clickHydratedMurphControl(
          actor.page,
          dialog.getByRole("button", {
            exact: true,
            name: "Confirm switch",
          }),
        ),
      ]);
      await assertSuccessfulResponse(response);
      await this.openSettings(actor);
    });
  }

  async createNameOnlyFamilyInvite(
    actor: HostedBillingBrowserActor,
  ): Promise<HostedFamilyInviteStart> {
    return this.runStep("settings-family-invite", "murph-settings", async () => {
      await this.openSettings(actor);
      await clickHydratedMurphControl(
        actor.page,
        actor.page.getByRole("button", {
          exact: true,
          name: "Invite member",
        }),
      );
      const dialog = actor.page.getByRole("dialog");
      await dialog.getByLabel("Name").fill("Family member");
      await dialog.getByText("No contact? Anyone with the link can join.", {
        exact: true,
      }).waitFor();
      const [response] = await Promise.all([
        actor.page.waitForResponse(
          isApiResponse("/api/settings/billing/family/invite", "POST"),
        ),
        clickHydratedMurphControl(
          actor.page,
          dialog.getByRole("button", {
            exact: true,
            name: "Create invite",
          }),
        ),
      ]);
      const payload = await readJsonResponse(response);
      const invite = readRequiredRecord(payload, "invite");
      const acceptUrl = readRequiredUrl(invite, "acceptUrl");
      await dialog.getByText("Anyone with this link can join.", { exact: true }).waitFor();
      return { acceptUrl };
    });
  }

  async acceptFamilyInvite(
    actor: HostedBillingBrowserActor,
    acceptUrl: string,
  ): Promise<void> {
    await this.runStep("family-invite-accept", "murph-family-accept", async () => {
      const url = new URL(acceptUrl);
      if (url.origin !== new URL(this.webBaseUrl).origin) {
        throw new Error("Family invite acceptance URL did not return to Murph.");
      }
      await actor.page.goto(url.toString(), { waitUntil: "commit" });
      const [response] = await Promise.all([
        actor.page.waitForResponse((candidateResponse) => {
          const candidate = new URL(candidateResponse.url());
          return candidateResponse.request().method() === "POST"
            && candidate.origin === new URL(this.webBaseUrl).origin
            && /^\/api\/family\/invites\/[^/]+\/accept$/u.test(candidate.pathname);
        }),
        clickHydratedMurphControl(
          actor.page,
          actor.page.getByRole("button", {
            exact: true,
            name: "Accept invite",
          }),
        ),
      ]);
      await assertSuccessfulResponse(response);
      await actor.page.getByText("You're in. Welcome to Murph.", {
        exact: true,
      }).waitFor();
    });
  }

  async openSettings(actor: HostedBillingBrowserActor): Promise<void> {
    const target = new URL(this.murphUrl("/settings#subscription"));
    const current = new URL(actor.page.url());
    if (current.origin === target.origin && current.pathname === target.pathname) {
      // A navigation that differs only by the subscription hash is a
      // same-document navigation and preserves a stale server projection.
      // Force a request when a workflow has mutated billing in another page.
      await actor.page.reload({ waitUntil: "commit" });
    } else {
      await actor.page.goto(target.toString(), { waitUntil: "commit" });
    }
    await actor.page.getByText("Subscription", { exact: true }).first().waitFor();
  }

  async assertSettingsText(
    actor: HostedBillingBrowserActor,
    text: string | RegExp,
  ): Promise<void> {
    await this.runStep("settings-projection", "murph-settings", async () => {
      await this.openSettings(actor);
      await actor.page.getByText(text, { exact: false }).first().waitFor();
    });
  }

  async assertSettingsPlanState(
    actor: HostedBillingBrowserActor,
    input: {
      planName: "Edge" | "Family" | "Pulse";
      stateLabel: "Current plan" | "Free trial" | "Sponsored";
    },
  ): Promise<void> {
    await this.runStep("settings-plan-projection", "murph-settings", async () => {
      await this.openSettings(actor);
      const card = await findSettingsPlanCard(
        actor.page,
        input.planName,
        this.timeoutMs,
      );
      await card.getByText(input.stateLabel, { exact: true }).first().waitFor({
        state: "visible",
        timeout: this.timeoutMs,
      });
      if (input.stateLabel === "Current plan") {
        const currentAction = card.getByRole("button", {
          exact: true,
          name: "Current plan",
        });
        await currentAction.waitFor({ state: "visible", timeout: this.timeoutMs });
        if (await currentAction.isEnabled()) {
          throw new Error(`${input.planName} current-plan action must be disabled.`);
        }
        if (await card.getByText("Free trial", { exact: true }).count() > 0) {
          throw new Error(`${input.planName} paid plan still renders the Free trial state.`);
        }
      }
    });
  }

  async assertFamilyActivePulseMemberRow(
    actor: HostedBillingBrowserActor,
  ): Promise<void> {
    await this.runStep("settings-family-member-row", "murph-settings", async () => {
      await this.openSettings(actor);
      // Anchor both badges to one real responsive-table row so an owner row's
      // Pulse badge cannot satisfy the invited member's Active assertion.
      const activeBadge = actor.page.locator("tbody")
        .getByText("Active", { exact: true })
        .first();
      try {
        await activeBadge.waitFor({ state: "visible", timeout: 15_000 });
      } catch {
        throw new Error(
          `Family Settings did not render the active Pulse member row (${await classifyFamilySettingsForTest(actor.page)}).`,
        );
      }
      const row = activeBadge.locator("xpath=ancestor::tr[1]");
      await row.getByText("Pulse", { exact: true }).waitFor({ timeout: 15_000 });
    });
  }

  async recordFailure(error: unknown, input: {
    step: string;
    surface: HostedBillingBrowserSurface;
  }): Promise<void> {
    this.diagnostics.push({
      status: "failed",
      step: input.step,
      surface: input.surface,
    });
    await this.writeDiagnostics();
    if (error instanceof Error) {
      error.message = `${redactHostedBillingBrowserErrorForTest(error.message)} [billing-step=${input.step}]`;
      if (error.stack) {
        error.stack = redactHostedBillingBrowserErrorForTest(error.stack);
      }
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  private async runStep<T>(
    step: string,
    surface: HostedBillingBrowserSurface,
    run: () => Promise<T>,
  ): Promise<T> {
    this.diagnostics.push({ status: "started", step, surface });
    try {
      const result = await run();
      this.diagnostics.push({ status: "passed", step, surface });
      return result;
    } catch (error) {
      await this.recordFailure(error, { step, surface });
      throw error;
    }
  }

  private async waitForStripeSurface(
    page: Page,
    expected: "checkout" | "portal",
  ): Promise<void> {
    await page.waitForURL((url) => readStripeSurfaceForTest(url) === expected, {
      timeout: this.timeoutMs,
      waitUntil: "commit",
    });
  }

  private murphUrl(path: string): string {
    return new URL(path, this.webBaseUrl).toString();
  }

  private requireBrowser(): Browser {
    if (!this.browser) {
      throw new Error("Hosted billing browser driver is not started.");
    }
    return this.browser;
  }

  private async writeDiagnostics(): Promise<void> {
    await mkdir(dirname(this.diagnosticsPath), { recursive: true });
    await writeFile(this.diagnosticsPath, `${JSON.stringify({
      diagnostics: this.diagnostics,
      runId: this.runId,
    }, null, 2)}\n`, { mode: 0o600 });
  }
}

async function classifyFamilySettingsForTest(page: Page): Promise<string> {
  const visibleCount = async (locator: Locator): Promise<number> => {
    let count = 0;
    for (let index = 0; index < await locator.count(); index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) {
        count += 1;
      }
    }
    return count;
  };
  const [active, family, pending, pulse, rows, tables] = await Promise.all([
    visibleCount(page.getByText("Active", { exact: true })),
    visibleCount(page.getByText("Family", { exact: true })),
    visibleCount(page.getByText("Pending", { exact: true })),
    visibleCount(page.getByText("Pulse", { exact: true })),
    visibleCount(page.locator("tbody > tr")),
    visibleCount(page.locator("table")),
  ]);
  return `tables=${tables},rows=${rows},family=${family},pulse=${pulse},active=${active},pending=${pending}`;
}

export function buildSanitizedBrowserEnvironmentForTest(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const allowedKeys = [
    "CHROME_DEVEL_SANDBOX",
    "DISPLAY",
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_ENV",
    "PATH",
    "TMPDIR",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
  ] as const;
  return Object.fromEntries(allowedKeys.flatMap((key) => {
    const value = source[key];
    return value === undefined ? [] : [[key, value]];
  }));
}

export function redactHostedBillingBrowserErrorForTest(value: string): string {
  return value
    .replace(/\/(?:Users|home)\/[^/\s]+(?=\/)/gu, "<HOME_DIR>")
    .replace(/[A-Z]:\\Users\\[^\\\s]+(?=\\)/giu, "<HOME_DIR>")
    .replace(/https?:\/\/[^\s)\]}]+/giu, "[redacted-url]")
    .replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]+\b/gu, "[redacted-stripe-key]")
    .replace(/\bwhsec_[A-Za-z0-9_]+\b/gu, "[redacted-webhook-secret]")
    .replace(
      /\b(?:cs_(?:test|live)|cus|sub|in|pi|pm|seti|bpc|price|sub_sched|clock)_[A-Za-z0-9_]+\b/gu,
      "[redacted-stripe-id]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[redacted-email]")
    .replace(/4242(?:[ -]?4242){3}/gu, "[redacted-test-card]")
    .replace(/(["'])1234\1/gu, "[redacted-card-field]")
    .replace(/(["'])123\1/gu, "[redacted-card-field]");
}

function isApiResponse(pathname: string, method: string) {
  return (response: Response): boolean => {
    const url = new URL(response.url());
    return url.pathname === pathname && response.request().method() === method;
  };
}

function assertSuccessfulNavigation(
  response: Response | null,
  label: string,
): void {
  if (!response) {
    throw new Error(`${label} navigation did not return an HTTP response.`);
  }
  if (!response.ok()) {
    throw new Error(`${label} navigation returned HTTP ${response.status()}.`);
  }
}

async function clickHydratedMurphControl(
  page: Page,
  control: Locator,
): Promise<void> {
  await control.waitFor({ state: "visible" });
  const element = await control.elementHandle();
  if (!element) {
    throw new Error("Murph browser control detached before hydration.");
  }
  try {
    await page.waitForFunction((candidate) => Object.entries(candidate).some(
      ([key, value]) => key.startsWith("__reactProps$")
        && value !== null
        && typeof value === "object"
        && typeof Reflect.get(value, "onClick") === "function",
    ), element);
  } finally {
    await element.dispose();
  }
  await control.click();
}

async function assertSuccessfulResponse(response: Response): Promise<void> {
  if (!response.ok()) {
    throw new Error(`Murph billing route returned HTTP ${response.status()}.`);
  }
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  await assertSuccessfulResponse(response);
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Murph billing route returned an invalid JSON response.");
  }
  return payload as Record<string, unknown>;
}

function readRequiredRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Murph billing response omitted ${key}.`);
  }
  return value as Record<string, unknown>;
}

function readRequiredUrl(source: Record<string, unknown>, key: string): string {
  const value = readOptionalUrl(source, key);
  if (!value) {
    throw new Error(`Murph billing response omitted ${key}.`);
  }
  return value;
}

function readOptionalUrl(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Murph billing response returned an invalid ${key}.`);
  }
}

function readOptionalBoolean(
  source: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = source[key];
  return typeof value === "boolean" ? value : null;
}

function readStripeCheckoutSessionId(url: string): string {
  const match = url.match(/\bcs_test_[A-Za-z0-9_]+\b/u);
  if (!match) {
    throw new Error("Stripe Checkout URL did not contain a test-mode Session id.");
  }
  return match[0];
}

export function readStripeSurfaceForTest(
  url: URL,
): "checkout" | "portal" | null {
  const host = url.hostname.toLowerCase();
  if (host === "checkout.stripe.com") {
    return "checkout";
  }
  if (host === "billing.stripe.com") {
    return "portal";
  }
  return null;
}

function assertStripeSurface(
  rawUrl: string,
  expected: "checkout" | "portal",
): void {
  if (readStripeSurfaceForTest(new URL(rawUrl)) !== expected) {
    throw new Error(`Browser was not on the expected Stripe ${expected} surface.`);
  }
}

async function assertStripeHostedCardFieldsReady(
  page: Page,
  timeoutMs: number,
): Promise<void> {
  const fields = [
    ['input[name="cardNumber"]', 'input[autocomplete="cc-number"]'],
    ['input[name="cardExpiry"]', 'input[autocomplete="cc-exp"]'],
    ['input[name="cardCvc"]', 'input[autocomplete="cc-csc"]'],
  ] as const;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await Promise.all(fields.map(async (selectors) => {
      for (const frame of page.frames()) {
        if (await findVisibleEditable(frame, selectors)) {
          return true;
        }
      }
      return false;
    }));
    if (ready.every(Boolean)) {
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Stripe Checkout did not expose its required card fields.");
}

async function findVisibleEditable(
  frame: Frame,
  selectors: readonly string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    const locators = frame.locator(selector);
    for (let index = 0; index < await locators.count(); index += 1) {
      const locator = locators.nth(index);
      if (
        await locator.isVisible().catch(() => false)
        && await locator.isEditable().catch(() => false)
      ) {
        return locator;
      }
    }
  }
  return null;
}

async function assertStripePositiveActionVisible(
  page: Page,
  names: readonly RegExp[],
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const name of names) {
      for (const frame of page.frames()) {
        const buttons = frame.getByRole("button", { name });
        for (let index = 0; index < await buttons.count(); index += 1) {
          const button = buttons.nth(index);
          if (
            await button.isVisible().catch(() => false)
            && await button.isEnabled().catch(() => false)
          ) {
            return;
          }
        }
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Stripe hosted UI did not expose the expected action.");
}

async function assertStripePlanActionVisible(input: {
  actionNames: readonly RegExp[];
  page: Page;
  planName: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of input.page.frames()) {
      const labels = frame.getByText(input.planName, { exact: false });
      for (let labelIndex = 0; labelIndex < await labels.count(); labelIndex += 1) {
        const label = labels.nth(labelIndex);
        if (!await label.isVisible().catch(() => false)) {
          continue;
        }
        const planContainer = label.locator("xpath=ancestor::*[.//button][1]");
        if (await planContainer.count() === 0) {
          continue;
        }
        for (const actionName of input.actionNames) {
          const actions = planContainer.getByRole("button", { name: actionName });
          for (let actionIndex = 0; actionIndex < await actions.count(); actionIndex += 1) {
            const action = actions.nth(actionIndex);
            if (
              await action.isVisible().catch(() => false)
              && await action.isEnabled().catch(() => false)
            ) {
              return;
            }
          }
        }
      }
    }
    await input.page.waitForTimeout(250);
  }
  throw new Error(
    `Stripe hosted UI did not expose ${input.planName} and its expected action in one plan container.`,
  );
}

async function findSettingsPlanCard(
  page: Page,
  planName: string,
  timeoutMs: number,
): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const labels = page.getByText(planName, { exact: true });
    for (let index = 0; index < await labels.count(); index += 1) {
      const label = labels.nth(index);
      if (!await label.isVisible().catch(() => false)) {
        continue;
      }
      const card = label.locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-xl ') and contains(concat(' ', normalize-space(@class), ' '), ' border ')][1]",
      );
      if (await card.count() > 0) {
        return card;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Settings did not render the ${planName} plan card.`);
}
