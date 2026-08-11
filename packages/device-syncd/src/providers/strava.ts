import { createHmac, timingSafeEqual } from "node:crypto";

import {
  resolveDeviceProviderDescriptor,
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
  requireDeviceProviderWebhookDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError } from "../errors.ts";
import type { StravaDeviceSyncJobPayloads } from "../config/provider-manifests.ts";
import {
  addMilliseconds,
  coerceRecord,
  normalizeIdentifier,
  normalizeString,
  sha256Text,
  subtractDays,
} from "../shared.ts";
import { formatDeviceSyncAccountLabel } from "../provider-label.ts";
import {
  buildStravaDeviceSyncRuntimeDescriptor,
  buildStravaDeviceSyncScopes,
  normalizeStravaDeviceSyncScopes,
} from "../configured-provider-runtime-descriptors.ts";
import {
  buildOAuthConnectUrl,
  buildProviderApiError,
  buildScheduledReconcileJobs,
  adaptDeviceSyncOAuthProvider,
  createRefreshingApiSession,
  fetchBearerJson,
  isoFromExpiresIn,
  isTokenNearExpiry,
  parseResponseBody,
  postOAuthTokenRequest,
  refreshOAuthTokens,
  requireRefreshToken,
  tokenResponseToAuthTokens as sharedTokenResponseToAuthTokens,
} from "./shared-oauth.ts";
import { createStravaWebhookSubscriptionClient } from "./strava-webhooks.ts";
import {
  buildOAuthTokenRequestDiagnostics,
  buildProviderRequestDiagnostics,
  extractProviderQueryParameterNames,
  resolveOAuthTokenRequestAccountStatus,
} from "./provider-diagnostics.ts";

import type {
  StravaDeviceSyncProviderConfig,
} from "../config/provider-types.ts";
import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncOAuthProvider,
  DeviceSyncWebhookPreflightResponse,
  ProviderAuthTokens,
  ProviderCallbackContext,
  ProviderConnectionResult,
  ProviderJobContext,
  ProviderJobResult,
  ProviderScheduleResult,
  ProviderWebhookAdminCapability,
  ProviderWebhookContext,
  ProviderWebhookResult,
  StoredDeviceSyncAccount,
} from "../types.ts";
import { classifyDeviceSyncWebhookAcceptanceMode, getDeviceSyncAccountOAuthTokens } from "../types.ts";
import type { StravaWebhookSubscriptionClient } from "./strava-webhooks.ts";

export type { StravaDeviceSyncProviderConfig } from "../config/provider-types.ts";

export type StravaDeviceSyncRevocationConfig = Pick<
  StravaDeviceSyncProviderConfig,
  "authBaseUrl" | "fetchImpl" | "requestTimeoutMs"
>;

const STRAVA_AUTH_BASE_URL = "https://www.strava.com";
const STRAVA_API_BASE_URL = "https://www.strava.com/api/v3";
const STRAVA_AUTHORIZE_PATH = "/oauth/authorize";
const STRAVA_TOKEN_PATH = "/oauth/token";
const STRAVA_DEAUTHORIZE_PATH = "/oauth/deauthorize";
const STRAVA_PROVIDER_DESCRIPTOR =
  resolveDeviceProviderDescriptor("strava") ??
  (() => {
    throw new TypeError("Strava provider descriptor is not registered.");
  })();
const STRAVA_OAUTH = requireDeviceProviderOAuthDescriptor(STRAVA_PROVIDER_DESCRIPTOR);
const STRAVA_WEBHOOK = requireDeviceProviderWebhookDescriptor(STRAVA_PROVIDER_DESCRIPTOR);
const STRAVA_SYNC = requireDeviceProviderSyncDescriptor(STRAVA_PROVIDER_DESCRIPTOR);
const STRAVA_WEBHOOK_PATH = STRAVA_WEBHOOK.path;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BACKFILL_DAYS = STRAVA_SYNC.windows.backfillDays;
const DEFAULT_RECONCILE_DAYS = STRAVA_SYNC.windows.reconcileDays;
const DEFAULT_RECONCILE_INTERVAL_MS = STRAVA_SYNC.windows.reconcileIntervalMs;
const STRAVA_PAGED_ACTIVITY_SIZE = 200;
const STRAVA_MAX_ACTIVITY_PAGES = 100;
const STRAVA_MAX_ACTIVITY_RECORDS = 25_000;
const STRAVA_REFRESH_SKEW_MS = 60 * 60_000;
const STRAVA_ACTIVITY_WEBHOOK_PRIORITY = 90;
const STRAVA_DELETE_WEBHOOK_PRIORITY = 95;
const STRAVA_DEAUTHORIZE_WEBHOOK_PRIORITY = 100;
const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60_000;
const STRAVA_OAUTH_TOKEN_ENDPOINT_KIND = "strava_oauth_token";

type StravaWebhookResourceType = "activity" | "athlete";

type StravaWebhookAspectType = "create" | "update" | "delete";

interface StravaTokenResponse {
  access_token?: unknown;
  expires_at?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  athlete?: unknown;
  token_type?: unknown;
}

interface StravaWebhookEventPayload {
  aspect_type?: unknown;
  event_time?: unknown;
  object_id?: unknown;
  object_type?: unknown;
  owner_id?: unknown;
  subscription_id?: unknown;
  updates?: unknown;
}

interface StravaDeleteMarker {
  resource_type: string;
  resource_id: string;
  occurred_at: string;
  source_event_type?: string;
}

interface StravaWebhookJobPayload {
  eventType: string;
  occurredAt?: string | null;
  resourceId: string;
  resourceType: StravaWebhookResourceType;
}

interface StravaApiSession {
  account: DeviceSyncAccount;
  requestJson<T>(path: string, options?: { optional?: boolean }): Promise<T | null>;
  fetchActivities(windowStart: string, windowEnd: string): Promise<Record<string, unknown>[]>;
  fetchActivityById(activityId: string): Promise<Record<string, unknown> | null>;
}

interface StravaWebhookSignatureHeader {
  timestamp: string;
  signatures: string[];
}

function epochSecondsToIso(value: unknown): string | undefined {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const milliseconds = numeric >= 10_000_000_000 ? numeric : numeric * 1000;
  const timestamp = new Date(milliseconds);

  return Number.isFinite(timestamp.valueOf()) ? timestamp.toISOString() : undefined;
}

function buildStravaApiError(
  code: string,
  message: string,
  response: Response,
  body: string,
  options: {
    retryable?: boolean;
    accountStatus?: "reauthorization_required" | "disconnected" | null;
    diagnostics?: Record<string, boolean | number | string | null | undefined>;
  } = {},
) {
  return buildProviderApiError(code, message, response, body, options);
}

function resolveStravaApiEndpointKind(path: string): string {
  const pathname = safeProviderPathname(path);

  if (pathname === "/athlete") {
    return "strava_athlete_profile";
  }

  if (pathname === "/athlete/activities") {
    return "strava_activity_collection";
  }

  if (/^\/activities\/[^/]+$/u.test(pathname)) {
    return "strava_activity_resource";
  }

  return "strava_api";
}

function safeProviderPathname(path: string): string {
  try {
    return new URL(path, "https://provider.invalid").pathname;
  } catch {
    return path.split("?")[0] ?? "";
  }
}

function tokenResponseToAuthTokens(payload: StravaTokenResponse): ProviderAuthTokens {
  const tokens = sharedTokenResponseToAuthTokens(payload, () =>
    deviceSyncError({
      code: "STRAVA_ACCESS_TOKEN_MISSING",
      message: "Strava token response did not include an access token.",
      retryable: false,
      httpStatus: 502,
    }),
  );

  tokens.accessTokenExpiresAt = epochSecondsToIso(payload.expires_at) ?? isoFromExpiresIn(payload.expires_in);

  return tokens;
}

function buildWindowJobPayload(input: {
  now: string;
  windowDays: number;
  includeAthlete?: boolean;
  kind?: "backfill" | "reconcile";
}): StravaDeviceSyncJobPayloads["backfill" | "reconcile"] {
  return {
    windowStart: subtractDays(input.now, input.windowDays),
    windowEnd: input.now,
    ...(input.includeAthlete ? { includeAthlete: true } : {}),
    ...(input.kind ? { windowKind: input.kind } : {}),
  };
}

function buildWebhookDedupeKey(input: {
  externalAccountId: string;
  resourceType: string;
  resourceId: string;
  eventType: string;
  occurredAt?: string | null;
}): string {
  return `${input.eventType}:${sha256Text(
    `${input.externalAccountId}:${input.resourceType}:${input.resourceId}:${input.occurredAt ?? ""}`,
  )}`;
}

function coerceArrayOfRecords(payload: unknown): Record<string, unknown>[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? coerceRecord(entry) : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function buildRequiredActivityScopeError(): Error {
  return deviceSyncError({
    code: "STRAVA_ACTIVITY_SCOPE_REQUIRED",
    message: "Strava authorization must grant activity:read or activity:read_all for activity sync.",
    retryable: false,
    httpStatus: 400,
  });
}

function hasAcceptedActivityScope(scopes: readonly string[]): boolean {
  return scopes.includes("activity:read") || scopes.includes("activity:read_all");
}

function resolveAccountScopes(callbackGrantedScopes: readonly string[], tokenScopePayload: unknown): string[] {
  const tokenScopes = normalizeStravaDeviceSyncScopes(tokenScopePayload);
  const scopes = tokenScopes.length > 0
    ? tokenScopes
    : normalizeStravaDeviceSyncScopes(callbackGrantedScopes);

  if (!hasAcceptedActivityScope(scopes)) {
    throw buildRequiredActivityScopeError();
  }

  return scopes;
}

function isStravaTokenNearExpiry(account: Pick<DeviceSyncAccount, "accessTokenExpiresAt">): boolean {
  return isTokenNearExpiry(account, STRAVA_REFRESH_SKEW_MS);
}

function buildWebhookTraceId(payload: Record<string, unknown>): string {
  return `strava-${sha256Text(JSON.stringify(payload))}`;
}

function normalizeWebhookObjectType(value: unknown): StravaWebhookResourceType | null {
  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized === "activity" || normalized === "athlete") {
    return normalized;
  }

  return null;
}

function normalizeWebhookAspectType(value: unknown): StravaWebhookAspectType | null {
  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized === "create" || normalized === "update" || normalized === "delete") {
    return normalized;
  }

  return null;
}

function isAthleteDeauthorizationEvent(input: {
  objectType: StravaWebhookResourceType;
  aspectType: StravaWebhookAspectType;
  updates: Record<string, unknown>;
}): boolean {
  if (input.objectType !== "athlete" || input.aspectType !== "update") {
    return false;
  }

  const authorized = input.updates.authorized;

  if (typeof authorized === "boolean") {
    return !authorized;
  }

  if (typeof authorized === "number") {
    return authorized === 0;
  }

  const normalized = normalizeString(authorized)?.toLowerCase();
  return normalized === "false" || normalized === "0";
}

function buildDeleteMarker(input: {
  occurredAt: string;
  resourceId: string;
  resourceType: string;
  sourceEventType: string;
}): StravaDeleteMarker {
  return {
    resource_type: input.resourceType,
    resource_id: input.resourceId,
    occurred_at: input.occurredAt,
    source_event_type: input.sourceEventType,
  };
}

function parseStravaWebhookSignatureHeader(value: string | null): StravaWebhookSignatureHeader | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of normalized.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const partValue = part.slice(index + 1).trim();

    if (key === "t" && partValue) {
      timestamp = partValue;
    } else if (key === "v1" && partValue) {
      signatures.push(partValue);
    }
  }

  return timestamp && signatures.length > 0
    ? {
        timestamp,
        signatures,
      }
    : null;
}

function strictHexDigest(value: string): Buffer | null {
  if (!/^[0-9a-f]{64}$/iu.test(value)) {
    return null;
  }

  return Buffer.from(value, "hex");
}

function constantTimeHexDigestMatch(expected: Buffer, candidates: readonly string[]): boolean {
  for (const candidate of candidates) {
    const actual = strictHexDigest(candidate);
    if (actual && actual.length === expected.length && timingSafeEqual(actual, expected)) {
      return true;
    }
  }

  return false;
}

function verifyStravaWebhookSignature(input: {
  headers: Headers;
  now: string;
  rawBody: Buffer;
  signingSecret: string | null;
  timestampToleranceMs: number;
}): string {
  const parsed = parseStravaWebhookSignatureHeader(input.headers.get("x-strava-signature"));

  if (!parsed) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_SIGNATURE_MISSING",
      message: "Strava webhook signature header is missing.",
      retryable: false,
      httpStatus: 401,
    });
  }

  if (!input.signingSecret) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_SIGNING_SECRET_MISSING",
      message: "Strava webhook signing secret is not configured.",
      retryable: false,
      httpStatus: 500,
    });
  }

  const timestampNumber = Number(parsed.timestamp);
  if (!Number.isFinite(timestampNumber)) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_TIMESTAMP_INVALID",
      message: "Strava webhook signature timestamp was invalid.",
      retryable: false,
      httpStatus: 401,
    });
  }

  const timestampMs = timestampNumber < 10_000_000_000
    ? timestampNumber * 1000
    : timestampNumber;
  const nowMs = Date.parse(input.now);

  if (Number.isFinite(nowMs) && Math.abs(nowMs - timestampMs) > input.timestampToleranceMs) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_TIMESTAMP_STALE",
      message: "Strava webhook signature timestamp fell outside the allowed replay window.",
      retryable: false,
      httpStatus: 401,
    });
  }

  const expected = createHmac("sha256", input.signingSecret)
    .update(Buffer.concat([Buffer.from(`${parsed.timestamp}.`, "utf8"), input.rawBody]))
    .digest();

  if (!constantTimeHexDigestMatch(expected, parsed.signatures)) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_SIGNATURE_INVALID",
      message: "Strava webhook signature verification failed.",
      retryable: false,
      httpStatus: 401,
    });
  }

  return new Date(timestampMs).toISOString();
}

function buildStravaWebhookPreflightResponse(input: {
  method: string;
  url: URL;
  verifyToken: string | null;
}): DeviceSyncWebhookPreflightResponse | null {
  if (input.method.toUpperCase() !== "GET") {
    return null;
  }

  const mode = normalizeString(input.url.searchParams.get("hub.mode"));
  const challenge = normalizeString(input.url.searchParams.get("hub.challenge"));
  const verifyToken = normalizeString(input.url.searchParams.get("hub.verify_token"));

  if (!mode && !challenge && !verifyToken) {
    return null;
  }

  if (mode !== "subscribe" || !challenge) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_CHALLENGE_INVALID",
      message: "Strava webhook verification request was missing hub.mode=subscribe or hub.challenge.",
      retryable: false,
      httpStatus: 400,
    });
  }

  if (!input.verifyToken) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_VERIFY_TOKEN_MISSING",
      message: "Strava webhook verification token is not configured.",
      retryable: false,
      httpStatus: 500,
    });
  }

  if (verifyToken !== input.verifyToken) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_VERIFY_TOKEN_MISMATCH",
      message: "Strava webhook verification request did not include the configured verify token.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return {
    status: 200,
    body: {
      "hub.challenge": challenge,
    },
  };
}

export function resolveStravaWebhookPreflightResponse(input: {
  method: string;
  url: URL;
  verifyToken: string | null | undefined;
}): DeviceSyncWebhookPreflightResponse | null {
  return buildStravaWebhookPreflightResponse({
    method: input.method,
    url: input.url,
    verifyToken: normalizeString(input.verifyToken) ?? null,
  });
}

export async function revokeStravaDeviceSyncAccess(
  account: DeviceSyncAccount,
  config: StravaDeviceSyncRevocationConfig = {},
): Promise<void> {
  const tokens = getDeviceSyncAccountOAuthTokens(account);
  if (!tokens?.accessToken) {
    return;
  }

  await revokeStravaAccessToken(tokens.accessToken, config);
}

async function revokeStravaAccessToken(
  accessToken: string,
  config: StravaDeviceSyncRevocationConfig,
): Promise<void> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const authBaseUrl = (config.authBaseUrl ?? STRAVA_AUTH_BASE_URL).replace(/\/+$/u, "");
  const timeoutMs = Math.max(1_000, config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const url = new URL(`${authBaseUrl}${STRAVA_DEAUTHORIZE_PATH}`);
  url.searchParams.set("access_token", accessToken);

  const response = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 401 || response.status === 404) {
    return;
  }

  if (!response.ok) {
    throw buildStravaApiError(
      "STRAVA_DEAUTHORIZE_FAILED",
      "Strava deauthorization failed.",
      response,
      await parseResponseBody(response),
      {
        retryable: response.status === 429 || response.status >= 500,
        accountStatus: response.status === 401 ? "disconnected" : null,
        diagnostics: buildProviderRequestDiagnostics({
          method: "POST",
          endpointKind: "strava_oauth_deauthorize",
          authKind: "bearer_access_token_query",
          authPlacement: "query_parameters",
          credentialPresent: Boolean(accessToken),
          contentType: "none",
          bodyKind: "none",
          queryParameterNames: ["access_token"],
        }),
      },
    );
  }
}

export function createStravaDeviceSyncProvider(
  config: StravaDeviceSyncProviderConfig,
): DeviceSyncOAuthProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const authBaseUrl = (config.authBaseUrl ?? STRAVA_AUTH_BASE_URL).replace(/\/+$/u, "");
  const apiBaseUrl = (config.apiBaseUrl ?? STRAVA_API_BASE_URL).replace(/\/+$/u, "");
  const scopes = buildStravaDeviceSyncScopes(config.scopes);
  const backfillDays = Math.max(1, config.backfillDays ?? DEFAULT_BACKFILL_DAYS);
  const reconcileDays = Math.max(1, config.reconcileDays ?? DEFAULT_RECONCILE_DAYS);
  const reconcileIntervalMs = Math.max(60_000, config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
  const timeoutMs = Math.max(1_000, config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const webhookSigningSecret = normalizeString(config.webhookSigningSecret) ?? null;
  const webhookTimestampToleranceMs = Math.max(
    1_000,
    config.webhookTimestampToleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS,
  );
  const webhookVerifyToken = normalizeString(config.webhookVerifyToken) ?? null;
  const descriptor = buildStravaDeviceSyncRuntimeDescriptor(config);
  let webhookSubscriptionClient: StravaWebhookSubscriptionClient | null = null;

  async function postTokenRequest(
    parameters: Record<string, string>,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<StravaTokenResponse> {
    return postOAuthTokenRequest<StravaTokenResponse>({
      fetchImpl,
      url: `${authBaseUrl}${STRAVA_TOKEN_PATH}`,
      timeoutMs,
      parameters,
      signal: options.signal ?? null,
      buildError: (response, body) => {
        const diagnostics = buildOAuthTokenRequestDiagnostics({
          endpointKind: STRAVA_OAUTH_TOKEN_ENDPOINT_KIND,
          parameters,
          responseBody: body,
        });

        return buildStravaApiError("STRAVA_TOKEN_REQUEST_FAILED", "Strava token request failed.", response, body, {
          retryable: response.status >= 500,
          accountStatus: resolveOAuthTokenRequestAccountStatus({
            diagnostics,
            parameters,
            response,
          }),
          diagnostics,
        });
      },
    });
  }

  async function fetchStravaJson<T>(input: {
    path: string;
    accessToken: string;
    optional?: boolean;
    signal?: AbortSignal | null;
  }): Promise<T | null> {
    const endpointKind = resolveStravaApiEndpointKind(input.path);

    return fetchBearerJson<T>({
      fetchImpl,
      url: `${apiBaseUrl}${input.path}`,
      accessToken: input.accessToken,
      timeoutMs,
      signal: input.signal ?? null,
      optional: input.optional,
      buildError: (response, body) =>
        buildStravaApiError(
          "STRAVA_API_REQUEST_FAILED",
          `Strava API request failed for ${endpointKind}.`,
          response,
          body,
          {
            retryable: response.status === 429 || response.status >= 500,
            accountStatus: response.status === 401 ? "reauthorization_required" : null,
            diagnostics: buildProviderRequestDiagnostics({
              method: "GET",
              endpointKind,
              authKind: "bearer_access_token",
              authPlacement: "headers",
              credentialPresent: Boolean(input.accessToken),
              contentType: "none",
              bodyKind: "none",
              queryParameterNames: extractProviderQueryParameterNames(input.path),
            }),
          },
        ),
    });
  }

  async function fetchAthleteProfile(accessToken: string): Promise<Record<string, unknown>> {
    return coerceRecord(
      await fetchStravaJson<Record<string, unknown>>({
        path: "/athlete",
        accessToken,
      }),
    );
  }

  async function listAthleteActivities(
    requestJson: <T>(path: string, options?: { optional?: boolean }) => Promise<T | null>,
    input: {
      after?: string | null;
      before?: string | null;
    },
  ): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = [];
    let page = 1;

    while (true) {
      if (page > STRAVA_MAX_ACTIVITY_PAGES) {
        throw deviceSyncError({
          code: "STRAVA_ACTIVITY_PAGINATION_LIMIT_EXCEEDED",
          message: `Strava activity listing exceeded ${STRAVA_MAX_ACTIVITY_PAGES} pages.`,
          retryable: true,
          httpStatus: 502,
          details: {
            maxPages: STRAVA_MAX_ACTIVITY_PAGES,
          },
        });
      }

      const search = new URLSearchParams({
        page: String(page),
        per_page: String(STRAVA_PAGED_ACTIVITY_SIZE),
      });
      const afterSeconds = input.after ? Math.floor(Date.parse(input.after) / 1000) : null;
      const beforeSeconds = input.before ? Math.floor(Date.parse(input.before) / 1000) : null;

      if (afterSeconds !== null && Number.isFinite(afterSeconds)) {
        search.set("after", String(afterSeconds));
      }

      if (beforeSeconds !== null && Number.isFinite(beforeSeconds)) {
        search.set("before", String(beforeSeconds));
      }

      const pageRecords = coerceArrayOfRecords(
        await requestJson<unknown[]>(`/athlete/activities?${search.toString()}`),
      );

      if (pageRecords.length === 0) {
        break;
      }

      records.push(...pageRecords);

      if (records.length > STRAVA_MAX_ACTIVITY_RECORDS) {
        throw deviceSyncError({
          code: "STRAVA_ACTIVITY_RECORD_LIMIT_EXCEEDED",
          message: `Strava activity listing exceeded ${STRAVA_MAX_ACTIVITY_RECORDS} records.`,
          retryable: true,
          httpStatus: 502,
          details: {
            maxRecords: STRAVA_MAX_ACTIVITY_RECORDS,
          },
        });
      }

      if (pageRecords.length < STRAVA_PAGED_ACTIVITY_SIZE) {
        break;
      }

      page += 1;
    }

    return records;
  }

  async function fetchActivityById(
    requestJson: <T>(path: string, options?: { optional?: boolean }) => Promise<T | null>,
    activityId: string,
  ): Promise<Record<string, unknown> | null> {
    const payload = await requestJson<Record<string, unknown>>(
      `/activities/${encodeURIComponent(activityId)}`,
      { optional: true },
    );

    return payload ? coerceRecord(payload) : null;
  }

  function getWebhookSubscriptionClient(): StravaWebhookSubscriptionClient {
    if (!webhookSubscriptionClient) {
      webhookSubscriptionClient = createStravaWebhookSubscriptionClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        apiBaseUrl,
        fetchImpl,
        timeoutMs,
      });
    }

    return webhookSubscriptionClient;
  }

  const webhookAdmin: ProviderWebhookAdminCapability = {
    handleWebhookPreflight(context) {
      return resolveStravaWebhookPreflightResponse({
        method: context.method,
        url: context.url,
        verifyToken: webhookVerifyToken,
      });
    },
    async ensureSubscriptions(context) {
      if (!webhookVerifyToken) {
        return;
      }

      const callbackUrl = new URL(
        STRAVA_WEBHOOK_PATH.replace(/^\/+/, ""),
        `${context.publicBaseUrl}/`,
      ).toString();

      await getWebhookSubscriptionClient().ensure({
        callbackUrl,
        verifyToken: webhookVerifyToken,
      });
    },
  };

  function createApiSession(context: ProviderJobContext): StravaApiSession {
    const session = createRefreshingApiSession({
      context,
      requestJsonWithAccessToken: <T>(accessToken: string, path: string, options: { optional?: boolean }) =>
        fetchStravaJson<T>({
          path,
          accessToken,
          optional: options.optional,
          signal: context.signal ?? null,
        }),
      shouldRefresh: isStravaTokenNearExpiry,
    });

    return {
      get account() {
        return session.account;
      },
      requestJson: session.requestJson,
      fetchActivities(windowStart: string, windowEnd: string) {
        return listAthleteActivities(session.requestJson, {
          after: windowStart,
          before: windowEnd,
        });
      },
      fetchActivityById(activityId: string) {
        return fetchActivityById(session.requestJson, activityId);
      },
    };
  }

  async function executeWindowImport(
    context: ProviderJobContext,
    payload: Record<string, unknown>,
    fallbackWindowDays: number,
  ): Promise<ProviderJobResult> {
    const now = context.now;
    const windowStart = normalizeString(payload.windowStart) ?? subtractDays(now, fallbackWindowDays);
    const windowEnd = normalizeString(payload.windowEnd) ?? now;
    const windowKind = normalizeString(payload.windowKind)
      ?? (fallbackWindowDays === backfillDays ? "backfill" : "reconcile");
    const includeAthlete = payload.includeAthlete === true;
    const api = createApiSession(context);
    const athlete = includeAthlete
      ? coerceRecord(
          await api.requestJson<Record<string, unknown>>("/athlete", {
            optional: false,
          }),
        )
      : null;
    const activities = await api.fetchActivities(windowStart, windowEnd);

    await context.importSnapshot({
      accountId: api.account.externalAccountId,
      importedAt: now,
      ...(athlete && Object.keys(athlete).length > 0 ? { athlete } : {}),
      activities,
      sourceWindow: {
        kind: windowKind,
        windowStart,
        windowEnd,
      },
    });

    return {};
  }

  async function executeResourceImport(
    context: ProviderJobContext,
    payload: Record<string, unknown>,
  ): Promise<ProviderJobResult> {
    const resourceType = normalizeWebhookObjectType(payload.resourceType);
    const resourceId = normalizeIdentifier(payload.resourceId);

    if (!resourceType || !resourceId) {
      throw deviceSyncError({
        code: "STRAVA_RESOURCE_JOB_INVALID",
        message: "Strava resource job payload must include resourceType and resourceId.",
        retryable: false,
      });
    }

    if (resourceType !== "activity") {
      return {};
    }

    const api = createApiSession(context);
    const activity = await api.fetchActivityById(resourceId);

    if (!activity) {
      return {};
    }

    await context.importSnapshot({
      accountId: api.account.externalAccountId,
      importedAt: context.now,
      activities: [activity],
      sourceWindow: {
        kind: "resource",
        occurredAt: normalizeString(payload.occurredAt) ?? context.now,
        resourceId,
        resourceType,
      },
    });

    return {};
  }

  async function executeDeleteImport(
    context: ProviderJobContext,
    payload: Record<string, unknown>,
  ): Promise<ProviderJobResult> {
    const resourceType = normalizeString(payload.resourceType) ?? "activity";
    const resourceId = normalizeIdentifier(payload.resourceId);
    const occurredAt = normalizeString(payload.occurredAt) ?? context.now;
    const sourceEventType = normalizeString(payload.eventType) ?? `strava:${resourceType}:delete`;

    if (!resourceId) {
      throw deviceSyncError({
        code: "STRAVA_DELETE_JOB_INVALID",
        message: "Strava delete job payload must include resourceId.",
        retryable: false,
      });
    }

    await context.importSnapshot({
      accountId: context.account.externalAccountId,
      importedAt: context.now,
      deletions: [
        buildDeleteMarker({
          resourceId,
          resourceType,
          occurredAt,
          sourceEventType,
        }),
      ],
    });

    return {};
  }

  return adaptDeviceSyncOAuthProvider({
    provider: descriptor.provider,
    descriptor,
    webhookAdmin,
    buildConnectUrl(context) {
      return buildOAuthConnectUrl({
        baseUrl: authBaseUrl,
        authorizePath: STRAVA_AUTHORIZE_PATH,
        clientId: config.clientId,
        callbackUrl: context.callbackUrl,
        scopes: normalizeStravaDeviceSyncScopes(context.scopes.length > 0 ? context.scopes : scopes),
        state: context.state,
        scopeDelimiter: ",",
        extraSearchParams: {
          approval_prompt: "auto",
        },
      });
    },
    async exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult> {
      const tokenPayload = await postTokenRequest({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
      });
      const tokens = tokenResponseToAuthTokens(tokenPayload);
      try {
        tokens.refreshToken = requireRefreshToken(tokens.refreshToken, () =>
          deviceSyncError({
            code: "STRAVA_REFRESH_TOKEN_MISSING",
            message: "Strava token response did not include a refresh token.",
            retryable: false,
            httpStatus: 502,
          })
        );
        let athlete = coerceRecord(tokenPayload.athlete);
        let externalAccountId = normalizeIdentifier(athlete.id);

        if (!externalAccountId) {
          athlete = await fetchAthleteProfile(tokens.accessToken);
          externalAccountId = normalizeIdentifier(athlete.id);
        }

        if (!externalAccountId) {
          throw deviceSyncError({
            code: "STRAVA_ATHLETE_INVALID",
            message: "Strava token response did not include a stable athlete identifier.",
            retryable: false,
            httpStatus: 502,
          });
        }

        const grantedScopes = resolveAccountScopes(context.grantedScopes, tokenPayload.scope);

        return {
          externalAccountId,
          displayName: formatDeviceSyncAccountLabel(descriptor.provider, externalAccountId),
          scopes: grantedScopes,
          tokens,
          initialJobs: [
            {
              kind: "backfill",
              priority: 100,
              payload: buildWindowJobPayload({
                now: context.now,
                windowDays: backfillDays,
                includeAthlete: true,
                kind: "backfill",
              }),
            },
          ],
          nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
        };
      } catch (error) {
        await revokeStravaAccessToken(tokens.accessToken, config).catch(() => undefined);
        throw error;
      }
    },
    async refreshTokens(
      account: DeviceSyncAccount,
      options: { signal?: AbortSignal | null } = {},
    ): Promise<ProviderAuthTokens> {
      return refreshOAuthTokens({
        postTokenRequest: (parameters) => postTokenRequest(parameters, {
          signal: options.signal ?? null,
        }),
        account,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenResponseToAuthTokens,
        buildMissingRefreshTokenError: () =>
          deviceSyncError({
            code: "STRAVA_REFRESH_TOKEN_MISSING",
            message: "Strava account does not have a refresh token and must be reconnected.",
            retryable: false,
            accountStatus: "reauthorization_required",
          }),
        resolveRefreshToken: ({ responseRefreshToken }) =>
          requireRefreshToken(responseRefreshToken, () =>
            deviceSyncError({
              code: "STRAVA_REFRESH_TOKEN_MISSING",
              message: "Strava refresh response did not include a refresh token.",
              retryable: false,
              accountStatus: "reauthorization_required",
            }),
          ),
      });
    },
    async revokeAccess(account: DeviceSyncAccount): Promise<void> {
      const tokens = getDeviceSyncAccountOAuthTokens(account);
      if (!tokens?.accessToken) {
        return;
      }

      await revokeStravaAccessToken(tokens.accessToken, config);
    },
    createScheduledJobs(account: StoredDeviceSyncAccount, now: string): ProviderScheduleResult {
      return buildScheduledReconcileJobs({
        accountId: account.id,
        nextReconcileAt: account.nextReconcileAt,
        now,
        reconcileDays,
        reconcileIntervalMs,
        payload: {
          windowKind: "reconcile",
        } satisfies Omit<StravaDeviceSyncJobPayloads["reconcile"], "windowStart" | "windowEnd">,
      });
    },
    async verifyAndParseWebhook(context: ProviderWebhookContext): Promise<ProviderWebhookResult> {
      const providerSentAt = verifyStravaWebhookSignature({
        headers: context.headers,
        now: context.now,
        rawBody: context.rawBody,
        signingSecret: webhookSigningSecret,
        timestampToleranceMs: webhookTimestampToleranceMs,
      });

      let payload: unknown;

      try {
        payload = JSON.parse(context.rawBody.toString("utf8"));
      } catch (error) {
        throw deviceSyncError({
          code: "STRAVA_WEBHOOK_JSON_INVALID",
          message: "Strava webhook payload must be valid JSON.",
          retryable: false,
          httpStatus: 400,
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        });
      }

      const record = coerceRecord(payload) as StravaWebhookEventPayload & Record<string, unknown>;
      const objectType = normalizeWebhookObjectType(record.object_type);
      const aspectType = normalizeWebhookAspectType(record.aspect_type);
      const ownerId = normalizeIdentifier(record.owner_id);
      const objectId = normalizeIdentifier(record.object_id);
      const eventOccurredAt = epochSecondsToIso(record.event_time);
      const jobOccurredAt = eventOccurredAt ?? context.now;

      if (!objectType || !aspectType || !ownerId || !objectId) {
        throw deviceSyncError({
          code: "STRAVA_WEBHOOK_PAYLOAD_INVALID",
          message: "Strava webhook payload was missing object_type, aspect_type, owner_id, or object_id.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const updates = coerceRecord(record.updates);
      const deauthorization = isAthleteDeauthorizationEvent({
        objectType,
        aspectType,
        updates,
      });
      const eventType = deauthorization ? "athlete.deauthorized" : `${objectType}.${aspectType}`;
      const traceId = buildWebhookTraceId({
        aspect_type: aspectType,
        event_time: record.event_time ?? null,
        object_id: objectId,
        object_type: objectType,
        owner_id: ownerId,
        subscription_id: normalizeIdentifier(record.subscription_id) ?? null,
        updates,
      });
      const jobs: DeviceSyncJobInput[] = [];

      if (deauthorization) {
        jobs.push({
          kind: "deauthorize",
          priority: STRAVA_DEAUTHORIZE_WEBHOOK_PRIORITY,
          dedupeKey: `deauthorize:${ownerId}`,
          payload: {
            eventType,
            occurredAt: jobOccurredAt,
            resourceId: objectId,
            resourceType: objectType,
          } satisfies StravaWebhookJobPayload & StravaDeviceSyncJobPayloads["deauthorize"],
        });
      } else if (objectType === "activity") {
        const jobKind = aspectType === "delete" ? "delete" : "resource";

        jobs.push({
          kind: jobKind,
          priority: jobKind === "delete" ? STRAVA_DELETE_WEBHOOK_PRIORITY : STRAVA_ACTIVITY_WEBHOOK_PRIORITY,
          dedupeKey: buildWebhookDedupeKey({
            externalAccountId: ownerId,
            resourceType: objectType,
            resourceId: objectId,
            eventType,
            occurredAt: jobOccurredAt,
          }),
          payload: {
            eventType,
            occurredAt: jobOccurredAt,
            resourceId: objectId,
            resourceType: objectType,
          } satisfies StravaWebhookJobPayload & StravaDeviceSyncJobPayloads["resource" | "delete"],
        });
      }

      return {
        acceptanceMode: classifyDeviceSyncWebhookAcceptanceMode(jobs),
        externalAccountId: ownerId,
        eventType,
        traceId,
        ...(eventOccurredAt ? { occurredAt: eventOccurredAt } : {}),
        providerSentAt,
        resourceCategory: objectType,
        jobs,
      };
    },
    async executeJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult> {
      switch (job.kind) {
        case "backfill":
          return executeWindowImport(context, job.payload, backfillDays);
        case "reconcile":
          return executeWindowImport(context, job.payload, reconcileDays);
        case "resource":
          return executeResourceImport(context, job.payload);
        case "delete":
          return executeDeleteImport(context, job.payload);
        case "deauthorize":
          await context.disconnectAccount?.();
          return {};
        default:
          throw deviceSyncError({
            code: "STRAVA_JOB_KIND_UNSUPPORTED",
            message: `Strava job kind ${job.kind} is not supported.`,
            retryable: false,
          });
      }
    },
  });
}
