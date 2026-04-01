import {
  createDeviceSyncJsonRequester as createSharedDeviceSyncJsonRequester,
  DEFAULT_DEVICE_SYNC_BASE_URL,
  DEVICE_SYNC_BASE_URL_ENV,
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
  isDeviceSyncLocalControlPlaneError,
  normalizeDeviceSyncBaseUrl,
  resolveDeviceSyncControlPlane as resolveSharedDeviceSyncControlPlane,
  resolveDeviceSyncControlToken as resolveSharedDeviceSyncControlToken,
  type DeviceSyncAccountRecord,
  type DeviceSyncProviderDescriptor,
} from "@murphai/device-syncd/client";

export {
  DEFAULT_DEVICE_SYNC_BASE_URL,
  DEVICE_SYNC_BASE_URL_ENV,
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
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
  return resolveDeviceSyncControlPlane(env).baseUrl;
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
  const env = input.env ?? process.env;
  let baseUrl = DEFAULT_DEVICE_SYNC_BASE_URL;
  let controlToken: string | null = null;
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    ({ baseUrl, controlToken } = resolveDeviceSyncControlPlane(env));
    const requestJson = createDeviceSyncJsonRequester({
      baseUrl,
      fetchImpl,
      controlToken,
    });
    const [providerResult, accountResult] = await Promise.all([
      requestJson<{ providers: DeviceSyncProviderDescriptor[] }>("/providers"),
      requestJson<{ accounts: DeviceSyncAccountRecord[] }>("/accounts"),
    ]);

    return {
      status: "ready",
      baseUrl,
      providers: providerResult.providers,
      accounts: accountResult.accounts,
    };
  } catch (error) {
    const isLocalityError =
      isDeviceSyncWebError(error) &&
      error.code === "device_sync_remote_control_plane_unsupported";
    const isAuthError =
      isDeviceSyncWebError(error) && error.code === "CONTROL_PLANE_AUTH_REQUIRED";
    const unavailableBaseUrl =
      isLocalityError &&
      isDeviceSyncWebError(error) &&
      error.details &&
      typeof error.details === "object" &&
      !Array.isArray(error.details) &&
      typeof (error.details as { baseUrl?: unknown }).baseUrl === "string"
        ? ((error.details as { baseUrl: string }).baseUrl)
        : baseUrl;
    const message =
      isLocalityError
        ? "Device sync control-plane credentials are restricted to localhost."
        : isAuthError
        ? "Device sync control plane authentication failed."
        : isDeviceSyncWebError(error) && error.code !== "device_sync_unavailable"
        ? error.message
        : "Device sync is offline.";

    return {
      status: "unavailable",
      baseUrl: unavailableBaseUrl,
      message,
      hint: isLocalityError
        ? "Set DEVICE_SYNC_BASE_URL to a loopback URL such as http://127.0.0.1:8788 whenever DEVICE_SYNC_CONTROL_TOKEN is configured."
        : isAuthError
        ? "Set DEVICE_SYNC_CONTROL_TOKEN in the web server environment so it can call the local daemon."
        : "Start the Murph-managed local device sync daemon, then refresh this page to connect or inspect wearable accounts.",
      suggestedCommand: isLocalityError
        ? "DEVICE_SYNC_BASE_URL=http://127.0.0.1:8788 DEVICE_SYNC_CONTROL_TOKEN=<token> pnpm local-web:dev"
        : isAuthError
        ? "DEVICE_SYNC_CONTROL_TOKEN=<token> pnpm local-web:dev"
        : "murph device daemon start --vault <your-vault>",
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
  const { baseUrl, controlToken } = resolveDeviceSyncControlPlane(input.env);
  const requestJson = createDeviceSyncJsonRequester({
    baseUrl,
    fetchImpl: input.fetchImpl,
    controlToken,
  });

  return await requestJson(
    `/providers/${encodeURIComponent(input.provider)}/connect`,
    {
      method: "POST",
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
  const { baseUrl, controlToken } = resolveDeviceSyncControlPlane(input.env);
  const requestJson = createDeviceSyncJsonRequester({
    baseUrl,
    fetchImpl: input.fetchImpl,
    controlToken,
  });

  return await requestJson(
    `/accounts/${encodeURIComponent(input.accountId)}/reconcile`,
    {
      method: "POST",
    },
  );
}

export async function disconnectDeviceAccount(input: {
  accountId: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<{ account: DeviceSyncAccountRecord }> {
  const { baseUrl, controlToken } = resolveDeviceSyncControlPlane(input.env);
  const requestJson = createDeviceSyncJsonRequester({
    baseUrl,
    fetchImpl: input.fetchImpl,
    controlToken,
  });

  return await requestJson(
    `/accounts/${encodeURIComponent(input.accountId)}/disconnect`,
    {
      method: "POST",
    },
  );
}

const INVALID_RETURN_TO_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/u;

function isSafeRootRelativeReturnTo(candidate: string | null | undefined): candidate is string {
  return typeof candidate === "string"
    && candidate.startsWith("/")
    && !candidate.startsWith("//")
    && !candidate.includes("\\")
    && !INVALID_RETURN_TO_CHARACTER_PATTERN.test(candidate);
}

function resolveDeviceSyncControlPlane(
  env: NodeJS.ProcessEnv = process.env,
): {
  baseUrl: string;
  controlToken: string | null;
} {
  try {
    return resolveSharedDeviceSyncControlPlane({ env });
  } catch (error) {
    if (isDeviceSyncLocalControlPlaneError(error)) {
      throw new DeviceSyncWebError({
        code: "device_sync_remote_control_plane_unsupported",
        message:
          "Device sync control-plane bearer tokens may only target loopback base URLs.",
        status: 500,
        details: {
          baseUrl:
            env[DEVICE_SYNC_BASE_URL_ENV] ?? DEFAULT_DEVICE_SYNC_BASE_URL,
        },
        cause: error,
      });
    }

    throw error;
  }
}

export function buildWebReturnTo(requestUrl: URL, fallbackPath = "/"): string {
  const candidate = requestUrl.searchParams.get("returnTo");
  const relativePath = isSafeRootRelativeReturnTo(candidate)
    ? candidate
    : isSafeRootRelativeReturnTo(fallbackPath)
      ? fallbackPath
      : "/";

  return new URL(relativePath, requestUrl.origin).toString();
}

function createDeviceSyncJsonRequester(
  input: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
    controlToken?: string | null;
  },
) {
  return createSharedDeviceSyncJsonRequester({
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    controlToken: input.controlToken ?? null,
    requestDefaults: {
      method: "GET",
      cache: "no-store",
    },
    createUnavailableError: ({ cause }) =>
      new DeviceSyncWebError({
        code: "device_sync_unavailable",
        message: `Device sync service is unavailable at ${input.baseUrl}.`,
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
