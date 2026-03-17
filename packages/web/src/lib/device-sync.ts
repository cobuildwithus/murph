export const HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV =
  "HEALTHYBOB_DEVICE_SYNC_BASE_URL";
export const DEFAULT_DEVICE_SYNC_BASE_URL = "http://127.0.0.1:8788";

export interface DeviceSyncProviderDescriptor {
  provider: string;
  callbackPath: string;
  callbackUrl: string;
  webhookPath: string | null;
  webhookUrl: string | null;
  supportsWebhooks: boolean;
  defaultScopes: string[];
}

export interface DeviceSyncAccountRecord {
  id: string;
  provider: string;
  externalAccountId: string;
  displayName: string | null;
  status: "active" | "reauthorization_required" | "disconnected";
  scopes: string[];
  accessTokenExpiresAt?: string | null;
  metadata: Record<string, unknown>;
  connectedAt: string;
  lastWebhookAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextReconcileAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceSyncOverviewReady {
  status: "ready";
  baseUrl: string;
  providers: DeviceSyncProviderDescriptor[];
  accounts: DeviceSyncAccountRecord[];
}

export interface DeviceSyncOverviewUnavailable {
  status: "unavailable";
  baseUrl: string;
  message: string;
  hint: string;
  suggestedCommand: string;
}

export type DeviceSyncOverview =
  | DeviceSyncOverviewReady
  | DeviceSyncOverviewUnavailable;

interface DeviceSyncApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    details?: unknown;
  };
}

export class DeviceSyncWebError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: unknown;

  constructor(input: {
    code: string;
    message: string;
    status: number;
    retryable?: boolean;
    details?: unknown;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "DeviceSyncWebError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
    this.details = input.details;
  }
}

export function isDeviceSyncWebError(error: unknown): error is DeviceSyncWebError {
  return error instanceof DeviceSyncWebError;
}

export function normalizeDeviceSyncBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

export function resolveDeviceSyncBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return normalizeDeviceSyncBaseUrl(
    env[HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV]?.trim() || DEFAULT_DEVICE_SYNC_BASE_URL,
  );
}

export async function loadDeviceSyncOverviewFromEnv(input: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
} = {}): Promise<DeviceSyncOverview> {
  const baseUrl = resolveDeviceSyncBaseUrl(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const [providerResult, accountResult] = await Promise.all([
      requestDeviceSyncJson<{ providers: DeviceSyncProviderDescriptor[] }>(
        baseUrl,
        "/providers",
        { fetchImpl },
      ),
      requestDeviceSyncJson<{ accounts: DeviceSyncAccountRecord[] }>(
        baseUrl,
        "/accounts",
        { fetchImpl },
      ),
    ]);

    return {
      status: "ready",
      baseUrl,
      providers: providerResult.providers,
      accounts: accountResult.accounts,
    };
  } catch (error) {
    const message =
      isDeviceSyncWebError(error) && error.code !== "device_sync_unavailable"
        ? error.message
        : "Device sync is offline.";

    return {
      status: "unavailable",
      baseUrl,
      message,
      hint:
        "Start the local device sync daemon, then refresh this page to connect or inspect wearable accounts.",
      suggestedCommand: "node packages/device-syncd/dist/bin.js",
    };
  }
}

export async function beginDeviceConnection(input: {
  provider: string;
  returnTo?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{
  provider: string;
  state: string;
  expiresAt: string;
  authorizationUrl: string;
}> {
  const baseUrl = resolveDeviceSyncBaseUrl(input.env);

  return await requestDeviceSyncJson(
    baseUrl,
    `/providers/${encodeURIComponent(input.provider)}/connect`,
    {
      method: "POST",
      fetchImpl: input.fetchImpl,
      body: JSON.stringify(
        input.returnTo ? { returnTo: input.returnTo } : {},
      ),
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
    },
  );
}

export async function reconcileDeviceAccount(input: {
  accountId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ account: DeviceSyncAccountRecord }> {
  const baseUrl = resolveDeviceSyncBaseUrl(input.env);

  return await requestDeviceSyncJson(
    baseUrl,
    `/accounts/${encodeURIComponent(input.accountId)}/reconcile`,
    {
      method: "POST",
      fetchImpl: input.fetchImpl,
    },
  );
}

export async function disconnectDeviceAccount(input: {
  accountId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ account: DeviceSyncAccountRecord }> {
  const baseUrl = resolveDeviceSyncBaseUrl(input.env);

  return await requestDeviceSyncJson(
    baseUrl,
    `/accounts/${encodeURIComponent(input.accountId)}/disconnect`,
    {
      method: "POST",
      fetchImpl: input.fetchImpl,
    },
  );
}

export function buildWebReturnTo(requestUrl: URL, fallbackPath = "/"): string {
  const candidate = requestUrl.searchParams.get("returnTo");

  if (candidate && candidate.startsWith("/")) {
    return new URL(candidate, requestUrl.origin).toString();
  }

  return new URL(fallbackPath, requestUrl.origin).toString();
}

async function requestDeviceSyncJson<TResponse>(
  baseUrl: string,
  path: string,
  input: {
    method?: "GET" | "POST";
    body?: string;
    headers?: HeadersInit;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<TResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(path.replace(/^\/+/u, ""), `${baseUrl}/`).toString();
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: input.method ?? "GET",
      body: input.body,
      headers: input.headers,
      cache: "no-store",
    });
  } catch (error) {
    throw new DeviceSyncWebError({
      code: "device_sync_unavailable",
      message: `Device sync service is unavailable at ${baseUrl}.`,
      status: 503,
      cause: error,
    });
  }

  const text = await response.text();
  const payload = parseJsonPayload(text);

  if (!response.ok) {
    const errorPayload = asErrorPayload(payload);
    throw new DeviceSyncWebError({
      code: errorPayload.code ?? "device_sync_request_failed",
      message:
        errorPayload.message ??
        `Device sync request failed with HTTP ${response.status}.`,
      status: response.status,
      retryable: errorPayload.retryable,
      details: errorPayload.details,
    });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DeviceSyncWebError({
      code: "device_sync_invalid_response",
      message: "Device sync service returned an invalid JSON payload.",
      status: 502,
    });
  }

  return payload as TResponse;
}

function parseJsonPayload(text: string): unknown {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asErrorPayload(payload: unknown): {
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: unknown;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  const envelope = payload as DeviceSyncApiErrorPayload;
  const error = envelope.error;

  if (!error || typeof error !== "object") {
    return {};
  }

  return {
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
    retryable:
      typeof error.retryable === "boolean" ? error.retryable : undefined,
    details: error.details,
  };
}
