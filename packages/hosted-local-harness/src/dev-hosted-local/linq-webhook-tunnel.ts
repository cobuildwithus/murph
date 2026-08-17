import { createHmac } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createLinqWebhookSubscription } from "@murphai/operator-config/linq-runtime";

import {
  DEFAULT_LINQ_WEBHOOK_REGISTRATION_CACHE,
  repoRoot,
} from "./constants.ts";
import type { HostedLocalDevConfig } from "./types.ts";

export const HOSTED_LOCAL_LINQ_WEBHOOK_PATH =
  "/api/hosted-onboarding/linq/webhook";
const HOSTED_LOCAL_LINQ_WEBHOOK_EVENTS = [
  "message.edited",
  "message.sent",
  "message.received",
  "participant.added",
  "participant.removed",
  "reaction.added",
  "reaction.removed",
] as const;
const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const LINQ_CONVERSATION_PHONE_NUMBERS_ENV =
  "HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS";
const LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS_ENV =
  "HOSTED_ONBOARDING_LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS";
const LINQ_WEBHOOK_REGISTRATION_LIST_TIMEOUT_MS = 10_000;
const hostedLocalFetch: typeof fetch = (request, init) => globalThis.fetch(request, init);

interface CloudflaredIngressRule {
  hostname: string | null;
  service: string | null;
}

interface LocalHostedWebTarget {
  webHost: string;
  webPort: number;
}

interface LinqWebhookRegistrationCache {
  fingerprint: string;
  secretVerified: true;
  subscriptionId: string | null;
  targetUrl: string;
  updatedAt: string;
}

interface LinqWebhookSubscriptionSummary {
  id: string | null;
  isActive: boolean;
  phoneNumbers: readonly string[] | null;
  signingSecret: string | null;
  subscribedEvents: readonly string[];
  targetUrl: string | null;
}

interface LinqWebhookSubscriptionMatch {
  eventStatus: "different" | "exact";
  phoneNumberStatus: "different" | "exact";
  secretStatus: "matches-configured" | "unavailable" | "uses-provider-secret";
  subscription: LinqWebhookSubscriptionSummary;
}

export interface HostedLocalLinqWebhookRegistrationResult {
  webhookSecret: string;
  webhookSecretSource: "configured" | "created" | "existing-provider";
}

export interface HostedLocalLinqWebhookSetup {
  phoneNumbers: readonly string[] | null;
  publicBaseUrl: string;
  shouldRegister: boolean;
  shouldStartTunnel: boolean;
  targetUrl: string;
  tunnelConfigPath: string | null;
  tunnelName: string | null;
}

export async function resolveHostedLocalLinqWebhookSetup(input: {
  config: HostedLocalDevConfig;
  env: NodeJS.ProcessEnv;
  fileExists?: (filePath: string) => Promise<boolean>;
  readTextFile?: (filePath: string) => Promise<string>;
}): Promise<HostedLocalLinqWebhookSetup | null> {
  if (input.config.skipWeb || input.config.linqWebhookTunnelMode === "disabled") {
    return null;
  }

  const explicitPublicUrl = normalizeOptionalString(input.config.linqWebhookPublicUrl);
  const tunnelConfigPath = resolveRepoLocalTunnelConfigPath(
    input.config.linqWebhookTunnelConfigPath,
  );
  const readTextFile = input.readTextFile ?? readTextFileDefault;
  const fileExists = input.fileExists ?? pathExistsDefault;
  const hasRegistrationEnv = hasLinqWebhookRegistrationEnvironment(input.env);
  const shouldProbeDefaultTunnelConfig =
    input.config.linqWebhookTunnelMode === "required"
    || explicitPublicUrl !== null
    || hasRegistrationEnv
    || input.config.linqWebhookTunnelConfigPath.trim() !== "";
  const configExists = shouldProbeDefaultTunnelConfig
    ? await fileExists(tunnelConfigPath)
    : false;

  if (!explicitPublicUrl && !configExists) {
    if (input.config.linqWebhookTunnelMode === "required") {
      throw new Error(
        [
          `Configured Linq webhook tunnel config was not found: ${formatRepoPath(tunnelConfigPath)}.`,
          "Create it or set MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL to the public HTTPS webhook target.",
        ].join(" "),
      );
    }
    return null;
  }
  if (
    !explicitPublicUrl
    && !hasRegistrationEnv
    && input.config.linqWebhookTunnelMode === "auto"
  ) {
    return null;
  }

  const target = explicitPublicUrl
    ? normalizeLinqWebhookPublicUrl(explicitPublicUrl)
    : normalizeLinqWebhookPublicUrl(`https://${parseCloudflaredTunnelHostname(
      await readTextFile(tunnelConfigPath),
      tunnelConfigPath,
      {
        webHost: input.config.webHost,
        webPort: input.config.webPort,
      },
    )}`);

  if (
    !hasRegistrationEnv
    && input.config.linqWebhookTunnelMode === "required"
    && !input.config.skipLinqWebhookRegister
  ) {
    throw new Error(
      [
        "Linq webhook tunnel setup requires LINQ_API_TOKEN.",
        "Set it or disable registration with MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1.",
      ].join(" "),
    );
  }
  if (hasRegistrationEnv) {
    assertLocalAllowedInboundPhoneNumbersConfigured(input.env);
  }

  return {
    phoneNumbers: readLinqConversationPhoneNumbers(input.env),
    publicBaseUrl: target.publicBaseUrl,
    shouldRegister:
      !input.config.skipLinqWebhookRegister && hasRegistrationEnv,
    shouldStartTunnel: configExists,
    targetUrl: target.targetUrl,
    tunnelConfigPath: configExists ? tunnelConfigPath : null,
    tunnelName: configExists ? input.config.linqWebhookTunnelName : null,
  };
}

export async function registerHostedLocalLinqWebhookSubscription(input: {
  env: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  setup: HostedLocalLinqWebhookSetup;
  stderrTarget?: NodeJS.WritableStream;
  registrationCachePath?: string | null;
}): Promise<HostedLocalLinqWebhookRegistrationResult> {
  const configuredWebhookSecret = normalizeOptionalString(input.env.LINQ_WEBHOOK_SECRET);
  const linqApiToken = normalizeOptionalString(input.env.LINQ_API_TOKEN);
  if (!linqApiToken) {
    throw new Error("LINQ_API_TOKEN must be set before registering the Linq webhook.");
  }
  const registrationEnv = buildLinqWebhookRegistrationEnv(input.env, linqApiToken);

  const cachePath = input.registrationCachePath === null
    ? null
    : input.registrationCachePath ?? path.join(repoRoot, DEFAULT_LINQ_WEBHOOK_REGISTRATION_CACHE);
  const phoneNumberLabel = input.setup.phoneNumbers
    ? `${input.setup.phoneNumbers.length} configured phone number(s)`
    : "all Linq phone numbers";

  const existingRegistration = await findExistingLinqWebhookSubscription({
    env: registrationEnv,
    fetchImplementation: input.fetchImplementation ?? hostedLocalFetch,
    phoneNumbers: input.setup.phoneNumbers,
    subscribedEvents: [...HOSTED_LOCAL_LINQ_WEBHOOK_EVENTS],
    targetUrl: input.setup.targetUrl,
    webhookSecret: configuredWebhookSecret,
  });
  if (existingRegistration !== null) {
    const existingWebhookSecret = existingRegistration.subscription.signingSecret;
    const existingRegistrationIsExact =
      existingRegistration.eventStatus === "exact"
      && existingRegistration.phoneNumberStatus === "exact";
    if (
      existingRegistrationIsExact
      && existingWebhookSecret !== null
    ) {
      if (cachePath) {
        await writeLinqWebhookRegistrationCache(cachePath, {
          fingerprint: createLinqWebhookRegistrationFingerprint({
            phoneNumbers: input.setup.phoneNumbers,
            targetUrl: input.setup.targetUrl,
            webhookSecret: existingWebhookSecret,
          }),
          secretVerified: true,
          subscriptionId: existingRegistration.subscription.id,
          targetUrl: input.setup.targetUrl,
          updatedAt: new Date().toISOString(),
        });
      }
      if (existingRegistration.secretStatus === "uses-provider-secret") {
        (input.stderrTarget ?? process.stderr).write(
          "[linq] Using Linq-provided signing secret for local webhook env.\n",
        );
      }
      (input.stderrTarget ?? process.stderr).write(
        `[linq] Local webhook target ${input.setup.targetUrl} is already registered for ${phoneNumberLabel}.\n`,
      );
      return {
        webhookSecret: existingWebhookSecret,
        webhookSecretSource: "existing-provider",
      };
    }
    if (
      existingRegistrationIsExact
      && existingRegistration.secretStatus === "unavailable"
    ) {
      if (!configuredWebhookSecret) {
        throw new Error(
          [
            `Local webhook target ${input.setup.targetUrl} is already registered for ${phoneNumberLabel},`,
            "but Linq did not return its signing secret and no local LINQ_WEBHOOK_SECRET is configured.",
            "Set LINQ_WEBHOOK_SECRET to the existing subscription secret or recreate the subscription manually.",
          ].join(" "),
        );
      }
      const hasVerifiedLocalSecret = cachePath
        ? await readVerifiedLinqWebhookRegistrationCache(cachePath, {
          phoneNumbers: input.setup.phoneNumbers,
          subscriptionId: existingRegistration.subscription.id,
          targetUrl: input.setup.targetUrl,
          webhookSecret: configuredWebhookSecret,
        })
        : false;
      if (!hasVerifiedLocalSecret) {
        throw new Error(
          [
            `Local webhook target ${input.setup.targetUrl} is already registered for ${phoneNumberLabel},`,
            "but Linq did not return its signing secret and the local LINQ_WEBHOOK_SECRET could not be verified against the registration cache.",
            "Refusing to create a duplicate exact subscription.",
          ].join(" "),
        );
      }
      (input.stderrTarget ?? process.stderr).write(
        `[linq] Local webhook target ${input.setup.targetUrl} is already registered for ${phoneNumberLabel}; using verified local signing secret.\n`,
      );
      return {
        webhookSecret: configuredWebhookSecret,
        webhookSecretSource: "configured",
      };
    }
    if (existingRegistration.eventStatus === "different") {
      (input.stderrTarget ?? process.stderr).write(
        [
          `[linq] Local webhook target ${input.setup.targetUrl} already has an active Linq subscription,`,
          "but its event set differs from local hosted onboarding registration.",
          "Registering an exact local subscription so this worktree can use the matching signing secret.",
          "\n",
        ].join(" "),
      );
    } else if (existingRegistration.phoneNumberStatus === "different") {
      (input.stderrTarget ?? process.stderr).write(
        [
          `[linq] Local webhook target ${input.setup.targetUrl} already has an active Linq subscription,`,
          "but its phone-number filter differs from local hosted onboarding registration.",
          "Registering an exact local subscription so this worktree can use the matching signing secret.",
          "\n",
        ].join(" "),
      );
    } else if (existingRegistration.secretStatus === "unavailable" && configuredWebhookSecret) {
      (input.stderrTarget ?? process.stderr).write(
        [
          `[linq] Local webhook target ${input.setup.targetUrl} is already registered for ${phoneNumberLabel},`,
          "but Linq did not return its signing secret, so the configured local LINQ_WEBHOOK_SECRET cannot be verified.",
          "Registering an exact local subscription so this worktree can use the matching signing secret.",
          "\n",
        ].join(" "),
      );
    } else if (existingRegistration.secretStatus === "unavailable") {
      (input.stderrTarget ?? process.stderr).write(
        [
          `[linq] Local webhook target ${input.setup.targetUrl} is already registered for ${phoneNumberLabel},`,
          "but Linq did not return its signing secret and no local secret is configured.",
          "Registering an exact local subscription so this worktree can use the matching signing secret.",
          "\n",
        ].join(" "),
      );
    }
  }

  const result = await createLinqWebhookSubscription(
    {
      phoneNumbers: input.setup.phoneNumbers,
      subscribedEvents: [...HOSTED_LOCAL_LINQ_WEBHOOK_EVENTS],
      targetUrl: input.setup.targetUrl,
    },
    {
      env: registrationEnv,
    },
  );
  const returnedSecret = normalizeOptionalString(result.signingSecret);
  if (!returnedSecret) {
    throw new Error(
      [
        "Linq webhook subscription did not return a signing secret.",
        "Set LINQ_WEBHOOK_SECRET to the subscription secret or recreate the subscription in a Linq environment that returns signing_secret on creation.",
      ].join(" "),
    );
  }
  if (returnedSecret !== configuredWebhookSecret) {
    (input.stderrTarget ?? process.stderr).write(
      "[linq] Using Linq-provided signing secret for local webhook env.\n",
    );
  }

  if (cachePath) {
    await writeLinqWebhookRegistrationCache(cachePath, {
      fingerprint: createLinqWebhookRegistrationFingerprint({
        phoneNumbers: input.setup.phoneNumbers,
        targetUrl: input.setup.targetUrl,
        webhookSecret: returnedSecret,
      }),
      secretVerified: true,
      subscriptionId: normalizeOptionalString(result.id),
      targetUrl: input.setup.targetUrl,
      updatedAt: new Date().toISOString(),
    });
  }

  (input.stderrTarget ?? process.stderr).write(
    `[linq] Registered local webhook target ${input.setup.targetUrl} for ${phoneNumberLabel}.\n`,
  );
  return {
    webhookSecret: returnedSecret,
    webhookSecretSource: "created",
  };
}

export function normalizeLinqWebhookPublicUrl(value: string): {
  publicBaseUrl: string;
  targetUrl: string;
} {
  const parsed = parseHttpsUrl(value, "MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL");
  if (parsed.search || parsed.hash) {
    throw new Error("MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL must not include query or hash.");
  }
  const target = new URL(parsed.href);
  const pathLooksOriginOnly =
    target.pathname === "" || target.pathname === "/";

  if (pathLooksOriginOnly) {
    target.pathname = HOSTED_LOCAL_LINQ_WEBHOOK_PATH;
  } else {
    if (target.pathname.replace(/\/+$/u, "") !== HOSTED_LOCAL_LINQ_WEBHOOK_PATH) {
      throw new Error(
        `MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL must be an HTTPS origin or ${HOSTED_LOCAL_LINQ_WEBHOOK_PATH}.`,
      );
    }
    target.pathname = HOSTED_LOCAL_LINQ_WEBHOOK_PATH;
  }
  target.searchParams.set("version", "2026-02-03");

  return {
    publicBaseUrl: parsed.origin,
    targetUrl: target.toString(),
  };
}

export function parseCloudflaredTunnelHostname(
  configText: string,
  filePath = "cloudflared config",
  localWebTarget?: LocalHostedWebTarget,
): string {
  const rules = parseCloudflaredIngressRules(configText);
  const hostnameRules = rules.filter((rule) => rule.hostname !== null);
  const candidateRules = localWebTarget
    ? hostnameRules.filter((rule) =>
      rule.service !== null && isHostedLocalWebService(rule.service, localWebTarget)
    )
    : hostnameRules;

  for (const rule of candidateRules) {
    const hostname = rule.hostname;
    if (!hostname) {
      continue;
    }
    if (!isValidTunnelHostname(hostname)) {
      throw new Error(
        `Invalid hostname in Linq cloudflared config ${formatRepoPath(filePath)}.`,
      );
    }
    return hostname;
  }

  if (localWebTarget && hostnameRules.length > 0) {
    throw new Error(
      [
        `Linq cloudflared config ${formatRepoPath(filePath)} must include an ingress hostname`,
        `whose service routes to local hosted web port ${localWebTarget.webPort}.`,
      ].join(" "),
    );
  }

  throw new Error(
    `Linq cloudflared config ${formatRepoPath(filePath)} must include an ingress hostname.`,
  );
}

function buildLinqWebhookRegistrationEnv(
  source: NodeJS.ProcessEnv,
  linqApiToken: string,
): NodeJS.ProcessEnv {
  const linqApiBaseUrl = normalizeOptionalString(source.LINQ_API_BASE_URL);
  return {
    ...(linqApiBaseUrl ? { LINQ_API_BASE_URL: linqApiBaseUrl } : {}),
    LINQ_API_TOKEN: linqApiToken,
  };
}

async function findExistingLinqWebhookSubscription(input: {
  env: NodeJS.ProcessEnv;
  fetchImplementation: typeof fetch;
  phoneNumbers: readonly string[] | null;
  subscribedEvents: readonly string[];
  targetUrl: string;
  webhookSecret: string | null;
}): Promise<LinqWebhookSubscriptionMatch | null> {
  const token = normalizeOptionalString(input.env.LINQ_API_TOKEN);
  if (!token) {
    throw new Error("LINQ_API_TOKEN must be set before listing Linq webhooks.");
  }

  const response = await fetchLinqWebhookSubscriptions({
    env: input.env,
    fetchImplementation: input.fetchImplementation,
    token,
  });
  if (!response.ok) {
    throw new Error(
      `Linq request GET /webhook-subscriptions failed with HTTP ${response.status}.`,
    );
  }

  const payload: unknown = await response.json();
  const subscriptions = parseLinqWebhookSubscriptionList(payload);
  const candidates = subscriptions.filter((subscription) =>
    subscription.isActive
    && subscription.targetUrl === input.targetUrl
  );
  if (candidates.length === 0) {
    return null;
  }

  const matches = candidates.map((subscription) =>
    createLinqWebhookSubscriptionMatch({
      expectedPhoneNumbers: input.phoneNumbers,
      expectedSubscribedEvents: input.subscribedEvents,
      subscription,
      webhookSecret: input.webhookSecret,
    })
  );
  const verified = matches.find((match) =>
    match.eventStatus === "exact"
    && match.phoneNumberStatus === "exact"
    && match.secretStatus !== "unavailable"
  );
  if (verified) {
    return verified;
  }

  return matches.find((match) =>
    match.eventStatus === "exact"
    && match.phoneNumberStatus === "exact"
  )
    ?? matches.find((match) => match.eventStatus === "exact")
    ?? matches[0]
    ?? null;
}

function createLinqWebhookSubscriptionMatch(input: {
  expectedPhoneNumbers: readonly string[] | null;
  expectedSubscribedEvents: readonly string[];
  subscription: LinqWebhookSubscriptionSummary;
  webhookSecret: string | null;
}): LinqWebhookSubscriptionMatch {
  let secretStatus: LinqWebhookSubscriptionMatch["secretStatus"] = "unavailable";
  if (input.subscription.signingSecret !== null) {
    secretStatus = input.subscription.signingSecret === input.webhookSecret
      ? "matches-configured"
      : "uses-provider-secret";
  }

  return {
    eventStatus: eventSetsEqual(
      input.subscription.subscribedEvents,
      input.expectedSubscribedEvents,
    )
      ? "exact"
      : "different",
    phoneNumberStatus: phoneNumberSetsEqual(
      input.subscription.phoneNumbers,
      input.expectedPhoneNumbers,
    )
      ? "exact"
      : "different",
    secretStatus,
    subscription: input.subscription,
  };
}

async function fetchLinqWebhookSubscriptions(input: {
  env: NodeJS.ProcessEnv;
  fetchImplementation: typeof fetch;
  token: string;
}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, LINQ_WEBHOOK_REGISTRATION_LIST_TIMEOUT_MS);

  try {
    return await input.fetchImplementation(
      new URL("webhook-subscriptions", resolveLinqWebhookRegistrationBaseUrl(input.env)),
      {
        headers: {
          authorization: `Bearer ${input.token}`,
        },
        method: "GET",
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Linq request GET /webhook-subscriptions timed out after ${LINQ_WEBHOOK_REGISTRATION_LIST_TIMEOUT_MS}ms.`,
      );
    }
    throw new Error("Linq request GET /webhook-subscriptions failed before a response was returned.");
  } finally {
    clearTimeout(timeout);
  }
}

function resolveLinqWebhookRegistrationBaseUrl(env: NodeJS.ProcessEnv): URL {
  const configured = normalizeOptionalString(env.LINQ_API_BASE_URL);
  let parsed: URL;
  try {
    parsed = new URL(configured ?? DEFAULT_LINQ_API_BASE_URL);
  } catch {
    throw new Error("LINQ_API_BASE_URL must be a valid URL.");
  }
  if (!parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed;
}

function parseLinqWebhookSubscriptionList(
  value: unknown,
): readonly LinqWebhookSubscriptionSummary[] {
  if (!isPlainRecord(value)) {
    return [];
  }
  const subscriptions = value.subscriptions;
  if (!Array.isArray(subscriptions)) {
    return [];
  }

  return subscriptions
    .map(parseLinqWebhookSubscriptionSummary)
    .filter((subscription): subscription is LinqWebhookSubscriptionSummary =>
      subscription !== null
    );
}

function parseLinqWebhookSubscriptionSummary(
  value: unknown,
): LinqWebhookSubscriptionSummary | null {
  if (!isPlainRecord(value)) {
    return null;
  }

  return {
    id: normalizeOptionalString(value.id),
    isActive: value.is_active === true,
    phoneNumbers: normalizeLinqOptionalStringList(value.phone_numbers),
    signingSecret: normalizeOptionalString(value.signing_secret),
    subscribedEvents: normalizeLinqOptionalStringList(value.subscribed_events) ?? [],
    targetUrl: normalizeOptionalString(value.target_url),
  };
}

function normalizeLinqOptionalStringList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value
    .map((item) => normalizeOptionalString(item))
    .filter((item): item is string => item !== null);
  return normalized.length > 0 ? normalized : [];
}

function eventSetsEqual(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  const actualNormalized = normalizeStringSet(actual);
  const expectedNormalized = normalizeStringSet(expected);
  if (actualNormalized.length !== expectedNormalized.length) {
    return false;
  }
  return actualNormalized.every((value, index) => value === expectedNormalized[index]);
}

function phoneNumberSetsEqual(
  actual: readonly string[] | null,
  expected: readonly string[] | null,
): boolean {
  const actualNormalized = normalizeStringSet(actual ?? []);
  const expectedNormalized = normalizeStringSet(expected ?? []);
  if (actualNormalized.length !== expectedNormalized.length) {
    return false;
  }
  return actualNormalized.every((value, index) => value === expectedNormalized[index]);
}

function normalizeStringSet(value: readonly string[]): readonly string[] {
  return [...value]
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .sort();
}

function createLinqWebhookRegistrationFingerprint(input: {
  phoneNumbers: readonly string[] | null;
  targetUrl: string;
  webhookSecret: string;
}): string {
  const payload = JSON.stringify({
    events: normalizeStringSet(HOSTED_LOCAL_LINQ_WEBHOOK_EVENTS),
    phoneNumbers: input.phoneNumbers === null
      ? null
      : normalizeStringSet(input.phoneNumbers),
    targetUrl: input.targetUrl,
  });
  return createHmac("sha256", input.webhookSecret)
    .update(payload)
    .digest("hex");
}

async function readVerifiedLinqWebhookRegistrationCache(
  cachePath: string,
  input: {
    phoneNumbers: readonly string[] | null;
    subscriptionId: string | null;
    targetUrl: string;
    webhookSecret: string;
  },
): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(cachePath, "utf8");
  } catch {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return false;
  }
  if (!isPlainRecord(parsed) || parsed.secretVerified !== true) {
    return false;
  }
  if (normalizeOptionalString(parsed.targetUrl) !== input.targetUrl) {
    return false;
  }

  const cachedSubscriptionId = normalizeOptionalString(parsed.subscriptionId);
  if (
    cachedSubscriptionId !== null
    && input.subscriptionId !== null
    && cachedSubscriptionId !== input.subscriptionId
  ) {
    return false;
  }

  return normalizeOptionalString(parsed.fingerprint)
    === createLinqWebhookRegistrationFingerprint(input);
}

async function writeLinqWebhookRegistrationCache(
  cachePath: string,
  cache: LinqWebhookRegistrationCache,
): Promise<void> {
  try {
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    throw new Error("Unable to write repo-local Linq webhook registration cache.");
  }
}

function parseCloudflaredIngressRules(configText: string): CloudflaredIngressRule[] {
  const rules: CloudflaredIngressRule[] = [];
  let currentRule: CloudflaredIngressRule | null = null;

  for (const line of configText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const listItem = /^-\s*(?<rest>.*)$/u.exec(trimmed);
    if (listItem) {
      currentRule = {
        hostname: null,
        service: null,
      };
      rules.push(currentRule);
      assignCloudflaredIngressRuleValue(currentRule, listItem.groups?.rest ?? "");
      continue;
    }

    const targetRule = currentRule ?? {
      hostname: null,
      service: null,
    };
    const changed = assignCloudflaredIngressRuleValue(targetRule, trimmed);
    if (changed && currentRule === null) {
      rules.push(targetRule);
    }
  }

  return rules;
}

function assignCloudflaredIngressRuleValue(
  rule: CloudflaredIngressRule,
  text: string,
): boolean {
  const hostname = readYamlScalarProperty(text, "hostname");
  if (hostname !== null) {
    rule.hostname = hostname;
    return true;
  }

  const service = readYamlScalarProperty(text, "service");
  if (service !== null) {
    rule.service = service;
    return true;
  }

  return false;
}

function readYamlScalarProperty(text: string, key: string): string | null {
  const match = new RegExp(`^${key}:\\s*(?<value>.+)$`, "iu").exec(text.trim());
  const value = match?.groups?.value;
  if (!value) {
    return null;
  }

  return stripYamlScalarQuotes(stripYamlInlineComment(value)).trim();
}

function stripYamlInlineComment(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") || trimmed.startsWith("'")) {
    return trimmed;
  }

  return trimmed.replace(/\s+#.*$/u, "");
}

function isHostedLocalWebService(
  service: string,
  target: LocalHostedWebTarget,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(service);
  } catch {
    return false;
  }

  if (
    parsed.protocol !== "http:"
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    return false;
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 80;
  if (port !== target.webPort) {
    return false;
  }

  return allowedHostedLocalWebServiceHosts(target.webHost).has(
    normalizeUrlHostname(parsed.hostname),
  );
}

function allowedHostedLocalWebServiceHosts(webHost: string): ReadonlySet<string> {
  const configuredHost = normalizeUrlHostname(webHost);
  const hosts = new Set<string>();
  if (
    configuredHost === "localhost"
    || configuredHost === "127.0.0.1"
    || configuredHost === "::1"
    || configuredHost === "0.0.0.0"
    || configuredHost === "::"
  ) {
    hosts.add("localhost");
    hosts.add("127.0.0.1");
    hosts.add("::1");
    return hosts;
  }

  hosts.add(configuredHost);
  return hosts;
}

function normalizeUrlHostname(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function parseHttpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }

  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`${label} must be a public HTTPS origin or webhook URL.`);
  }

  return parsed;
}

function resolveRepoLocalTunnelConfigPath(value: string): string {
  const resolved = path.resolve(repoRoot, value);
  const relative = path.relative(repoRoot, resolved);
  if (
    relative.length === 0
    || relative === "."
    || relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    throw new Error("MURPH_DEV_LINQ_WEBHOOK_TUNNEL_CONFIG must resolve inside the repo.");
  }

  return resolved;
}

function readLinqConversationPhoneNumbers(env: NodeJS.ProcessEnv): readonly string[] | null {
  const configured = normalizeOptionalString(env[LINQ_CONVERSATION_PHONE_NUMBERS_ENV]);
  if (!configured) {
    return null;
  }

  const values = configured
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : null;
}

function assertLocalAllowedInboundPhoneNumbersConfigured(env: NodeJS.ProcessEnv): void {
  const configured = normalizeOptionalString(env[LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS_ENV]);
  if (configured) {
    return;
  }

  throw new Error(
    [
      `${LINQ_LOCAL_ALLOWED_INBOUND_PHONE_NUMBERS_ENV} must be set before enabling local Linq webhook handling with shared Linq credentials.`,
      "Set it to a comma-separated sender phone allowlist, or disable the local Linq webhook tunnel with MURPH_DEV_LINQ_WEBHOOK_TUNNEL=0.",
    ].join(" "),
  );
}

function hasLinqWebhookRegistrationEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(normalizeOptionalString(env.LINQ_API_TOKEN));
}

function stripYamlScalarQuotes(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (
    (quote === "\"" || quote === "'")
    && trimmed.length >= 2
    && trimmed[trimmed.length - 1] === quote
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function isValidTunnelHostname(value: string): boolean {
  if (!value || value.includes("/") || value.includes(":")) {
    return false;
  }
  try {
    const parsed = new URL(`https://${value}`);
    return parsed.hostname === value.toLowerCase() || parsed.hostname === value;
  } catch {
    return false;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExistsDefault(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextFileDefault(filePath: string): Promise<string> {
  return await readFile(filePath, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatRepoPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const relative = path.relative(repoRoot, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll(path.sep, "/");
  }

  return "<outside-repo>";
}
