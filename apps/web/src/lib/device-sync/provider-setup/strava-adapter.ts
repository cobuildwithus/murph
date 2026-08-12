import "server-only";

import { createHash } from "node:crypto";

import { listDeviceSyncProviderCatalog } from "@murphai/device-syncd";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { ComputerUseService } from "../../computer-use/service";
import { readHostedDeviceSyncPublicBaseUrl } from "../../hosted-web/public-url";
import {
  saveDeviceProviderApplication,
  type DeviceProviderApplicationView,
} from "../provider-applications";
import {
  MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
  type MemberOwnedProviderSetupAdapter,
  type MemberOwnedProviderSetupComputer,
} from "./adapter";
import type {
  MemberOwnedProviderApplicationCreateResult,
  MemberOwnedProviderApplicationDeleteResult,
  MemberOwnedProviderDashboardInspection,
} from "./types";

export const STRAVA_MEMBER_OWNED_PROVIDER_DASHBOARD_URL =
  "https://www.strava.com/settings/api";
const STRAVA_MEMBER_OWNED_PROVIDER_SAFE_LANDING_URL =
  "https://www.strava.com/dashboard";
const STRAVA_PROVIDER_SETUP_ACT_TIMEOUT_MS = 25_000;
const STRAVA_PROVIDER_SETUP_MARKER_PREFIX = "Murph Private Sync";
export const STRAVA_PROVIDER_SETUP_WEBSITE = "https://withmurph.ai";
export const STRAVA_PROVIDER_SETUP_CATEGORY = "Other";

export interface StravaMemberOwnedProviderSetupAdapterOptions {
  callbackUrl?: URL;
  computer?: MemberOwnedProviderSetupComputer;
  dashboardUrl?: string;
  safeLandingUrl?: string;
  saveApplication?: typeof saveDeviceProviderApplication;
}

export class StravaMemberOwnedProviderSetupAdapter
implements MemberOwnedProviderSetupAdapter {
  readonly connectSourceId = "strava";
  readonly connectTarget = "strava";
  readonly provider = "strava" as const;
  readonly sourceProviderSlug = null;

  private readonly callbackUrl: URL;
  private readonly computer: MemberOwnedProviderSetupComputer;
  private readonly dashboardUrl: string;
  private readonly safeLandingUrl: string;
  private readonly saveApplication: typeof saveDeviceProviderApplication;

  constructor(input: StravaMemberOwnedProviderSetupAdapterOptions = {}) {
    this.callbackUrl = input.callbackUrl ?? readStravaMemberOwnedProviderCallback();
    this.computer = input.computer ?? new ComputerUseService();
    this.dashboardUrl = requireHttpsOrLoopbackUrl(
      input.dashboardUrl ?? STRAVA_MEMBER_OWNED_PROVIDER_DASHBOARD_URL,
      "Strava developer dashboard",
    );
    this.safeLandingUrl = requireHttpsOrLoopbackUrl(
      input.safeLandingUrl ?? STRAVA_MEMBER_OWNED_PROVIDER_SAFE_LANDING_URL,
      "Strava safe landing",
    );
    this.saveApplication = input.saveApplication ?? saveDeviceProviderApplication;
  }

  async ensureBrowserRun(input: {
    expectedRunId: string | null;
    memberId: string;
    setupId: string;
  }) {
    return this.computer.acquireOwnedRun({
      expectedRunId: input.expectedRunId,
      memberId: input.memberId,
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
    });
  }

  async inspectDashboard(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderDashboardInspection> {
    const marker = buildStravaMemberOwnedProviderApplicationMarker(input.memberId);
    const result = await this.computer.actOwnedRun({
      code: buildStravaDashboardInspectionCode({
        dashboardUrl: this.dashboardUrl,
        marker,
      }),
      memberId: input.memberId,
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: input.runId,
      timeoutMs: STRAVA_PROVIDER_SETUP_ACT_TIMEOUT_MS,
    });
    return readStravaDashboardInspection(result.result);
  }

  async pauseForUser(input: {
    memberId: string;
    reason: "challenge" | "prerequisite" | "signed_out";
    runId: string;
    setupId: string;
  }) {
    const paused = await this.computer.pauseOwnedRunForUser({
      handoffPurpose: input.reason === "signed_out"
        ? "managed_login"
        : input.reason === "challenge"
        ? "captcha"
        : "manual_browser_help",
      memberId: input.memberId,
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      reason: input.reason === "signed_out" ? "login_needed" : "other",
      runId: input.runId,
      suggestedReply: "done",
    });
    return {
      handoffUrl: paused.handoffUrl,
      runId: paused.runId,
    };
  }

  async cancelBrowserRun(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }) {
    const finished = await this.computer.finishOwnedRun({
      memberId: input.memberId,
      outcome: "canceled",
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: input.runId,
    });
    return finished.status;
  }

  async finishBrowserRun(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }) {
    const finished = await this.computer.finishOwnedRun({
      memberId: input.memberId,
      outcome: "completed",
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: input.runId,
    });
    return finished.status;
  }

  async createOwnedApplication(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderApplicationCreateResult> {
    const marker = buildStravaMemberOwnedProviderApplicationMarker(input.memberId);
    const result = await this.computer.actOwnedRun({
      code: buildStravaApplicationCreateCode({
        callbackDomain: this.callbackUrl.hostname,
        dashboardUrl: this.dashboardUrl,
        marker,
      }),
      memberId: input.memberId,
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: input.runId,
      timeoutMs: STRAVA_PROVIDER_SETUP_ACT_TIMEOUT_MS,
    });
    return readStravaApplicationCreateResult(result.result);
  }

  async captureAndSealOwnedApplication(input: {
    expectedRevision: number | null;
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<DeviceProviderApplicationView> {
    const marker = buildStravaMemberOwnedProviderApplicationMarker(input.memberId);
    const captured = await this.computer.captureAndSealProviderCredentialsInOwnedRun({
      code: buildStravaCredentialCaptureCode({
        dashboardUrl: this.dashboardUrl,
        marker,
        safeLandingUrl: this.safeLandingUrl,
      }),
      consume: async ({ clientId, clientSecret }) =>
        this.saveApplication({
          clientId,
          clientSecret,
          expectedRevision: input.expectedRevision,
          memberId: input.memberId,
          provider: this.provider,
        }),
      memberId: input.memberId,
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: input.runId,
      timeoutMs: STRAVA_PROVIDER_SETUP_ACT_TIMEOUT_MS,
    });
    return captured.value;
  }

  async deleteOwnedApplication(input: {
    memberId: string;
    runId: string;
    setupId: string;
  }): Promise<MemberOwnedProviderApplicationDeleteResult> {
    const marker = buildStravaMemberOwnedProviderApplicationMarker(input.memberId);
    const result = await this.computer.actOwnedRun({
      code: buildStravaApplicationDeleteCode({
        dashboardUrl: this.dashboardUrl,
        marker,
      }),
      memberId: input.memberId,
      ownerKey: input.setupId,
      ownerPurpose: MEMBER_OWNED_PROVIDER_SETUP_COMPUTER_RUN_PURPOSE,
      runId: input.runId,
      timeoutMs: STRAVA_PROVIDER_SETUP_ACT_TIMEOUT_MS,
    });
    const requested = readStravaApplicationDeleteActionResult(result.result);
    if (requested.kind !== "delete_requested") {
      return requested;
    }
    const inspection = await this.inspectDashboard(input);
    switch (inspection.kind) {
      case "missing":
        return { kind: "deleted" };
      case "authentication_required":
        return inspection;
      case "unrelated_application":
        return { kind: "deleted" };
      case "ambiguous":
      case "owned_application":
      case "prerequisite_required":
        return { kind: "ambiguous" };
    }
  }
}

export function buildStravaMemberOwnedProviderApplicationMarker(
  memberId: string,
): string {
  const suffix = createHash("sha256")
    .update(`murph.member-owned-provider.strava:${memberId}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `${STRAVA_PROVIDER_SETUP_MARKER_PREFIX} ${suffix}`;
}

export function readStravaMemberOwnedProviderCallback(
  env: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  const publicBaseUrl = readHostedDeviceSyncPublicBaseUrl(env);
  if (!publicBaseUrl) {
    throw new TypeError(
      "Hosted device-sync public base URL is required for Strava setup.",
    );
  }
  const descriptor = listDeviceSyncProviderCatalog().find(
    (candidate) => candidate.provider === "strava",
  );
  if (
    !descriptor?.callbackPath
    || descriptor.defaultScopes.length !== 1
    || descriptor.defaultScopes[0] !== "activity:read"
  ) {
    throw new TypeError("Checked-in Strava OAuth contract is invalid.");
  }
  return new URL(
    descriptor.callbackPath.replace(/^\/+/, ""),
    `${publicBaseUrl.replace(/\/+$/u, "")}/`,
  );
}

export function buildStravaDashboardInspectionCode(input: {
  dashboardUrl: string;
  marker: string;
}): string {
  return `
await page.goto(${JSON.stringify(input.dashboardUrl)}, { waitUntil: "domcontentloaded" });
const visible = async (selector) => {
  const locator = page.locator(selector);
  return await locator.count() > 0 && await locator.first().isVisible().catch(() => false);
};
const currentUrl = page.url();
if (/\\/(login|session|signin)(?:\\/|$|\\?)/iu.test(currentUrl) || await visible('input[type="password"]')) {
  return { kind: "authentication_required", reason: "signed_out" };
}
if (await visible('input[autocomplete="one-time-code"], input[name*="otp" i], iframe[src*="captcha" i], iframe[title*="captcha" i], [data-sitekey]')) {
  return { kind: "authentication_required", reason: "challenge" };
}
const readName = async (root) => {
  const node = root.locator('[data-application-name], input[name="name"], input[name="application[name]"]').first();
  if (!await node.count()) return "";
  const tagName = await node.evaluate((element) => element.tagName.toLowerCase());
  const value = tagName === "input" || tagName === "textarea"
    ? await node.inputValue().catch(() => "")
    : await node.textContent().catch(() => "");
  return (value || "").trim();
};
const names = [];
const cards = page.locator('[data-strava-application]');
for (let index = 0; index < await cards.count(); index += 1) {
  const name = await readName(cards.nth(index));
  if (name) names.push(name);
}
if (names.length === 0) {
  const fields = page.locator('input[name="name"], input[name="application[name]"]');
  if (await fields.count() > 1) return { kind: "ambiguous" };
  if (await fields.count() === 1) {
    const name = (await fields.first().inputValue().catch(() => "")).trim();
    if (name) names.push(name);
  }
}
const exactMatches = names.filter((name) => name === ${JSON.stringify(input.marker)});
if (exactMatches.length > 1) return { kind: "ambiguous" };
if (exactMatches.length === 1) return { kind: "owned_application" };
if (names.length > 0) return { kind: "unrelated_application" };
if (await visible('[data-murph-state="subscription-required"], [data-testid="developer-subscription-required"]')) {
  return { kind: "prerequisite_required" };
}
const prerequisiteText = page.getByText(/developer subscription|subscribe to create an app|subscription required/iu).first();
if (await prerequisiteText.count() && await prerequisiteText.isVisible().catch(() => false)) {
  return { kind: "prerequisite_required" };
}
const forms = page.locator('form[data-strava-application-form], form[action*="settings/api"]');
if (await forms.count() > 1) return { kind: "ambiguous" };
return { kind: "missing" };
`.trim();
}

export function buildStravaApplicationCreateCode(input: {
  callbackDomain: string;
  dashboardUrl: string;
  marker: string;
}): string {
  return `
await page.goto(${JSON.stringify(input.dashboardUrl)}, { waitUntil: "domcontentloaded" });
const prerequisite = page.locator('[data-murph-state="subscription-required"], [data-testid="developer-subscription-required"]');
if (await prerequisite.count() && await prerequisite.first().isVisible().catch(() => false)) {
  return { kind: "known_unsent", reason: "prerequisite" };
}
const forms = page.locator('form[data-strava-application-form], form[action*="settings/api"]');
if (await forms.count() !== 1) {
  return await forms.count() > 1 ? { kind: "ambiguous" } : { kind: "known_unsent", reason: "unavailable" };
}
const form = forms.first();
const requireOne = async (selector) => {
  const locator = form.locator(selector);
  return await locator.count() === 1 ? locator.first() : null;
};
const name = await requireOne('input[name="name"], input[name="application[name]"]');
const website = await requireOne('input[name="website"], input[name="application[website]"]');
const callback = await requireOne('input[name="callback_domain"], input[name="application[callback_domain]"]');
const description = await requireOne('textarea[name="description"], textarea[name="application[description]"]');
const submit = await requireOne('button[type="submit"], input[type="submit"]');
if (!name || !website || !callback || !submit) return { kind: "ambiguous" };
await name.fill(${JSON.stringify(input.marker)});
await website.fill(${JSON.stringify(STRAVA_PROVIDER_SETUP_WEBSITE)});
await callback.fill(${JSON.stringify(input.callbackDomain)});
if (description) await description.fill("Private read-only activity sync for this Murph member.");
const category = form.locator('select[name="category"], select[name="application[category]"]');
if (await category.count() > 1) return { kind: "ambiguous" };
if (await category.count() === 1) {
  const options = await category.first().locator('option').allTextContents();
  const exact = options.find((option) => option.trim().toLowerCase() === ${JSON.stringify(STRAVA_PROVIDER_SETUP_CATEGORY.toLowerCase())});
  if (!exact) return { kind: "ambiguous" };
  await category.first().selectOption({ label: exact.trim() });
}
try {
  await submit.click();
} catch {
  return { kind: "ambiguous" };
}
await page.waitForLoadState("domcontentloaded").catch(() => undefined);
return { kind: "submitted" };
`.trim();
}

export function buildStravaCredentialCaptureCode(input: {
  dashboardUrl: string;
  marker: string;
  safeLandingUrl: string;
}): string {
  return `
await page.goto(${JSON.stringify(input.dashboardUrl)}, { waitUntil: "domcontentloaded" });
const cards = page.locator('[data-strava-application]');
const roots = [];
for (let index = 0; index < await cards.count(); index += 1) {
  const card = cards.nth(index);
  const node = card.locator('[data-application-name], input[name="name"], input[name="application[name]"]').first();
  if (!await node.count()) continue;
  const tagName = await node.evaluate((element) => element.tagName.toLowerCase());
  const raw = tagName === "input" ? await node.inputValue().catch(() => "") : await node.textContent().catch(() => "");
  if ((raw || "").trim() === ${JSON.stringify(input.marker)}) roots.push(card);
}
if (roots.length === 0) {
  const nameFields = page.locator('input[name="name"], input[name="application[name]"]');
  if (await nameFields.count() === 1 && (await nameFields.first().inputValue().catch(() => "")).trim() === ${JSON.stringify(input.marker)}) {
    roots.push(page.locator('body').first());
  }
}
if (roots.length !== 1) throw new Error("STRAVA_OWNED_APPLICATION_AMBIGUOUS");
const root = roots[0];
const reveal = root.getByRole('button', { name: /show|reveal/iu });
if (await reveal.count() > 1) throw new Error("STRAVA_APPLICATION_CREDENTIALS_AMBIGUOUS");
if (await reveal.count() === 1 && await reveal.first().isVisible().catch(() => false)) {
  await reveal.first().click();
}
const readOne = async (selector) => {
  const nodes = root.locator(selector);
  if (await nodes.count() !== 1) return "";
  const node = nodes.first();
  const tagName = await node.evaluate((element) => element.tagName.toLowerCase());
  const raw = tagName === "input" || tagName === "textarea"
    ? await node.inputValue().catch(() => "")
    : await node.textContent().catch(() => "");
  return (raw || "").trim();
};
const clientId = await readOne('input[name="client_id"], input[name="application[client_id]"], [data-client-id]');
const clientSecret = await readOne('input[name="client_secret"], input[name="application[client_secret]"], [data-client-secret]');
if (!clientId || !clientSecret) throw new Error("STRAVA_APPLICATION_CREDENTIALS_UNAVAILABLE");
await page.evaluate(() => {
  const selectors = [
    'input[name="client_id"]',
    'input[name="application[client_id]"]',
    'input[name="client_secret"]',
    'input[name="application[client_secret]"]',
    '[data-client-id]',
    '[data-client-secret]'
  ];
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        node.value = "";
        node.setAttribute("value", "");
      } else {
        node.textContent = "Credentials sealed by Murph";
      }
    }
  }
});
await page.goto(${JSON.stringify(input.safeLandingUrl)}, { waitUntil: "domcontentloaded" }).catch(() => undefined);
return { clientId, clientSecret };
`.trim();
}

export function buildStravaApplicationDeleteCode(input: {
  dashboardUrl: string;
  marker: string;
}): string {
  return `
await page.goto(${JSON.stringify(input.dashboardUrl)}, { waitUntil: "domcontentloaded" });
const visible = async (selector) => {
  const locator = page.locator(selector);
  return await locator.count() > 0 && await locator.first().isVisible().catch(() => false);
};
const currentUrl = page.url();
if (/\\/(login|session|signin)(?:\\/|$|\\?)/iu.test(currentUrl) || await visible('input[type="password"]')) {
  return { kind: "authentication_required", reason: "signed_out" };
}
if (await visible('input[autocomplete="one-time-code"], iframe[src*="captcha" i], iframe[title*="captcha" i], [data-sitekey]')) {
  return { kind: "authentication_required", reason: "challenge" };
}
const cards = page.locator('[data-strava-application]');
const matches = [];
let unrelated = false;
for (let index = 0; index < await cards.count(); index += 1) {
  const card = cards.nth(index);
  const node = card.locator('[data-application-name], input[name="name"], input[name="application[name]"]').first();
  if (!await node.count()) continue;
  const tagName = await node.evaluate((element) => element.tagName.toLowerCase());
  const raw = tagName === "input" ? await node.inputValue().catch(() => "") : await node.textContent().catch(() => "");
  const name = (raw || "").trim();
  if (name === ${JSON.stringify(input.marker)}) matches.push(card);
  else if (name) unrelated = true;
}
if (matches.length === 0) {
  const nameFields = page.locator('input[name="name"], input[name="application[name]"]');
  if (await nameFields.count() > 1) return { kind: "ambiguous" };
  if (await nameFields.count() === 1) {
    const name = (await nameFields.first().inputValue().catch(() => "")).trim();
    if (name === ${JSON.stringify(input.marker)}) matches.push(page.locator('body').first());
    else if (name) unrelated = true;
  }
}
if (matches.length > 1) return { kind: "ambiguous" };
if (matches.length === 0) return unrelated ? { kind: "unrelated_application" } : { kind: "missing" };
const root = matches[0];
const buttons = root.getByRole('button', { name: /delete application|delete app|delete/iu });
if (await buttons.count() !== 1) return { kind: "ambiguous" };
await buttons.first().click();
const dialogs = page.locator('[role="dialog"], [data-testid*="delete" i], [data-murph-delete-confirmation]');
if (await dialogs.count() > 1) return { kind: "ambiguous" };
const confirmation = await dialogs.count() === 1
  ? dialogs.first().getByRole('button', { name: /confirm deletion|delete application|delete app|yes,? delete/iu })
  : page.getByRole('button', { name: /^confirm deletion$|^yes,? delete$/iu });
if (await confirmation.count() > 1) return { kind: "ambiguous" };
if (await confirmation.count() === 1 && await confirmation.first().isVisible().catch(() => false)) {
  await confirmation.first().click();
}
await page.waitForLoadState("domcontentloaded").catch(() => undefined);
return { kind: "delete_requested" };
`.trim();
}

function readStravaDashboardInspection(
  value: unknown,
): MemberOwnedProviderDashboardInspection {
  const record = requireResultRecord(value, "dashboard inspection");
  const kind = record.kind;
  if (kind === "authentication_required") {
    const reason = record.reason;
    if (reason === "challenge" || reason === "signed_out") {
      return { kind, reason };
    }
  }
  if (kind === "prerequisite_required") {
    return { kind };
  }
  if (
    kind === "ambiguous"
    || kind === "missing"
    || kind === "owned_application"
    || kind === "unrelated_application"
  ) {
    return { kind };
  }
  throw invalidAdapterResult("dashboard inspection");
}

function readStravaApplicationCreateResult(
  value: unknown,
): MemberOwnedProviderApplicationCreateResult {
  const record = requireResultRecord(value, "application creation");
  if (record.kind === "submitted" || record.kind === "ambiguous") {
    return { kind: record.kind };
  }
  if (
    record.kind === "known_unsent"
    && (record.reason === "prerequisite" || record.reason === "unavailable")
  ) {
    return { kind: record.kind, reason: record.reason };
  }
  throw invalidAdapterResult("application creation");
}

function readStravaApplicationDeleteActionResult(
  value: unknown,
): MemberOwnedProviderApplicationDeleteResult | { kind: "delete_requested" } {
  const record = requireResultRecord(value, "application deletion");
  const kind = record.kind;
  if (kind === "authentication_required") {
    const reason = record.reason;
    if (reason === "challenge" || reason === "signed_out") {
      return { kind, reason };
    }
  }
  if (
    kind === "ambiguous"
    || kind === "delete_requested"
    || kind === "missing"
    || kind === "unrelated_application"
  ) {
    return { kind };
  }
  throw invalidAdapterResult("application deletion");
}

function requireResultRecord(
  value: unknown,
  operation: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidAdapterResult(operation);
  }
  return value as Record<string, unknown>;
}

function invalidAdapterResult(operation: string) {
  return deviceSyncError({
    code: "PROVIDER_SETUP_DASHBOARD_UNAVAILABLE",
    httpStatus: 502,
    message: `Strava ${operation} returned an invalid result.`,
    retryable: true,
  });
}

function requireHttpsOrLoopbackUrl(value: string, label: string): string {
  const parsed = new URL(value);
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) {
    throw new TypeError(`${label} URL is invalid.`);
  }
  return parsed.toString();
}
