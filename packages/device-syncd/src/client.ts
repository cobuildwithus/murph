import { isLoopbackHostname } from "@murphai/runtime-state";

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

export type DeviceSyncAccountSetupPhase =
  | "pending_link"
  | "link_returned"
  | "source_confirmed"
  | "failed";

export type DeviceConnectionSourceStatus =
  | "connected"
  | "unavailable"
  | "error"
  | "disconnected";

export type DeviceConnectionSourceResourceAvailabilityValue =
  | string
  | number
  | boolean
  | null;

export type DeviceConnectionSourceResourceAvailabilitySummary = Record<
  string,
  DeviceConnectionSourceResourceAvailabilityValue
>;

export interface DeviceSyncProviderDescriptor {
  provider: string;
  connectionKind: "oauth2" | "external_link" | "sdk" | "manual" | "none";
  credentialPolicy: "oauth_tokens" | "provider_config" | "none";
  callbackPath: string | null;
  callbackUrl: string | null;
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
  setupPhase?: DeviceSyncAccountSetupPhase | null;
  setupExpiresAt?: string | null;
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
  sources?: DeviceSyncAccountSourceSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceSyncAccountSourceSummary {
  sourceProviderSlug: string;
  displayName: string | null;
  status: DeviceConnectionSourceStatus;
  resourceCount: number;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** Monotonic exact-source connection lifecycle. */
  lifecycleEpoch?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastDataAt: string | null;
}

export interface DeviceConnectionSourceRecord {
  id: string;
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName: string | null;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lifecycleEpoch?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Last inbound payload that carried this source's data; null until one has. */
  lastDataAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertDeviceConnectionSourceInput {
  connectionId: string;
  sourceInstanceKey: string;
  sourceProviderSlug: string;
  displayName?: string | null;
  status: DeviceConnectionSourceStatus;
  resourceAvailabilitySummary?: DeviceConnectionSourceResourceAvailabilitySummary;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  /** Omit to preserve the stored lifecycle; reconnect owners advance it explicitly. */
  lifecycleEpoch?: number;
  firstSeenAt?: string | null;
  /** Hosted hydration only: replace an exact source after Web advances its epoch. */
  replaceFirstSeenAt?: boolean;
  lastSeenAt: string;
  /** Omit to preserve the stored arrival signal; only hosted hydration sets it. */
  lastDataAt?: string | null;
}

export interface ListDeviceConnectionSourcesInput {
  connectionId: string;
  sourceProviderSlug?: string | null;
  status?: DeviceConnectionSourceStatus | null;
}

export interface ListDeviceSyncAccountsInput {
  provider?: string | null;
  sourceProviderSlug?: string | null;
}

export interface DeviceSyncCanonicalImportReceipt {
  importCompletedAt: string;
  resource: string;
  sourceProviderSlug: string;
}

export interface DeviceSyncJobRecord {
  id: string;
  provider: string;
  accountId: string;
  kind: string;
  payload: Record<string, unknown>;
  priority: number;
  availableAt: string;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
  status: "queued" | "running" | "succeeded" | "dead";
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Exact canonical source/resource identities accepted while this job ran. */
  canonicalImportReceipts?: readonly DeviceSyncCanonicalImportReceipt[];
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
  method: string;
  path: string;
  status: number;
  controlToken: string | null;
  payload: unknown;
  errorPayload: DeviceSyncErrorPayload;
}

export interface DeviceSyncRequestUnavailableContext {
  baseUrl: string;
  failureStage: "transport" | "response";
  method: string;
  path: string;
  cause: unknown;
  timedOut: boolean;
}

export interface DeviceSyncRequestInvalidResponseContext {
  baseUrl: string;
  method: string;
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
  timeoutMs?: number;
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
  timeoutMs?: number;
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
    return JSON.parse(text);
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
      timeoutMs: input.timeoutMs,
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
  const method = (input.request?.method ?? "GET").toUpperCase();
  const timeoutSignal = Number.isSafeInteger(input.timeoutMs) && (input.timeoutMs ?? 0) > 0
    ? AbortSignal.timeout(input.timeoutMs ?? 0)
    : undefined;
  const callerSignal = input.request?.signal ?? undefined;
  const requestSignal = timeoutSignal && callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal ?? callerSignal;
  let response: Response;

  try {
    response = await fetchImpl(url, {
      ...input.request,
      headers: withControlPlaneAuth(
        input.request?.headers,
        input.controlToken ?? null,
      ),
      signal: requestSignal,
    });
  } catch (cause) {
    throw input.createUnavailableError({
      baseUrl: input.baseUrl,
      failureStage: "transport",
      method,
      path: input.path,
      cause,
      timedOut: timeoutSignal?.aborted === true && callerSignal?.aborted !== true,
    });
  }

  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    if (!response.ok) {
      throw input.createHttpError({
        baseUrl: input.baseUrl,
        method,
        path: input.path,
        status: response.status,
        controlToken: input.controlToken ?? null,
        payload: null,
        errorPayload: {},
      });
    }
    throw input.createUnavailableError({
      baseUrl: input.baseUrl,
      failureStage: "response",
      method,
      path: input.path,
      cause,
      timedOut: timeoutSignal?.aborted === true && callerSignal?.aborted !== true,
    });
  }
  const payload = parseJsonPayload(text);

  if (!response.ok) {
    throw input.createHttpError({
      baseUrl: input.baseUrl,
      method,
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
      method,
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
