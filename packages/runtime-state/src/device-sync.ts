export const DEVICE_SYNC_BASE_URL_ENV = "DEVICE_SYNC_BASE_URL";
export const DEVICE_SYNC_BASE_URL_ENV_KEYS = [
  DEVICE_SYNC_BASE_URL_ENV,
] as const;
export const DEVICE_SYNC_CONTROL_TOKEN_ENV = "DEVICE_SYNC_CONTROL_TOKEN";
export const DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS = [
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
] as const;
export const DEFAULT_DEVICE_SYNC_BASE_URL = "http://127.0.0.1:8788";
export const DEVICE_SYNC_SECRET_ENV = "DEVICE_SYNC_SECRET";
const DEVICE_SYNC_SECRET_ENV_KEYS = [
  DEVICE_SYNC_SECRET_ENV,
] as const;

export interface DeviceSyncApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
    retryable?: unknown;
    details?: unknown;
  };
}

export type DeviceSyncAccountStatus =
  | "active"
  | "reauthorization_required"
  | "disconnected";

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
  status: DeviceSyncAccountStatus;
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

export interface DeviceSyncErrorPayload {
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: unknown;
}

export interface ResolveDeviceSyncBaseUrlInput {
  value?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface ResolveDeviceSyncControlTokenInput {
  value?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface DeviceSyncRequestErrorContext {
  baseUrl: string;
  path: string;
  status: number;
  controlToken: string | null;
  payload: unknown;
  errorPayload: DeviceSyncErrorPayload;
}

export interface DeviceSyncRequestUnavailableContext {
  baseUrl: string;
  path: string;
  cause: unknown;
}

export interface DeviceSyncRequestInvalidResponseContext {
  baseUrl: string;
  path: string;
  status: number;
  payload: unknown;
}

export interface DeviceSyncJsonRequestInput {
  baseUrl: string;
  path: string;
  fetchImpl?: typeof fetch;
  controlToken?: string | null;
  request?: RequestInit;
  createUnavailableError(context: DeviceSyncRequestUnavailableContext): Error;
  createHttpError(context: DeviceSyncRequestErrorContext): Error;
  createInvalidResponseError(
    context: DeviceSyncRequestInvalidResponseContext,
  ): Error;
}

export function normalizeDeviceSyncBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

export function resolveDeviceSyncBaseUrl(
  input: ResolveDeviceSyncBaseUrlInput = {},
): string {
  const configured =
    (typeof input.value === "string" && input.value.trim()) ||
    readEnvValue(input.env, DEVICE_SYNC_BASE_URL_ENV_KEYS) ||
    DEFAULT_DEVICE_SYNC_BASE_URL;

  return normalizeDeviceSyncBaseUrl(configured);
}

export function resolveDeviceSyncControlToken(
  input: ResolveDeviceSyncControlTokenInput = {},
): string | null {
  const configured =
    (typeof input.value === "string" && input.value.trim()) ||
    readEnvValue(input.env, DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS) ||
    readEnvValue(input.env, DEVICE_SYNC_SECRET_ENV_KEYS) ||
    null;

  return configured || null;
}

function readEnvValue(
  env: NodeJS.ProcessEnv | undefined,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = env?.[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function withControlPlaneAuth(
  headers: HeadersInit | undefined,
  controlToken: string | null,
): HeadersInit | undefined {
  if (!controlToken) {
    return headers;
  }

  const nextHeaders = new Headers(headers);
  nextHeaders.set("Authorization", `Bearer ${controlToken}`);
  return nextHeaders;
}

export function parseJsonPayload(text: string): unknown {
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function asErrorPayload(payload: unknown): DeviceSyncErrorPayload {
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

export async function requestDeviceSyncJson<TResponse>(
  input: DeviceSyncJsonRequestInput,
): Promise<TResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = new URL(
    input.path.replace(/^\/+/u, ""),
    `${input.baseUrl}/`,
  ).toString();
  let response: Response;

  try {
    response = await fetchImpl(url, {
      ...input.request,
      headers: withControlPlaneAuth(
        input.request?.headers,
        input.controlToken ?? null,
      ),
    });
  } catch (cause) {
    throw input.createUnavailableError({
      baseUrl: input.baseUrl,
      path: input.path,
      cause,
    });
  }

  const text = await response.text();
  const payload = parseJsonPayload(text);

  if (!response.ok) {
    throw input.createHttpError({
      baseUrl: input.baseUrl,
      path: input.path,
      status: response.status,
      controlToken: input.controlToken ?? null,
      payload,
      errorPayload: asErrorPayload(payload),
    });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw input.createInvalidResponseError({
      baseUrl: input.baseUrl,
      path: input.path,
      status: response.status,
      payload,
    });
  }

  return payload as TResponse;
}
