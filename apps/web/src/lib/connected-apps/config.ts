import "server-only";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

export interface HostedConnectedAppsConfig {
  apiKey: string;
  baseUrl: string;
  maxAccountsPerToolkit: number;
  toolkits: readonly string[];
}

const DEFAULT_COMPOSIO_BASE_URL = "https://backend.composio.dev";
const DEFAULT_CONNECTED_APP_TOOLKITS = ["gmail", "googlecalendar"] as const;
const CONNECTED_APP_TOOLKIT_LABELS: Readonly<Record<string, string>> = {
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
};

const HOSTED_CONNECTED_APPS_POLICY_VERSION = 1;

export const HOSTED_CONNECTED_APPS_POLICY_REVISION = HOSTED_CONNECTED_APPS_POLICY_VERSION;

export function buildHostedConnectedAppsPolicyRevision(
  config: HostedConnectedAppsConfig,
): number {
  return stablePositiveIntHash(JSON.stringify({
    maxAccountsPerToolkit: config.maxAccountsPerToolkit,
    policyVersion: HOSTED_CONNECTED_APPS_POLICY_VERSION,
    tags: {
      disable: ["destructiveHint"],
      enable: ["readOnlyHint"],
    },
    toolkits: [...config.toolkits].sort(),
  }));
}

export function readHostedConnectedAppsConfig(
  source: Readonly<Record<string, string | undefined>> = process.env,
): HostedConnectedAppsConfig {
  const apiKey = source.COMPOSIO_API_KEY?.trim();
  if (!apiKey) {
    throw connectedAppsConfigurationError("COMPOSIO_API_KEY is not configured.");
  }

  const baseUrl = normalizeComposioBaseUrl(
    source.COMPOSIO_BASE_URL?.trim() || DEFAULT_COMPOSIO_BASE_URL,
  );
  const toolkits = readConfiguredToolkits(source.COMPOSIO_CONNECTED_APP_TOOLKITS);
  const maxAccountsPerToolkit = normalizeMaxAccounts(
    source.COMPOSIO_MAX_ACCOUNTS_PER_TOOLKIT,
  );

  return {
    apiKey,
    baseUrl,
    maxAccountsPerToolkit,
    toolkits,
  };
}

export function assertHostedConnectedAppToolkit(
  config: Pick<HostedConnectedAppsConfig, "toolkits">,
  toolkit: string,
): string {
  const normalized = toolkit.trim().toLowerCase();
  if (!config.toolkits.includes(normalized)) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_TOOLKIT_NOT_CONFIGURED",
      httpStatus: 404,
      message: "That connected app is not configured for Murph.",
    });
  }
  return normalized;
}

export function formatHostedConnectedAppToolkitLabel(toolkit: string): string {
  return CONNECTED_APP_TOOLKIT_LABELS[toolkit]
    ?? toolkit
      .split(/[-_]+/u)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
}

function readConfiguredToolkits(value: string | undefined): string[] {
  const values = value
    ? value.split(",")
    : [...DEFAULT_CONNECTED_APP_TOOLKITS];
  const toolkits: string[] = [];

  for (const raw of values) {
    const toolkit = raw.trim().toLowerCase();
    if (!toolkit || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(toolkit)) {
      continue;
    }
    if (!toolkits.includes(toolkit)) {
      toolkits.push(toolkit);
    }
  }

  if (toolkits.length === 0) {
    throw connectedAppsConfigurationError(
      "COMPOSIO_CONNECTED_APP_TOOLKITS contains no valid toolkit slugs.",
    );
  }
  return toolkits;
}

function normalizeComposioBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw connectedAppsConfigurationError("COMPOSIO_BASE_URL is invalid.");
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw connectedAppsConfigurationError(
      "COMPOSIO_BASE_URL must use HTTPS outside local development.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function normalizeMaxAccounts(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "5", 10);
  if (!Number.isFinite(parsed)) {
    return 5;
  }
  return Math.max(2, Math.min(parsed, 20));
}

function connectedAppsConfigurationError(_message: string) {
  return hostedOnboardingError({
    code: "CONNECTED_APPS_CONFIGURATION_UNAVAILABLE",
    httpStatus: 503,
    message: "Connected apps are temporarily unavailable.",
    retryable: true,
  });
}

function stablePositiveIntHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 1) || 1;
}
