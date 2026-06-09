import type { DeviceSyncAccountRecord } from "@murphai/device-syncd/client";
import { parseHostedExecutionDeviceSyncConnectLinkResponse } from "@murphai/device-syncd/hosted-runtime";
import { z } from "zod";

export const HOSTED_RUNTIME_PROCESS_ENV = "MURPH_HOSTED_RUNTIME_PROCESS";
export const HOSTED_CLI_BRIDGE_URL_ENV = "MURPH_HOSTED_CLI_BRIDGE_URL";
export const HOSTED_CLI_BRIDGE_TOKEN_ENV = "MURPH_HOSTED_CLI_BRIDGE_TOKEN";
export const HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV =
  "MURPH_HOSTED_CODEX_APP_SERVER_COMMAND";
export const HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH = "/assistant/current-route";
export const HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH = "/device/connect-link";
export const HOSTED_CLI_BRIDGE_DEVICE_ACCOUNT_LIST_PATH = "/device/accounts/list";
export const HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS = 10_000;

export const HOSTED_CLI_BRIDGE_ENV_NAMES = [
  HOSTED_RUNTIME_PROCESS_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
] as const;

export const HOSTED_CLI_BRIDGE_SECRET_ENV_NAMES = [
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
] as const;

export const HOSTED_CLI_LOCAL_DAEMON_ENV_DENYLIST = [
  "DEVICE_SYNC_BASE_URL",
  "DEVICE_SYNC_CONTROL_TOKEN",
  "DEVICE_SYNC_SECRET",
  "DEVICE_SYNC_STATE_DB_PATH",
] as const;

const hostedCliDeviceConnectLinkRequestSchema = z.object({
  connectTarget: z.string().trim().min(1),
  returnTo: z.string().trim().min(1).nullable().optional(),
}).strict();

const hostedCliDeviceAccountListRequestSchema = z.object({
  provider: z.string().trim().min(1).nullable().optional(),
  sourceProvider: z.string().trim().min(1).nullable().optional(),
}).strict();

const hostedCliAssistantCurrentRouteRequestSchema = z.object({}).strict();

const hostedCliAssistantCurrentRouteSchema = z.object({
  channel: z.string().trim().min(1),
  deliveryTarget: z.string().trim().min(1),
  identityId: z.string().trim().min(1).nullable().optional(),
  participantId: z.string().trim().min(1).nullable().optional(),
  threadId: z.string().trim().min(1).nullable().optional(),
}).strict();

const hostedCliAssistantCurrentRouteResponseSchema = z.object({
  route: hostedCliAssistantCurrentRouteSchema.nullable(),
}).strict();

const hostedCliDeviceSyncAccountStatusSchema = z.enum([
  "active",
  "reauthorization_required",
  "disconnected",
]);

const hostedCliDeviceSyncAccountSourceSchema = z.object({
  displayName: z.string().min(1).nullable(),
  firstSeenAt: z.string().min(1),
  lastErrorCode: z.string().min(1).nullable(),
  lastErrorMessage: z.string().min(1).nullable(),
  lastSeenAt: z.string().min(1),
  resourceCount: z.number().int().nonnegative(),
  sourceProviderSlug: z.string().min(1),
  status: z.enum([
    "connected",
    "unavailable",
    "error",
    "disconnected",
  ]),
}).strict();

const hostedCliDeviceSyncAccountSetupPhaseSchema = z.enum([
  "pending_link",
  "link_returned",
  "source_confirmed",
  "failed",
]);

const hostedCliDeviceSyncAccountSchema = z.object({
  accessTokenExpiresAt: z.string().min(1).nullable().optional(),
  connectedAt: z.string().min(1),
  createdAt: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  externalAccountId: z.string().min(1),
  id: z.string().min(1),
  lastErrorCode: z.string().min(1).nullable(),
  lastErrorMessage: z.string().min(1).nullable(),
  lastSyncCompletedAt: z.string().min(1).nullable(),
  lastSyncErrorAt: z.string().min(1).nullable(),
  lastSyncStartedAt: z.string().min(1).nullable(),
  lastWebhookAt: z.string().min(1).nullable(),
  metadata: z.object({}).strict(),
  nextReconcileAt: z.string().min(1).nullable(),
  provider: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  sources: z.array(hostedCliDeviceSyncAccountSourceSchema).optional(),
  setupExpiresAt: z.string().min(1).nullable().optional(),
  setupPhase: hostedCliDeviceSyncAccountSetupPhaseSchema.nullable().optional(),
  status: hostedCliDeviceSyncAccountStatusSchema,
  updatedAt: z.string().min(1),
}).strict();

const hostedCliDeviceAccountListResponseSchema = z.object({
  accounts: z.array(hostedCliDeviceSyncAccountSchema),
  provider: z.string().min(1).nullable(),
  sourceProvider: z.string().min(1).nullable().optional(),
}).strict();

export type HostedCliDeviceConnectLinkRequest =
  z.infer<typeof hostedCliDeviceConnectLinkRequestSchema>;

export type HostedCliDeviceAccountListRequest =
  z.infer<typeof hostedCliDeviceAccountListRequestSchema>;

export type HostedCliAssistantCurrentRouteRequest =
  z.infer<typeof hostedCliAssistantCurrentRouteRequestSchema>;

export type HostedCliAssistantCurrentRoute =
  z.infer<typeof hostedCliAssistantCurrentRouteSchema>;

export type HostedCliAssistantCurrentRouteResponse =
  z.infer<typeof hostedCliAssistantCurrentRouteResponseSchema>;

export interface HostedCliDeviceConnectLinkResponse {
  authorizationUrl: string;
  connectUrl: string;
  expiresAt: string;
  provider: string;
  providerLabel: string;
}

export interface HostedCliDeviceAccountListResponse {
  accounts: DeviceSyncAccountRecord[];
  provider: string | null;
  sourceProvider?: string | null;
}

export interface HostedCliBridgeClientConfig {
  token: string;
  url: string;
}

export interface HostedCliBridgeEnvConfig extends HostedCliBridgeClientConfig {
  runtimeProcess: true;
}

export class HostedCliBridgeRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HostedCliBridgeRequestError";
    this.code = code;
  }
}

export function isHostedRuntimeProcessEnv(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env[HOSTED_RUNTIME_PROCESS_ENV]?.trim() === "1";
}

export function readHostedCliBridgeEnv(
  env: Readonly<Record<string, string | undefined>>,
): HostedCliBridgeEnvConfig | null {
  if (!isHostedRuntimeProcessEnv(env)) {
    return null;
  }

  const url = normalizeHostedCliBridgeEnvValue(env[HOSTED_CLI_BRIDGE_URL_ENV]);
  const token = normalizeHostedCliBridgeEnvValue(env[HOSTED_CLI_BRIDGE_TOKEN_ENV]);

  if (!url && !token) {
    return null;
  }

  if (!url || !token) {
    throw new Error("Hosted CLI bridge configuration is incomplete.");
  }

  validateHostedCliBridgeUrl(url);

  return {
    runtimeProcess: true,
    token,
    url,
  };
}

export function parseHostedCliDeviceConnectLinkRequest(
  value: unknown,
): HostedCliDeviceConnectLinkRequest {
  return hostedCliDeviceConnectLinkRequestSchema.parse(value);
}

export function parseHostedCliDeviceAccountListRequest(
  value: unknown,
): HostedCliDeviceAccountListRequest {
  return hostedCliDeviceAccountListRequestSchema.parse(value);
}

export function parseHostedCliAssistantCurrentRouteRequest(
  value: unknown,
): HostedCliAssistantCurrentRouteRequest {
  return hostedCliAssistantCurrentRouteRequestSchema.parse(value);
}

export function parseHostedCliAssistantCurrentRouteResponse(
  value: unknown,
): HostedCliAssistantCurrentRouteResponse {
  return hostedCliAssistantCurrentRouteResponseSchema.parse(value);
}

export async function requestHostedCliAssistantCurrentRoute(input: {
  bridge: HostedCliBridgeClientConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<HostedCliAssistantCurrentRouteResponse> {
  const payload = await requestHostedCliBridgeJson({
    body: {},
    bridge: input.bridge,
    fetchImpl: input.fetchImpl,
    path: HOSTED_CLI_BRIDGE_ASSISTANT_CURRENT_ROUTE_PATH,
    timeoutMs: input.timeoutMs,
  });

  return parseHostedCliAssistantCurrentRouteResponse(payload);
}

export async function requestHostedCliDeviceConnectLink(input: {
  bridge: HostedCliBridgeClientConfig;
  connectTarget: string;
  fetchImpl?: typeof fetch;
  returnTo?: string | null;
  timeoutMs?: number;
}): Promise<HostedCliDeviceConnectLinkResponse> {
  const payload = await requestHostedCliBridgeJson({
    body: {
      connectTarget: input.connectTarget,
      ...(input.returnTo ? { returnTo: input.returnTo } : {}),
    },
    bridge: input.bridge,
    fetchImpl: input.fetchImpl,
    path: HOSTED_CLI_BRIDGE_DEVICE_CONNECT_LINK_PATH,
    timeoutMs: input.timeoutMs,
  });

  return parseHostedExecutionDeviceSyncConnectLinkResponse(payload);
}

export async function requestHostedCliDeviceAccountList(input: {
  bridge: HostedCliBridgeClientConfig;
  fetchImpl?: typeof fetch;
  provider?: string | null;
  sourceProvider?: string | null;
  timeoutMs?: number;
}): Promise<HostedCliDeviceAccountListResponse> {
  const payload = await requestHostedCliBridgeJson({
    body: {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.sourceProvider ? { sourceProvider: input.sourceProvider } : {}),
    },
    bridge: input.bridge,
    fetchImpl: input.fetchImpl,
    path: HOSTED_CLI_BRIDGE_DEVICE_ACCOUNT_LIST_PATH,
    timeoutMs: input.timeoutMs,
  });

  return hostedCliDeviceAccountListResponseSchema.parse(payload);
}

async function requestHostedCliBridgeJson(input: {
  body: Record<string, unknown>;
  bridge: HostedCliBridgeClientConfig;
  fetchImpl?: typeof fetch;
  path: string;
  timeoutMs?: number;
}): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(input.timeoutMs ?? HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(
      new URL(input.path, ensureTrailingSlash(input.bridge.url)),
      {
        body: JSON.stringify(input.body),
        headers: {
          authorization: `Bearer ${input.bridge.token}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal,
      },
    );
  } catch (error) {
    throw createHostedCliBridgeTransportError(error, signal);
  }

  let payload: unknown;
  try {
    payload = await readHostedCliBridgeJsonResponse(response);
  } catch (error) {
    if (isHostedCliBridgeTransportError(error, signal)) {
      throw createHostedCliBridgeTransportError(error, signal);
    }
    throw error;
  }

  if (!response.ok) {
    const error = readHostedCliBridgeError(payload);
    throw new HostedCliBridgeRequestError(error.code, error.message);
  }

  return payload;
}

function createHostedCliBridgeTransportError(
  error: unknown,
  signal: AbortSignal,
): HostedCliBridgeRequestError {
  if (signal.aborted || getHostedCliBridgeErrorName(error) === "TimeoutError") {
    return new HostedCliBridgeRequestError(
      "HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT",
      "Hosted CLI bridge request timed out.",
      { cause: error },
    );
  }

  return new HostedCliBridgeRequestError(
    "HOSTED_CLI_BRIDGE_REQUEST_FAILED",
    "Hosted CLI bridge request failed.",
    { cause: error },
  );
}

function isHostedCliBridgeTransportError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted
    || getHostedCliBridgeErrorName(error) === "TimeoutError"
    || error instanceof TypeError;
}

function getHostedCliBridgeErrorName(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const name = Reflect.get(error, "name");
  return typeof name === "string" ? name : null;
}

function readHostedCliBridgeError(value: unknown): {
  code: string;
  message: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      code: "HOSTED_CLI_BRIDGE_REQUEST_FAILED",
      message: "Hosted CLI bridge request failed.",
    };
  }

  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return {
      code: "HOSTED_CLI_BRIDGE_REQUEST_FAILED",
      message: "Hosted CLI bridge request failed.",
    };
  }

  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;

  return {
    code: typeof code === "string" && code.trim() ? code.trim() : "HOSTED_CLI_BRIDGE_REQUEST_FAILED",
    message: typeof message === "string" && message.trim()
      ? message.trim()
      : "Hosted CLI bridge request failed.",
  };
}

async function readHostedCliBridgeJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Hosted CLI bridge returned invalid JSON.");
  }
}

function normalizeHostedCliBridgeEnvValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function validateHostedCliBridgeUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Hosted CLI bridge URL must be an absolute URL.");
  }

  if (url.protocol !== "http:") {
    throw new Error("Hosted CLI bridge URL must use http.");
  }

  if (!isLoopbackHost(url.hostname)) {
    throw new Error("Hosted CLI bridge URL must use loopback host.");
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  return normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "localhost";
}
