import { isLoopbackHostname } from "@murph/runtime-state";

export const DEVICE_SYNC_BASE_URL_ENV = "DEVICE_SYNC_BASE_URL";
export const DEVICE_SYNC_BASE_URL_ENV_KEYS = [
  DEVICE_SYNC_BASE_URL_ENV,
] as const;
export const DEVICE_SYNC_CONTROL_TOKEN_ENV = "DEVICE_SYNC_CONTROL_TOKEN";
export const DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS = [
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
] as const;
export const DEFAULT_DEVICE_SYNC_BASE_URL = "http://localhost:8788";
export const DEVICE_SYNC_LOCAL_CONTROL_PLANE_ERROR_PREFIX =
  "Device sync control-plane bearer tokens from DEVICE_SYNC_CONTROL_TOKEN may only target loopback DEVICE_SYNC_BASE_URL values.";
export const DEVICE_SYNC_SECRET_ENV = "DEVICE_SYNC_SECRET";
export const DEVICE_SYNC_SECRET_ENV_KEYS = [
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
  controlToken?: string | null;
}

export interface ResolveDeviceSyncControlTokenInput {
  value?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface ResolveDeviceSyncControlPlaneInput {
  baseUrl?: string | null;
  controlToken?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface DeviceSyncControlPlane {
  baseUrl: string;
  controlToken: string | null;
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

export interface CreateDeviceSyncJsonRequesterInput {
  baseUrl: string;
  controlToken?: string | null;
  fetchImpl?: typeof fetch;
  requestDefaults?: RequestInit;
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
  const controlToken =
    (typeof input.controlToken === "string" && input.controlToken.trim()) ||
    readEnvValue(input.env, DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS) ||
    null;
  const baseUrl = normalizeDeviceSyncBaseUrl(configured);

  assertLocalDeviceSyncControlPlaneBaseUrl({
    baseUrl,
    controlToken,
  });

  return baseUrl;
}

export function resolveDeviceSyncControlToken(
  input: ResolveDeviceSyncControlTokenInput = {},
): string | null {
  const configured =
    (typeof input.value === "string" && input.value.trim()) ||
    readEnvValue(input.env, DEVICE_SYNC_CONTROL_TOKEN_ENV_KEYS) ||
    null;

  return configured || null;
}

export function resolveDeviceSyncControlPlane(
  input: ResolveDeviceSyncControlPlaneInput = {},
): DeviceSyncControlPlane {
  const controlToken = resolveDeviceSyncControlToken({
    value: input.controlToken,
    env: input.env,
  });

  return {
    baseUrl: resolveDeviceSyncBaseUrl({
      value: input.baseUrl,
      env: input.env,
      controlToken,
    }),
    controlToken,
  };
}

export function isLoopbackDeviceSyncBaseUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl);
  return isLoopbackHostname(url.hostname);
}

export function assertLocalDeviceSyncControlPlaneBaseUrl(input: {
  baseUrl: string;
  controlToken?: string | null;
}): void {
  if (!input.controlToken) {
    return;
  }

  if (isLoopbackDeviceSyncBaseUrl(input.baseUrl)) {
    return;
  }

  throw new TypeError(
    `${DEVICE_SYNC_LOCAL_CONTROL_PLANE_ERROR_PREFIX} Received ${input.baseUrl}.`,
  );
}

export function isDeviceSyncLocalControlPlaneError(
  error: unknown,
): error is TypeError {
  return (
    error instanceof TypeError &&
    error.message.startsWith(DEVICE_SYNC_LOCAL_CONTROL_PLANE_ERROR_PREFIX)
  );
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

export function createDeviceSyncJsonRequester(
  input: CreateDeviceSyncJsonRequesterInput,
): <TResponse>(path: string, request?: RequestInit) => Promise<TResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controlToken = input.controlToken ?? null;

  return async function requestJson<TResponse>(
    path: string,
    request?: RequestInit,
  ): Promise<TResponse> {
    return await requestDeviceSyncJson<TResponse>({
      baseUrl: input.baseUrl,
      path,
      fetchImpl,
      controlToken,
      request: mergeRequestInit(input.requestDefaults, request),
      createUnavailableError: input.createUnavailableError,
      createHttpError: input.createHttpError,
      createInvalidResponseError: input.createInvalidResponseError,
    });
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

function mergeRequestInit(
  defaults: RequestInit | undefined,
  request: RequestInit | undefined,
): RequestInit | undefined {
  if (!defaults) {
    return request;
  }

  if (!request) {
    return { ...defaults };
  }

  return {
    ...defaults,
    ...request,
    headers: mergeHeaders(defaults.headers, request.headers),
  };
}

function mergeHeaders(
  defaults: HeadersInit | undefined,
  request: HeadersInit | undefined,
): HeadersInit | undefined {
  if (defaults === undefined) {
    return request;
  }

  if (request === undefined) {
    return defaults;
  }

  const headers = new Headers(defaults);
  new Headers(request).forEach((value, key) => {
    headers.set(key, value);
  });

  return headers;
}
