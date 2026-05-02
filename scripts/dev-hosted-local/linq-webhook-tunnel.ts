import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { createLinqWebhookSubscription } from "@murphai/operator-config/linq-runtime";

import { repoRoot } from "./constants.ts";
import type { HostedLocalDevConfig } from "./types.ts";

export const HOSTED_LOCAL_LINQ_WEBHOOK_PATH =
  "/api/hosted-onboarding/linq/webhook";
const HOSTED_LOCAL_LINQ_WEBHOOK_EVENT = "message.received";
const LINQ_CONVERSATION_PHONE_NUMBERS_ENV =
  "HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS";

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
  const hasRequiredLinqEnv = hasRequiredLinqWebhookEnvironment(input.env);
  const shouldProbeDefaultTunnelConfig =
    input.config.linqWebhookTunnelMode === "required"
    || explicitPublicUrl !== null
    || hasRequiredLinqEnv
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
    && !hasRequiredLinqEnv
    && input.config.linqWebhookTunnelMode === "auto"
  ) {
    return null;
  }

  const target = explicitPublicUrl
    ? normalizeLinqWebhookPublicUrl(explicitPublicUrl)
    : normalizeLinqWebhookPublicUrl(`https://${parseCloudflaredTunnelHostname(
      await readTextFile(tunnelConfigPath),
      tunnelConfigPath,
    )}`);

  if (
    !hasRequiredLinqEnv
    && input.config.linqWebhookTunnelMode === "required"
    && !input.config.skipLinqWebhookRegister
  ) {
    throw new Error(
      [
        "Linq webhook tunnel setup requires LINQ_API_TOKEN and LINQ_WEBHOOK_SECRET.",
        "Set both env vars or disable registration with MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER=1.",
      ].join(" "),
    );
  }

  return {
    phoneNumbers: readLinqConversationPhoneNumbers(input.env),
    publicBaseUrl: target.publicBaseUrl,
    shouldRegister:
      !input.config.skipLinqWebhookRegister && hasRequiredLinqEnv,
    shouldStartTunnel: configExists,
    targetUrl: target.targetUrl,
    tunnelConfigPath: configExists ? tunnelConfigPath : null,
    tunnelName: configExists ? input.config.linqWebhookTunnelName : null,
  };
}

export async function registerHostedLocalLinqWebhookSubscription(input: {
  env: NodeJS.ProcessEnv;
  setup: HostedLocalLinqWebhookSetup;
  stderrTarget?: NodeJS.WritableStream;
}): Promise<void> {
  const webhookSecret = normalizeOptionalString(input.env.LINQ_WEBHOOK_SECRET);
  if (!webhookSecret) {
    throw new Error("LINQ_WEBHOOK_SECRET must be set before registering the Linq webhook.");
  }

  const result = await createLinqWebhookSubscription(
    {
      phoneNumbers: input.setup.phoneNumbers,
      subscribedEvents: [HOSTED_LOCAL_LINQ_WEBHOOK_EVENT],
      targetUrl: input.setup.targetUrl,
    },
    {
      env: input.env,
    },
  );
  const returnedSecret = normalizeOptionalString(result.signingSecret);
  if (returnedSecret && returnedSecret !== webhookSecret) {
    throw new Error(
      [
        "Linq webhook subscription returned a signing secret that does not match local LINQ_WEBHOOK_SECRET.",
        "Update the local secret to the returned subscription secret, or recreate the subscription expected by this environment.",
      ].join(" "),
    );
  }

  const phoneNumberLabel = input.setup.phoneNumbers
    ? `${input.setup.phoneNumbers.length} configured phone number(s)`
    : "all Linq phone numbers";
  (input.stderrTarget ?? process.stderr).write(
    `[linq] Registered local webhook target ${input.setup.targetUrl} for ${phoneNumberLabel}.\n`,
  );
}

export function normalizeLinqWebhookPublicUrl(value: string): {
  publicBaseUrl: string;
  targetUrl: string;
} {
  const parsed = parseHttpsUrl(value, "MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL");
  const target = new URL(parsed.href);
  const pathLooksOriginOnly =
    target.pathname === "" || target.pathname === "/";

  if (pathLooksOriginOnly) {
    target.pathname = HOSTED_LOCAL_LINQ_WEBHOOK_PATH;
    target.search = "";
    target.hash = "";
  } else {
    if (target.pathname.replace(/\/+$/u, "") !== HOSTED_LOCAL_LINQ_WEBHOOK_PATH) {
      throw new Error(
        `MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL must be an HTTPS origin or ${HOSTED_LOCAL_LINQ_WEBHOOK_PATH}.`,
      );
    }
    target.pathname = HOSTED_LOCAL_LINQ_WEBHOOK_PATH;
  }

  if (target.search || target.hash) {
    throw new Error("MURPH_DEV_LINQ_WEBHOOK_PUBLIC_URL must not include query or hash.");
  }

  return {
    publicBaseUrl: parsed.origin,
    targetUrl: target.toString(),
  };
}

export function parseCloudflaredTunnelHostname(
  configText: string,
  filePath = "cloudflared config",
): string {
  for (const line of configText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^(?:-\s*)?hostname:\s*(?<value>.+)$/iu.exec(trimmed);
    const value = match?.groups?.value;
    if (!value) {
      continue;
    }
    const hostname = stripYamlScalarQuotes(value).trim();
    if (!isValidTunnelHostname(hostname)) {
      throw new Error(
        `Invalid hostname in Linq cloudflared config ${formatRepoPath(filePath)}.`,
      );
    }
    return hostname;
  }

  throw new Error(
    `Linq cloudflared config ${formatRepoPath(filePath)} must include an ingress hostname.`,
  );
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

function hasRequiredLinqWebhookEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    normalizeOptionalString(env.LINQ_API_TOKEN)
    && normalizeOptionalString(env.LINQ_WEBHOOK_SECRET),
  );
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

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
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

function formatRepoPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const relative = path.relative(repoRoot, resolved);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replaceAll(path.sep, "/");
  }

  return "<outside-repo>";
}
