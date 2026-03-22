import {
  DEFAULT_DEVICE_SYNC_BASE_URL,
  HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV,
  HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN_ENV,
  normalizeDeviceSyncBaseUrl,
  requestDeviceSyncJson as requestSharedDeviceSyncJson,
  resolveDeviceSyncBaseUrl as resolveSharedDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken as resolveSharedDeviceSyncControlToken,
  type DeviceSyncAccountRecord,
  type DeviceSyncProviderDescriptor,
} from "@healthybob/runtime-state";

export {
  DEFAULT_DEVICE_SYNC_BASE_URL,
  HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV,
  HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN_ENV,
  normalizeDeviceSyncBaseUrl,
  type DeviceSyncAccountRecord,
  type DeviceSyncProviderDescriptor,
};

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

export function resolveDeviceSyncBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveSharedDeviceSyncBaseUrl({ env });
}

export function resolveDeviceSyncControlToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveSharedDeviceSyncControlToken({ env });
}

export async function loadDeviceSyncOverviewFromEnv(input: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
} = {}): Promise<DeviceSyncOverview> {
  const baseUrl = resolveDeviceSyncBaseUrl(input.env);
  const controlToken = resolveDeviceSyncControlToken(input.env);
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const [providerResult, accountResult] = await Promise.all([
      requestDeviceSyncJson<{ providers: DeviceSyncProviderDescriptor[] }>(
        baseUrl,
        "/providers",
        { fetchImpl, controlToken },
      ),
      requestDeviceSyncJson<{ accounts: DeviceSyncAccountRecord[] }>(
        baseUrl,
        "/accounts",
        { fetchImpl, controlToken },
      ),
    ]);

    return {
      status: "ready",
      baseUrl,
      providers: providerResult.providers,
      accounts: accountResult.accounts,
    };
  } catch (error) {
    const isAuthError =
      isDeviceSyncWebError(error) && error.code === "CONTROL_PLANE_AUTH_REQUIRED";
    const message =
      isAuthError
        ? "Device sync control plane authentication failed."
        : isDeviceSyncWebError(error) && error.code !== "device_sync_unavailable"
        ? error.message
        : "Device sync is offline.";

    return {
      status: "unavailable",
      baseUrl,
      message,
      hint: isAuthError
        ? "Set HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN in the web server environment so it can call the local daemon."
        : "Start the Healthy Bob-managed local device sync daemon, then refresh this page to connect or inspect wearable accounts.",
      suggestedCommand: isAuthError
        ? "HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN=<token> pnpm web:dev"
        : "healthybob device daemon start --vault <your-vault>",
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
  const controlToken = resolveDeviceSyncControlToken(input.env);

  return await requestDeviceSyncJson(
    baseUrl,
    `/providers/${encodeURIComponent(input.provider)}/connect`,
    {
      method: "POST",
      fetchImpl: input.fetchImpl,
      controlToken,
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
  const controlToken = resolveDeviceSyncControlToken(input.env);

  return await requestDeviceSyncJson(
    baseUrl,
    `/accounts/${encodeURIComponent(input.accountId)}/reconcile`,
    {
      method: "POST",
      fetchImpl: input.fetchImpl,
      controlToken,
    },
  );
}

export async function disconnectDeviceAccount(input: {
  accountId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ account: DeviceSyncAccountRecord }> {
  const baseUrl = resolveDeviceSyncBaseUrl(input.env);
  const controlToken = resolveDeviceSyncControlToken(input.env);

  return await requestDeviceSyncJson(
    baseUrl,
    `/accounts/${encodeURIComponent(input.accountId)}/disconnect`,
    {
      method: "POST",
      fetchImpl: input.fetchImpl,
      controlToken,
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
    controlToken?: string | null;
  } = {},
): Promise<TResponse> {
  return await requestSharedDeviceSyncJson<TResponse>({
    baseUrl,
    path,
    fetchImpl: input.fetchImpl,
    controlToken: input.controlToken ?? null,
    request: {
      method: input.method ?? "GET",
      body: input.body,
      headers: input.headers,
      cache: "no-store",
    },
    createUnavailableError: ({ cause }) =>
      new DeviceSyncWebError({
        code: "device_sync_unavailable",
        message: `Device sync service is unavailable at ${baseUrl}.`,
        status: 503,
        cause,
      }),
    createHttpError: ({ status, errorPayload }) =>
      new DeviceSyncWebError({
        code: errorPayload.code ?? "device_sync_request_failed",
        message:
          errorPayload.message ??
          `Device sync request failed with HTTP ${status}.`,
        status,
        retryable: errorPayload.retryable,
        details: errorPayload.details,
      }),
    createInvalidResponseError: () =>
      new DeviceSyncWebError({
        code: "device_sync_invalid_response",
        message: "Device sync service returned an invalid JSON payload.",
        status: 502,
      }),
  });
}
