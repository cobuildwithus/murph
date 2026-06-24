import "server-only";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

export interface HostedConnectedAppsConfig {
  apiKey: string;
  baseUrl: string;
  maxAccountsPerToolkit: number;
  toolkits: readonly string[];
}

const DEFAULT_COMPOSIO_BASE_URL = "https://backend.composio.dev";
const DEFAULT_CONNECTED_APP_TOOLKITS = [
  "gmail",
  "googlecalendar",
  "outlook",
  "zoho_mail",
  "googledrive",
  "one_drive",
  "dropbox",
  "googletasks",
  "todoist",
  "notion",
] as const;

export const HOSTED_CONNECTED_APPS_SERVICE_TOOLS = {
  composio_search: {
    enable: [
      "COMPOSIO_SEARCH_AMAZON",
      "COMPOSIO_SEARCH_GOOGLE_MAPS",
      "COMPOSIO_SEARCH_NPPESNPI_LOOKUP",
      "COMPOSIO_SEARCH_WALMART",
    ],
  },
  instacart: {
    enable: [
      "INSTACART_CREATE_INSTACART_RECIPE_LINK",
      "INSTACART_CREATE_RECIPE_PAGE",
      "INSTACART_CREATE_SHOPPING_LIST_PAGE",
      "INSTACART_GET_NEARBY_RETAILERS",
    ],
  },
} as const;

export interface HostedConnectedAppsConfirmedWritePolicy {
  allowedArguments: readonly string[];
  forcedArguments?: Readonly<Record<string, unknown>>;
  toolkit: string;
  version: string;
}

const HOSTED_CONNECTED_APPS_CONFIRMED_WRITES: Readonly<
  Record<string, HostedConnectedAppsConfirmedWritePolicy>
> = {
  GOOGLECALENDAR_CREATE_EVENT: {
    allowedArguments: [
      "description",
      "event_duration_hour",
      "event_duration_minutes",
      "location",
      "start_datetime",
      "summary",
      "timezone",
    ],
    forcedArguments: {
      calendar_id: "primary",
      create_meeting_room: false,
    },
    toolkit: "googlecalendar",
    version: "20260429_00",
  },
  OUTLOOK_CALENDAR_CREATE_EVENT: {
    allowedArguments: [
      "body",
      "end_datetime",
      "location",
      "start_datetime",
      "subject",
      "time_zone",
    ],
    forcedArguments: { is_online_meeting: false },
    toolkit: "outlook",
    version: "20260508_00",
  },
};

const HOSTED_CONNECTED_APPS_SERVICE_TOOL_SLUGS = new Set<string>(
  Object.values(HOSTED_CONNECTED_APPS_SERVICE_TOOLS).flatMap(({ enable }) => enable),
);

const MIN_CONNECTED_APP_ACCOUNTS_PER_TOOLKIT = 2;
const MAX_CONNECTED_APP_ACCOUNTS_PER_TOOLKIT = 10;
const CONNECTED_APP_TOOLKIT_LABELS: Readonly<Record<string, string>> = {
  dropbox: "Dropbox",
  gmail: "Gmail",
  googlecalendar: "Google Calendar",
  googledrive: "Google Drive",
  googletasks: "Google Tasks",
  notion: "Notion",
  one_drive: "Microsoft OneDrive",
  outlook: "Microsoft Outlook",
  todoist: "Todoist",
  zoho_mail: "Zoho Mail",
};

const HOSTED_CONNECTED_APPS_POLICY_VERSION = 1;

export const HOSTED_CONNECTED_APPS_POLICY_REVISION = HOSTED_CONNECTED_APPS_POLICY_VERSION;

export function buildHostedConnectedAppsPolicyRevision(
  config: HostedConnectedAppsConfig,
): number {
  return stablePositiveIntHash(JSON.stringify({
    maxAccountsPerToolkit: config.maxAccountsPerToolkit,
    policyVersion: HOSTED_CONNECTED_APPS_POLICY_VERSION,
    confirmedWrites: HOSTED_CONNECTED_APPS_CONFIRMED_WRITES,
    serviceTools: HOSTED_CONNECTED_APPS_SERVICE_TOOLS,
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

export function assertHostedConnectedAppsSearchToolkit(
  config: Pick<HostedConnectedAppsConfig, "toolkits">,
  toolkit: string,
): string {
  const normalized = toolkit.trim().toLowerCase();
  if (
    !config.toolkits.includes(normalized)
    && !Object.hasOwn(HOSTED_CONNECTED_APPS_SERVICE_TOOLS, normalized)
  ) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_TOOLKIT_NOT_CONFIGURED",
      httpStatus: 404,
      message: "That connected app or service is not configured for Murph.",
    });
  }
  return normalized;
}

export function isHostedConnectedAppsServiceTool(toolSlug: string): boolean {
  return HOSTED_CONNECTED_APPS_SERVICE_TOOL_SLUGS.has(toolSlug);
}

export function getHostedConnectedAppsConfirmedWritePolicy(
  toolSlug: string,
): HostedConnectedAppsConfirmedWritePolicy | null {
  return HOSTED_CONNECTED_APPS_CONFIRMED_WRITES[toolSlug] ?? null;
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
    if (
      !toolkit
      || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(toolkit)
      || Object.hasOwn(HOSTED_CONNECTED_APPS_SERVICE_TOOLS, toolkit)
    ) {
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
  return Math.max(
    MIN_CONNECTED_APP_ACCOUNTS_PER_TOOLKIT,
    Math.min(parsed, MAX_CONNECTED_APP_ACCOUNTS_PER_TOOLKIT),
  );
}

function connectedAppsConfigurationError(_message: string) {
  void _message;
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
