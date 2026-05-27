import { Buffer } from "node:buffer";

import {
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution/auth";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  normalizeHostedExecutionBaseUrl,
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";
import {
  HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS,
} from "@murphai/hosted-execution/orchestration-control";
import {
  readHostedRuntimeEnsureProcessingTimeouts,
} from "@murphai/hosted-execution/temporal-env";
import { log } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";

const DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
const DEFAULT_HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 10_000;
const MAX_HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS = 120_000;
const MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS = 30_000;
const HOSTED_WEB_CALLBACK_SIGNING_IMPORT_ALGORITHM: EcKeyImportParams = {
  name: "ECDSA",
  namedCurve: "P-256",
};
const HOSTED_WEB_CALLBACK_SIGNING_ALGORITHM: EcdsaParams = {
  hash: "SHA-256",
  name: "ECDSA",
};

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedOrchestratorTemporalActivityEnvironment {
  cloudflareHostedControlBaseUrl: string;
  cloudflareHostedControlSigning: HostedWebCallbackSigningEnvironment;
  deviceSyncRecoverySweepTimeoutMs: number;
  ensureRuntimeProcessingHttpTimeoutMs: number;
  hostedWebBaseUrl: string;
  hostedWebCallbackSigning: HostedWebCallbackSigningEnvironment;
  readRuntimeDemandTimeoutMs: number;
}

export interface HostedWebCallbackSigningEnvironment {
  keyId: string;
  privateKeyJwkJson: string;
}

export interface HostedOrchestratorJsonRequest<TResponse> {
  body?: string;
  boundUserId?: string;
  fetchImpl?: typeof fetch;
  label: string;
  method: "GET" | "POST";
  parse: (value: unknown) => TResponse;
  path: string;
  search?: string | null;
  signing?: HostedWebCallbackSigningEnvironment | null;
  timeoutMs: number;
}

const privateKeyCache = new Map<string, Promise<CryptoKey>>();

export interface HostedTemporalActivityObservation {
  activity:
    | "runHostedDeviceSyncRecoverySweep"
    | "readRuntimeDemand"
    | "ensureRuntimeProcessing";
  orchestrationAttemptId?: string | null;
  reason?: string | null;
  userId: string;
}

export function readHostedOrchestratorTemporalActivityEnvironment(
  source: EnvSource = process.env,
): HostedOrchestratorTemporalActivityEnvironment {
  const ensureRuntimeProcessingTimeouts =
    readHostedRuntimeEnsureProcessingTimeouts(source);

  return {
    cloudflareHostedControlBaseUrl: requireControlBaseUrl(
      source.CLOUDFLARE_HOSTED_CONTROL_BASE_URL,
      "CLOUDFLARE_HOSTED_CONTROL_BASE_URL",
    ),
    cloudflareHostedControlSigning: readHostedWebCallbackSigningEnvironment(source),
    deviceSyncRecoverySweepTimeoutMs:
      readHostedDeviceSyncRecoverySweepTimeoutMs(source),
    ensureRuntimeProcessingHttpTimeoutMs:
      ensureRuntimeProcessingTimeouts.ensureRuntimeProcessingHttpTimeoutMs,
    hostedWebBaseUrl: requireWebOriginBaseUrl(
      source.HOSTED_WEB_BASE_URL,
      "HOSTED_WEB_BASE_URL",
    ),
    hostedWebCallbackSigning: readHostedWebCallbackSigningEnvironment(source),
    readRuntimeDemandTimeoutMs: parseBoundedPositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_RUNTIME_DEMAND_TIMEOUT_MS),
      DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS",
    ),
  };
}

export function readHostedOrchestratorTemporalCloudflareEnvironment(
  source: EnvSource = process.env,
): Pick<
  HostedOrchestratorTemporalActivityEnvironment,
  | "cloudflareHostedControlBaseUrl"
  | "cloudflareHostedControlSigning"
  | "ensureRuntimeProcessingHttpTimeoutMs"
> {
  const ensureRuntimeProcessingTimeouts =
    readHostedRuntimeEnsureProcessingTimeouts(source);

  return {
    cloudflareHostedControlBaseUrl: requireControlBaseUrl(
      source.CLOUDFLARE_HOSTED_CONTROL_BASE_URL,
      "CLOUDFLARE_HOSTED_CONTROL_BASE_URL",
    ),
    cloudflareHostedControlSigning: readHostedWebCallbackSigningEnvironment(source),
    ensureRuntimeProcessingHttpTimeoutMs:
      ensureRuntimeProcessingTimeouts.ensureRuntimeProcessingHttpTimeoutMs,
  };
}

export function readHostedOrchestratorTemporalWebEnvironment(
  source: EnvSource = process.env,
): Pick<
  HostedOrchestratorTemporalActivityEnvironment,
  | "deviceSyncRecoverySweepTimeoutMs"
  | "hostedWebBaseUrl"
  | "hostedWebCallbackSigning"
  | "readRuntimeDemandTimeoutMs"
> {
  const hostedWebBaseUrl = requireWebOriginBaseUrl(
    source.HOSTED_WEB_BASE_URL,
    "HOSTED_WEB_BASE_URL",
  );

  return {
    deviceSyncRecoverySweepTimeoutMs:
      readHostedDeviceSyncRecoverySweepTimeoutMs(source),
    hostedWebBaseUrl,
    hostedWebCallbackSigning: readHostedWebCallbackSigningEnvironment(source),
    readRuntimeDemandTimeoutMs: parseBoundedPositiveInteger(
      normalizeHostedExecutionString(source.HOSTED_RUNTIME_DEMAND_TIMEOUT_MS),
      DEFAULT_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      MAX_HOSTED_RUNTIME_DEMAND_TIMEOUT_MS,
      "HOSTED_RUNTIME_DEMAND_TIMEOUT_MS",
    ),
  };
}

export async function requestHostedOrchestratorJson<TResponse>(
  baseUrl: string,
  request: HostedOrchestratorJsonRequest<TResponse>,
): Promise<TResponse> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const url = new URL(request.path.replace(/^\/+/u, ""), `${baseUrl}/`);

  if (request.search) {
    url.search = request.search;
  }

  const body = request.body;
  const headers = new Headers();
  headers.set("accept", "application/json");

  if (body !== undefined) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  if (request.boundUserId) {
    headers.set(HOSTED_EXECUTION_USER_ID_HEADER, request.boundUserId);
  }

  if (request.signing) {
    let signatureHeaders: Record<string, string>;
    try {
      signatureHeaders = await createHostedWebCallbackSignatureHeaders({
        environment: request.signing,
        method: request.method,
        path: url.pathname,
        payload: body ?? "",
        search: url.search,
        userId: request.boundUserId ?? null,
      });
    } catch (error) {
      throw nonRetryableActivityError(
        "hosted_orchestrator_request_signing_configuration",
        `Hosted orchestrator ${request.label} request signing configuration failed: ${
          readErrorMessage(error)
        }`,
        error,
      );
    }

    for (const [key, value] of Object.entries(signatureHeaders)) {
      headers.set(key, value);
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      ...(body === undefined ? {} : { body }),
      headers,
      method: request.method,
      redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
  } catch (error) {
    throw new HostedOrchestratorTransportError({
      cause: error,
      label: request.label,
    });
  }

  if (!response.ok) {
    const error = new HostedOrchestratorHttpResponseError({
      code: await readStructuredErrorCode(response),
      label: request.label,
      status: response.status,
    });

    if (isNonRetryableHostedOrchestratorHttpStatus(response.status)) {
      throw nonRetryableActivityError(
        "hosted_orchestrator_http_non_retryable",
        error.message,
        error,
      );
    }

    throw error;
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    throw nonRetryableActivityError(
      "hosted_orchestrator_invalid_json_response",
      `Hosted orchestrator ${request.label} response JSON was invalid: ${
        readErrorMessage(error)
      }`,
      error,
    );
  }

  try {
    return request.parse(value);
  } catch (error) {
    throw nonRetryableActivityError(
      "hosted_orchestrator_invalid_protocol_response",
      `Hosted orchestrator ${request.label} response was invalid: ${
        readErrorMessage(error)
      }`,
      error,
    );
  }
}

export async function observeHostedTemporalActivity<TResponse>(
  observation: HostedTemporalActivityObservation,
  run: () => Promise<TResponse>,
): Promise<TResponse> {
  const startedAt = Date.now();
  try {
    const result = await run();
    const resultDetails = readHostedTemporalActivityResultDetails(result);
    logHostedTemporalActivity("info", "Hosted Temporal activity completed.", {
      activity: observation.activity,
      component: "temporal.activity",
      durationMs: Date.now() - startedAt,
      orchestrationAttemptId: observation.orchestrationAttemptId ?? null,
      reason: observation.reason ?? null,
      resultAction: resultDetails.resultAction,
      resultKind: resultDetails.resultKind,
      userIdPresent: observation.userId.length > 0,
    });
    return result;
  } catch (error) {
    logHostedTemporalActivity("warn", "Hosted Temporal activity failed.", {
      activity: observation.activity,
      component: "temporal.activity",
      durationMs: Date.now() - startedAt,
      errorCode: readHostedTemporalActivityErrorCode(error),
      nonRetryable: readHostedTemporalActivityNonRetryable(error),
      orchestrationAttemptId: observation.orchestrationAttemptId ?? null,
      reason: observation.reason ?? null,
      resultAction: null,
      resultKind: null,
      userIdPresent: observation.userId.length > 0,
    });
    throw error;
  }
}

function logHostedTemporalActivity(
  level: "info" | "warn",
  message: string,
  metadata: Record<string, unknown>,
): void {
  try {
    log[level](message, metadata);
  } catch (error) {
    if (
      error instanceof Error
      && error.message === "Activity context not initialized"
    ) {
      return;
    }
    throw error;
  }
}

export function nonRetryableActivityError(
  type: string,
  message: string,
  cause?: unknown,
): ApplicationFailure {
  return ApplicationFailure.create({
    ...(cause instanceof Error ? { cause } : {}),
    message,
    nonRetryable: true,
    type,
  });
}

export class HostedOrchestratorTransportError extends Error {
  constructor(input: { cause: unknown; label: string }) {
    super(`Hosted orchestrator ${input.label} transport failed.`, {
      cause: input.cause,
    });
    this.name = "HostedOrchestratorTransportError";
  }
}

export class HostedOrchestratorHttpResponseError extends Error {
  readonly code: string | undefined;
  readonly status: number;

  constructor(input: {
    code: string | undefined;
    label: string;
    status: number;
  }) {
    super(`Hosted orchestrator ${input.label} failed with HTTP ${input.status}.`);
    this.name = "HostedOrchestratorHttpResponseError";
    this.code = input.code;
    this.status = input.status;
  }
}

interface HostedTemporalActivityResultDetails {
  resultAction: string | null;
  resultKind: string | null;
}

function readHostedTemporalActivityResultDetails(
  value: unknown,
): HostedTemporalActivityResultDetails {
  if (!isHostedTemporalActivityResultRecord(value)) {
    return {
      resultAction: null,
      resultKind: null,
    };
  }

  const resultKind = typeof value.kind === "string" ? value.kind : null;
  return {
    resultAction: resultKind === "runtime_processing_accepted"
      ? readKnownString(
        value.action,
        HOSTED_RUNTIME_PROCESSING_ACCEPTED_ACTIONS,
      )
      : null,
    resultKind,
  };
}

function isHostedTemporalActivityResultRecord(
  value: unknown,
): value is { action?: unknown; kind?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readKnownString(
  value: unknown,
  choices: readonly string[],
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return choices.some((choice) => choice === value) ? value : null;
}

function readHostedTemporalActivityErrorCode(error: unknown): string {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current instanceof HostedOrchestratorHttpResponseError && current.code) {
      const code = normalizeHostedTemporalActivityErrorCode(current.code);
      if (code) {
        return code;
      }
    }
    if (current instanceof Error) {
      const typed = current as Error & { code?: unknown; type?: unknown };
      const code = normalizeHostedTemporalActivityErrorCode(typed.code);
      if (code) {
        return code;
      }
      const type = normalizeHostedTemporalActivityErrorCode(typed.type);
      if (type) {
        return type;
      }
      current = current.cause;
      continue;
    }
    break;
  }
  const name = error instanceof Error
    ? normalizeHostedTemporalActivityErrorCode(error.name)
    : null;
  return name
    ? name
    : "unknown";
}

function normalizeHostedTemporalActivityErrorCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.length > 0 && value.length <= 96 && /^[A-Za-z0-9._:-]+$/u.test(value)
    ? value
    : null;
}

function readHostedTemporalActivityNonRetryable(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (
      current instanceof ApplicationFailure
      || current instanceof HostedOrchestratorHttpResponseError
      || current instanceof HostedOrchestratorTransportError
      || current instanceof Error
    ) {
      const nonRetryable = (current as { nonRetryable?: unknown }).nonRetryable;
      if (typeof nonRetryable === "boolean") {
        return nonRetryable;
      }
      current = current.cause;
      continue;
    }
    break;
  }
  return false;
}

function isNonRetryableHostedOrchestratorHttpStatus(status: number): boolean {
  if (status < 400 || status >= 500) {
    return false;
  }

  return status !== 408 && status !== 409 && status !== 425 && status !== 429;
}

function readHostedWebCallbackSigningEnvironment(
  source: EnvSource,
): HostedWebCallbackSigningEnvironment {
  return {
    keyId:
      normalizeHostedExecutionString(source.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID)
      ?? DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID,
    privateKeyJwkJson: requireConfiguredString(
      source.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK,
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    ),
  };
}

function readHostedDeviceSyncRecoverySweepTimeoutMs(
  source: EnvSource,
): number {
  return parseBoundedPositiveInteger(
    normalizeHostedExecutionString(
      source.HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS,
    ),
    DEFAULT_HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS,
    MAX_HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS,
    "HOSTED_DEVICE_SYNC_RECOVERY_SWEEP_TIMEOUT_MS",
  );
}

async function createHostedWebCallbackSignatureHeaders(input: {
  environment: HostedWebCallbackSigningEnvironment;
  method: "GET" | "POST";
  path: string;
  payload: string;
  search: string;
  userId: string | null;
}): Promise<Record<string, string>> {
  const nonce = createNonce();
  const timestamp = new Date().toISOString();
  const signature = await signHostedWebCallbackRequest({
    environment: input.environment,
    method: input.method,
    nonce,
    path: input.path,
    payload: input.payload,
    search: input.search,
    timestamp,
    userId: input.userId,
  });

  return {
    [HOSTED_EXECUTION_NONCE_HEADER]: nonce,
    [HOSTED_EXECUTION_SIGNATURE_HEADER]: signature,
    [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: input.environment.keyId,
    [HOSTED_EXECUTION_TIMESTAMP_HEADER]: timestamp,
  };
}

async function signHostedWebCallbackRequest(input: {
  environment: HostedWebCallbackSigningEnvironment;
  method: "GET" | "POST";
  nonce: string;
  path: string;
  payload: string;
  search: string;
  timestamp: string;
  userId: string | null;
}): Promise<string> {
  const key = await importHostedWebCallbackPrivateKey(input.environment);
  const signature = await crypto.subtle.sign(
    HOSTED_WEB_CALLBACK_SIGNING_ALGORITHM,
    key,
    encodeHostedExecutionSignedRequestPayload({
      method: input.method,
      nonce: input.nonce,
      path: input.path,
      payload: input.payload,
      search: input.search,
      timestamp: input.timestamp,
      userId: input.userId,
    }),
  );

  return encodeBase64Url(new Uint8Array(signature));
}

async function importHostedWebCallbackPrivateKey(
  environment: HostedWebCallbackSigningEnvironment,
): Promise<CryptoKey> {
  const cacheKey = `${environment.keyId}:${environment.privateKeyJwkJson}`;
  let existing = privateKeyCache.get(cacheKey);

  if (!existing) {
    existing = crypto.subtle.importKey(
      "jwk",
      parseEcP256PrivateJwk(
        parseJsonObject(
          environment.privateKeyJwkJson,
          "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
        ),
        "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      ),
      HOSTED_WEB_CALLBACK_SIGNING_IMPORT_ALGORITHM,
      false,
      ["sign"],
    );
    privateKeyCache.set(cacheKey, existing);
  }

  return existing;
}

async function readStructuredErrorCode(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return undefined;
  }

  const code = (body as Record<string, unknown>).code;
  return normalizeHostedTemporalActivityErrorCode(code) ?? undefined;
}

function requireControlBaseUrl(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
  });

  if (!normalized) {
    throw new TypeError(`${label} must be a valid absolute URL.`);
  }

  return normalized;
}

function requireWebOriginBaseUrl(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = normalizeHostedExecutionBaseUrl(value, {
    allowHttpLocalhost: true,
    requireOriginOnly: true,
  });

  if (!normalized) {
    throw new TypeError(`${label} must be a valid absolute URL.`);
  }

  return normalized;
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  label: string,
): number {
  if (value === null) {
    return fallback;
  }

  if (!/^[0-9]+$/u.test(value)) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseBoundedPositiveInteger(
  value: string | null,
  fallback: number,
  max: number,
  label: string,
): number {
  const parsed = parsePositiveInteger(value, fallback, label);
  if (parsed > max) {
    throw new TypeError(`${label} must be less than or equal to ${max}.`);
  }
  return parsed;
}

function requireConfiguredString(
  value: string | null | undefined,
  label: string,
): string {
  const normalized = normalizeHostedExecutionString(value);
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON: ${readErrorMessage(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function parseEcP256PrivateJwk(value: unknown, label: string): JsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an EC P-256 private JWK.`);
  }

  const jwk = value as JsonWebKey;
  if (
    jwk.kty !== "EC"
    || jwk.crv !== "P-256"
    || typeof jwk.x !== "string"
    || typeof jwk.y !== "string"
    || typeof jwk.d !== "string"
  ) {
    throw new TypeError(`${label} must be an EC P-256 private JWK.`);
  }

  return {
    crv: "P-256",
    d: jwk.d,
    ext: true,
    key_ops: ["sign"],
    kty: "EC",
    x: jwk.x,
    y: jwk.y,
  };
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
