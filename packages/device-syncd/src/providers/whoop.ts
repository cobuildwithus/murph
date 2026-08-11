import { createHmac, timingSafeEqual } from "node:crypto";

import {
  WHOOP_DEVICE_PROVIDER_DESCRIPTOR,
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
  requireDeviceProviderWebhookDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError } from "../errors.ts";
import type { WhoopDeviceSyncJobPayloads } from "../config/provider-manifests.ts";
import {
  buildWhoopDeviceSyncRuntimeDescriptor,
  buildWhoopDeviceSyncScopes,
} from "../configured-provider-runtime-descriptors.ts";
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
  buildOAuthConnectUrl,
  buildProviderApiError,
  buildScheduledReconcileJobs,
  adaptDeviceSyncOAuthProvider,
  createRefreshingApiSession,
  exchangeOAuthAuthorizationCode,
  fetchBearerJson,
  parseResponseBody,
  postOAuthTokenRequest,
  refreshOAuthTokens,
  requireRefreshToken,
  splitScopes,
  tokenResponseToAuthTokens as sharedTokenResponseToAuthTokens,
} from "./shared-oauth.ts";
import {
  buildOAuthTokenRequestDiagnostics,
  buildProviderRequestDiagnostics,
  extractProviderQueryParameterNames,
  resolveOAuthTokenRequestAccountStatus,
} from "./provider-diagnostics.ts";

import type {
  WhoopDeviceSyncProviderConfig,
} from "../config/provider-types.ts";
import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncOAuthProvider,
  ProviderAuthTokens,
  ProviderCallbackContext,
  ProviderConnectionResult,
  ProviderJobContext,
  ProviderJobResult,
  ProviderScheduleResult,
  ProviderWebhookContext,
  ProviderWebhookResult,
  StoredDeviceSyncAccount,
} from "../types.ts";
import { classifyDeviceSyncWebhookAcceptanceMode, getDeviceSyncAccountOAuthTokens } from "../types.ts";

export type { WhoopDeviceSyncProviderConfig } from "../config/provider-types.ts";

const WHOOP_AUTH_PATH = "/oauth/oauth2/auth";
const WHOOP_TOKEN_PATH = "/oauth/oauth2/token";
const WHOOP_API_PREFIX = "/developer";
const WHOOP_PROVIDER_DESCRIPTOR = WHOOP_DEVICE_PROVIDER_DESCRIPTOR;
const WHOOP_OAUTH = requireDeviceProviderOAuthDescriptor(WHOOP_PROVIDER_DESCRIPTOR);
const WHOOP_WEBHOOK = requireDeviceProviderWebhookDescriptor(WHOOP_PROVIDER_DESCRIPTOR);
const WHOOP_SYNC = requireDeviceProviderSyncDescriptor(WHOOP_PROVIDER_DESCRIPTOR);
const WHOOP_CALLBACK_PATH = WHOOP_OAUTH.callbackPath;
const WHOOP_WEBHOOK_PATH = WHOOP_WEBHOOK.path;
const DEFAULT_WHOOP_BASE_URL = "https://api.prod.whoop.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60_000;
const DEFAULT_BACKFILL_DAYS = WHOOP_SYNC.windows.backfillDays;
const DEFAULT_RECONCILE_DAYS = WHOOP_SYNC.windows.reconcileDays;
const DEFAULT_RECONCILE_INTERVAL_MS = WHOOP_SYNC.windows.reconcileIntervalMs;
const WHOOP_MAX_COLLECTION_PAGES = 100;
const WHOOP_MAX_COLLECTION_RECORDS = 25_000;
const WHOOP_OAUTH_TOKEN_ENDPOINT_KIND = "whoop_oauth_token";

type WhoopScope =
  | "offline"
  | "read:profile"
  | "read:body_measurement"
  | "read:sleep"
  | "read:recovery"
  | "read:cycles"
  | "read:workout";

interface WhoopTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

interface WhoopCollectionResponse<TRecord extends Record<string, unknown>> {
  records?: TRecord[];
  next_token?: string | null;
  nextToken?: string | null;
}

interface WhoopDeleteMarker {
  resource_type: string;
  resource_id: string;
  occurred_at: string;
  source_event_type?: string;
}

type WhoopResourceType = "sleep" | "recovery" | "workout";
type WhoopWebhookJobKind = "resource" | "delete";

interface WhoopWebhookJobPayload {
  eventType: string;
  occurredAt?: string | null;
  resourceId: string;
  resourceType: WhoopResourceType;
}

interface WhoopApiSession {
  account: DeviceSyncAccount;
  requestJson<T>(path: string, options?: { optional?: boolean }): Promise<T | null>;
}

interface WhoopResourceDescriptor {
  requiredScopes: readonly WhoopScope[];
  importResource(api: WhoopApiSession, resourceId: string, now: string): Promise<Record<string, unknown> | null>;
}

interface WhoopWebhookEventDescriptor {
  kind: WhoopWebhookJobKind;
  resourceType: WhoopResourceType;
  priority: number;
}

const WHOOP_WEBHOOK_EVENT_MAP: Record<string, WhoopWebhookEventDescriptor> = Object.freeze({
  "sleep.updated": {
    kind: "resource",
    resourceType: "sleep",
    priority: 90,
  },
  "recovery.updated": {
    kind: "resource",
    resourceType: "recovery",
    priority: 90,
  },
  "workout.updated": {
    kind: "resource",
    resourceType: "workout",
    priority: 90,
  },
  "sleep.deleted": {
    kind: "delete",
    resourceType: "sleep",
    priority: 95,
  },
  "recovery.deleted": {
    kind: "delete",
    resourceType: "recovery",
    priority: 95,
  },
  "workout.deleted": {
    kind: "delete",
    resourceType: "workout",
    priority: 95,
  },
});

async function importWhoopSleepRelatedSnapshot(
  api: WhoopApiSession,
  resourceId: string,
  now: string,
): Promise<Record<string, unknown> | null> {
  const sleepRecord = await api.requestJson<Record<string, unknown>>(`/v2/activity/sleep/${resourceId}`, {
    optional: true,
  });

  if (!sleepRecord) {
    return null;
  }

  const cycleId = normalizeIdentifier(sleepRecord.cycle_id);
  const cycle = cycleId && hasWhoopScope(api.account, "read:cycles")
    ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}`, { optional: true })
    : null;
  const recovery = cycleId && hasWhoopScope(api.account, "read:recovery")
    ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}/recovery`, { optional: true })
    : null;

  return {
    accountId: api.account.externalAccountId,
    importedAt: now,
    sleeps: [sleepRecord],
    cycles: cycle ? [cycle] : [],
    recoveries: recovery ? [recovery] : [],
  };
}

async function importWhoopWorkoutSnapshot(
  api: WhoopApiSession,
  resourceId: string,
  now: string,
): Promise<Record<string, unknown> | null> {
  const workout = await api.requestJson<Record<string, unknown>>(`/v2/activity/workout/${resourceId}`, {
    optional: true,
  });

  if (!workout) {
    return null;
  }

  return {
    accountId: api.account.externalAccountId,
    importedAt: now,
    workouts: [workout],
  };
}

const WHOOP_RESOURCE_DESCRIPTORS: Record<WhoopResourceType, WhoopResourceDescriptor> = Object.freeze({
  sleep: {
    requiredScopes: ["read:sleep"],
    importResource: importWhoopSleepRelatedSnapshot,
  },
  recovery: {
    requiredScopes: ["read:sleep", "read:recovery"],
    importResource: importWhoopSleepRelatedSnapshot,
  },
  workout: {
    requiredScopes: ["read:workout"],
    importResource: importWhoopWorkoutSnapshot,
  },
});

const WHOOP_WINDOW_COLLECTIONS = Object.freeze([
  {
    key: "sleeps",
    path: "/v2/activity/sleep",
    scope: "read:sleep",
  },
  {
    key: "recoveries",
    path: "/v2/recovery",
    scope: "read:recovery",
  },
  {
    key: "cycles",
    path: "/v2/cycle",
    scope: "read:cycles",
  },
  {
    key: "workouts",
    path: "/v2/activity/workout",
    scope: "read:workout",
  },
] as const satisfies ReadonlyArray<{
  key: "sleeps" | "recoveries" | "cycles" | "workouts";
  path: string;
  scope: WhoopScope;
}>);

function whoopBaseUrl(config: WhoopDeviceSyncProviderConfig): string {
  return (config.baseUrl ?? DEFAULT_WHOOP_BASE_URL).replace(/\/+$/u, "");
}

function hasWhoopScope(account: Pick<DeviceSyncAccount, "scopes">, scope: WhoopScope): boolean {
  return account.scopes.includes(scope);
}

function hasWhoopScopes(account: Pick<DeviceSyncAccount, "scopes">, scopes: readonly WhoopScope[]): boolean {
  return scopes.every((scope) => hasWhoopScope(account, scope));
}

function tokenResponseToAuthTokens(payload: WhoopTokenResponse): ProviderAuthTokens {
  return sharedTokenResponseToAuthTokens(payload, () =>
    deviceSyncError({
      code: "WHOOP_TOKEN_RESPONSE_INVALID",
      message: "WHOOP token response did not include an access token.",
      retryable: false,
      httpStatus: 502,
    }),
  );
}

function refreshTokenResponseToAuthTokens(payload: WhoopTokenResponse): ProviderAuthTokens {
  const tokens = tokenResponseToAuthTokens(payload);
  tokens.refreshToken = requireRefreshToken(tokens.refreshToken, () =>
    deviceSyncError({
      code: "WHOOP_REFRESH_TOKEN_MISSING",
      message: "WHOOP refresh response did not include the next refresh token and the account must be reconnected.",
      retryable: false,
      accountStatus: "reauthorization_required",
    }),
  );
  return tokens;
}

function constantTimeBase64Equals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function parseWhoopWebhookPayload(rawBody: Buffer): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    throw deviceSyncError({
      code: "WHOOP_WEBHOOK_INVALID_JSON",
      message: "WHOOP webhook payload was not valid JSON.",
      retryable: false,
      httpStatus: 400,
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw deviceSyncError({
      code: "WHOOP_WEBHOOK_INVALID_PAYLOAD",
      message: "WHOOP webhook payload must be a JSON object.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return parsed as Record<string, unknown>;
}

function buildWhoopApiError(
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

function resolveWhoopApiEndpointKind(path: string): string {
  const pathname = safeProviderPathname(path);

  if (pathname === "/v2/user/profile/basic") {
    return "whoop_user_profile";
  }

  if (pathname === "/v2/user/measurement/body") {
    return "whoop_body_measurement";
  }

  if (pathname === "/v2/activity/sleep") {
    return "whoop_sleep_collection";
  }

  if (/^\/v2\/activity\/sleep\/[^/]+$/u.test(pathname)) {
    return "whoop_sleep_resource";
  }

  if (pathname === "/v2/cycle") {
    return "whoop_cycle_collection";
  }

  if (/^\/v2\/cycle\/[^/]+\/recovery$/u.test(pathname)) {
    return "whoop_recovery_resource";
  }

  if (/^\/v2\/cycle\/[^/]+$/u.test(pathname)) {
    return "whoop_cycle_resource";
  }

  if (pathname === "/v2/recovery") {
    return "whoop_recovery_collection";
  }

  if (pathname === "/v2/activity/workout") {
    return "whoop_workout_collection";
  }

  if (/^\/v2\/activity\/workout\/[^/]+$/u.test(pathname)) {
    return "whoop_workout_resource";
  }

  return "whoop_api";
}

function safeProviderPathname(path: string): string {
  try {
    return new URL(path, "https://provider.invalid").pathname;
  } catch {
    return path.split("?")[0] ?? "";
  }
}

export function createWhoopDeviceSyncProvider(config: WhoopDeviceSyncProviderConfig): DeviceSyncOAuthProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = whoopBaseUrl(config);
  const scopes = buildWhoopDeviceSyncScopes(config.scopes);
  const backfillDays = Math.max(1, config.backfillDays ?? DEFAULT_BACKFILL_DAYS);
  const reconcileDays = Math.max(1, config.reconcileDays ?? DEFAULT_RECONCILE_DAYS);
  const reconcileIntervalMs = Math.max(60_000, config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
  const webhookToleranceMs = Math.max(1_000, config.webhookTimestampToleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS);
  const timeoutMs = Math.max(1_000, config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const descriptor = buildWhoopDeviceSyncRuntimeDescriptor(config);

  async function postTokenRequest(
    parameters: Record<string, string>,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<WhoopTokenResponse> {
    return postOAuthTokenRequest<WhoopTokenResponse>({
      fetchImpl,
      url: `${baseUrl}${WHOOP_TOKEN_PATH}`,
      timeoutMs,
      parameters,
      signal: options.signal ?? null,
      buildError: (response, body) => {
        const diagnostics = buildOAuthTokenRequestDiagnostics({
          endpointKind: WHOOP_OAUTH_TOKEN_ENDPOINT_KIND,
          parameters,
          responseBody: body,
        });
        return buildWhoopApiError("WHOOP_TOKEN_REQUEST_FAILED", "WHOOP token request failed.", response, body, {
          retryable: response.status === 429 || response.status >= 500,
          accountStatus: resolveOAuthTokenRequestAccountStatus({
            diagnostics,
            parameters,
            response,
            treatCompleteRefreshInvalidRequestAsReauthorization: true,
            treatUnauthorizedAsReauthorization: false,
          }),
          diagnostics,
        });
      },
    });
  }

  async function fetchWhoopJson<T>(input: {
    path: string;
    accessToken: string;
    optional?: boolean;
    signal?: AbortSignal | null;
  }): Promise<T | null> {
    const endpointKind = resolveWhoopApiEndpointKind(input.path);

    return fetchBearerJson<T>({
      fetchImpl,
      url: `${baseUrl}${WHOOP_API_PREFIX}${input.path}`,
      accessToken: input.accessToken,
      timeoutMs,
      signal: input.signal ?? null,
      optional: input.optional,
      buildError: (response, body) =>
        buildWhoopApiError("WHOOP_API_REQUEST_FAILED", `WHOOP API request failed for ${endpointKind}.`, response, body, {
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
      }),
    });
  }

  async function revokeWhoopAccessToken(accessToken: string): Promise<void> {
    const response = await fetchImpl(`${baseUrl}${WHOOP_API_PREFIX}/v2/user/access`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 401 || response.status === 404 || response.status === 204) {
      return;
    }

    if (!response.ok) {
      throw buildWhoopApiError(
        "WHOOP_REVOKE_FAILED",
        "WHOOP revoke access request failed.",
        response,
        await parseResponseBody(response),
        {
          retryable: response.status === 429 || response.status >= 500,
          diagnostics: buildProviderRequestDiagnostics({
            method: "DELETE",
            endpointKind: "whoop_revoke_access",
            authKind: "bearer_access_token",
            authPlacement: "headers",
            credentialPresent: Boolean(accessToken),
            contentType: "none",
            bodyKind: "none",
          }),
        },
      );
    }
  }

  async function fetchPagedCollection(
    requestJson: <T>(path: string, options?: { optional?: boolean }) => Promise<T | null>,
    path: string,
    start: string,
    end: string,
  ): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = [];
    let nextToken: string | null | undefined = null;
    const seenNextTokens = new Set<string>();
    let pageCount = 0;

    do {
      pageCount += 1;
      if (pageCount > WHOOP_MAX_COLLECTION_PAGES) {
        throw deviceSyncError({
          code: "WHOOP_PAGINATION_LIMIT_EXCEEDED",
          message: `WHOOP API pagination exceeded ${WHOOP_MAX_COLLECTION_PAGES} pages for ${path}.`,
          retryable: true,
          httpStatus: 502,
          details: {
            maxPages: WHOOP_MAX_COLLECTION_PAGES,
            path,
          },
        });
      }

      const search = new URLSearchParams({
        limit: "25",
        start,
        end,
      });

      if (nextToken) {
        search.set("nextToken", nextToken);
      }

      const response =
        (await requestJson<WhoopCollectionResponse<Record<string, unknown>>>(`${path}?${search.toString()}`)) ?? {
          records: [],
        };
      records.push(...((response.records ?? []).map((entry) => coerceRecord(entry))));

      if (records.length > WHOOP_MAX_COLLECTION_RECORDS) {
        throw deviceSyncError({
          code: "WHOOP_RECORD_LIMIT_EXCEEDED",
          message: `WHOOP API pagination exceeded ${WHOOP_MAX_COLLECTION_RECORDS} records for ${path}.`,
          retryable: true,
          httpStatus: 502,
          details: {
            maxRecords: WHOOP_MAX_COLLECTION_RECORDS,
            path,
          },
        });
      }

      nextToken = normalizeString(response.next_token ?? response.nextToken) ?? null;
      if (nextToken) {
        if (seenNextTokens.has(nextToken)) {
          throw deviceSyncError({
            code: "WHOOP_PAGINATION_LOOP",
            message: `WHOOP API pagination repeated a next token for ${path}.`,
            retryable: true,
            httpStatus: 502,
            details: {
              pageCount,
              path,
            },
          });
        }
        seenNextTokens.add(nextToken);
      }
    } while (nextToken);

    return records;
  }

  function buildDeleteSnapshot(account: DeviceSyncAccount, now: string, marker: WhoopDeleteMarker): Record<string, unknown> {
    return {
      accountId: account.externalAccountId,
      importedAt: now,
      deletions: [marker],
    };
  }

  function getWhoopResourceDescriptor(resourceType: string): WhoopResourceDescriptor | null {
    return WHOOP_RESOURCE_DESCRIPTORS[resourceType as WhoopResourceType] ?? null;
  }

  function requireWhoopJobResource(
    job: DeviceSyncJobRecord,
    options: {
      code: string;
      message: string;
    },
  ): { resourceType: string; resourceId: string } {
    const resourceType = normalizeString(job.payload.resourceType);
    const resourceId = normalizeIdentifier(job.payload.resourceId);

    if (!resourceType || !resourceId) {
      throw deviceSyncError({
        code: options.code,
        message: options.message,
        retryable: false,
      });
    }

    return {
      resourceType,
      resourceId,
    };
  }

  function buildWhoopDeleteMarker(
    resourceType: string,
    resourceId: string,
    now: string,
    payload: Record<string, unknown>,
  ): WhoopDeleteMarker {
    const occurredAt = normalizeString(payload.occurredAt) ?? now;

    return {
      resource_type: resourceType,
      resource_id: resourceId,
      occurred_at: occurredAt,
      source_event_type: normalizeString(payload.eventType),
    };
  }

  function buildWhoopWebhookJobs(
    eventType: string,
    resourceId: string | null | undefined,
    payload: Record<string, unknown>,
    traceId: string,
  ): DeviceSyncJobInput[] {
    const eventDescriptor = WHOOP_WEBHOOK_EVENT_MAP[eventType];
    const occurredAt = normalizeString(payload.occurred_at ?? payload.occurredAt);

    if (!eventDescriptor || !resourceId) {
      return [];
    }

    return [
      {
        kind: eventDescriptor.kind,
        payload: {
          eventType,
          ...(occurredAt ? { occurredAt } : {}),
          resourceType: eventDescriptor.resourceType,
          resourceId,
        } satisfies WhoopWebhookJobPayload & WhoopDeviceSyncJobPayloads["resource" | "delete"],
        priority: eventDescriptor.priority,
        dedupeKey: `whoop-webhook:${traceId}`,
      },
    ];
  }

  function createApiSession(context: ProviderJobContext) {
    const session = createRefreshingApiSession({
      context,
      requestJsonWithAccessToken: <T>(accessToken: string, path: string, options: { optional?: boolean }) =>
        fetchWhoopJson<T>({
          path,
          accessToken,
          optional: options.optional,
          signal: context.signal ?? null,
        }),
    });

    return {
      get account() {
        return session.account;
      },
      requestJson: session.requestJson,
      fetchPagedCollection(path: string, start: string, end: string) {
        return fetchPagedCollection(session.requestJson, path, start, end);
      },
    };
  }

  async function populateWhoopWindowSnapshot(
    api: ReturnType<typeof createApiSession>,
    snapshot: Record<string, unknown>,
    windowStart: string,
    windowEnd: string,
  ): Promise<void> {
    for (const descriptor of WHOOP_WINDOW_COLLECTIONS) {
      if (!hasWhoopScope(api.account, descriptor.scope)) {
        continue;
      }

      snapshot[descriptor.key] = await api.fetchPagedCollection(descriptor.path, windowStart, windowEnd);
    }

    if (!hasWhoopScope(api.account, "read:body_measurement")) {
      return;
    }

    const bodyMeasurement = await api.requestJson<Record<string, unknown>>("/v2/user/measurement/body", {
      optional: true,
    });

    if (bodyMeasurement) {
      snapshot.bodyMeasurements = bodyMeasurement;
    }
  }

  async function executeWindowImport(
    context: ProviderJobContext,
    payload: Record<string, unknown>,
    fallbackWindowDays: number,
  ): Promise<ProviderJobResult> {
    const now = context.now;
    const windowStart = normalizeString(payload.windowStart) ?? subtractDays(now, fallbackWindowDays);
    const windowEnd = normalizeString(payload.windowEnd) ?? now;
    const api = createApiSession(context);

    const snapshot: Record<string, unknown> = {
      accountId: api.account.externalAccountId,
      importedAt: now,
    };

    await populateWhoopWindowSnapshot(api, snapshot, windowStart, windowEnd);

    await context.importSnapshot(snapshot);
    return {};
  }

  async function executeWhoopResourceJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult> {
    const { resourceType, resourceId } = requireWhoopJobResource(job, {
      code: "WHOOP_JOB_INVALID",
      message: `WHOOP ${job.kind} job is missing resource information.`,
    });
    const now = context.now;
    const descriptor = getWhoopResourceDescriptor(resourceType);
    const api = createApiSession(context);

    if (!descriptor) {
      throw deviceSyncError({
        code: "WHOOP_RESOURCE_UNSUPPORTED",
        message: `WHOOP resource type ${resourceType} is not supported.`,
        retryable: false,
      });
    }

    if (!hasWhoopScopes(api.account, descriptor.requiredScopes)) {
      return {};
    }

    const snapshot = await descriptor.importResource(api, resourceId, now);

    if (!snapshot) {
      return {};
    }

    await context.importSnapshot(snapshot);
    return {};
  }

  async function executeWhoopDeleteJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult> {
    const { resourceType, resourceId } = requireWhoopJobResource(job, {
      code: "WHOOP_DELETE_JOB_INVALID",
      message: "WHOOP delete job did not include a resourceType and resourceId.",
    });

    await context.importSnapshot(
      buildDeleteSnapshot(
        context.account,
        context.now,
        buildWhoopDeleteMarker(resourceType, resourceId, context.now, job.payload),
      ),
    );

    return {};
  }

  const provider = adaptDeviceSyncOAuthProvider({
    provider: descriptor.provider,
    descriptor,
    buildConnectUrl(context) {
      return buildOAuthConnectUrl({
        baseUrl,
        authorizePath: WHOOP_AUTH_PATH,
        clientId: config.clientId,
        callbackUrl: context.callbackUrl,
        scopes: context.scopes,
        state: context.state,
      });
    },
    async exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult> {
      const { tokenPayload, tokens } = await exchangeOAuthAuthorizationCode({
        postTokenRequest,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        callbackUrl: context.callbackUrl,
        code,
        tokenResponseToAuthTokens,
        buildMissingRefreshTokenError: () =>
          deviceSyncError({
            code: "WHOOP_REFRESH_TOKEN_MISSING",
            message:
              "WHOOP did not return a refresh token. Ensure the offline scope is enabled so the connection can auto-sync.",
            retryable: false,
            httpStatus: 502,
          }),
      });

      try {
        const profile = await fetchWhoopJson<Record<string, unknown>>({
          path: "/v2/user/profile/basic",
          accessToken: tokens.accessToken,
        });
        const externalAccountId = normalizeIdentifier(profile?.user_id ?? profile?.id);

        if (!externalAccountId) {
          throw deviceSyncError({
            code: "WHOOP_PROFILE_INVALID",
            message: "WHOOP profile response did not include a user identifier.",
            retryable: false,
            httpStatus: 502,
          });
        }

        const grantedScopes = splitScopes(tokenPayload.scope);
        const effectiveScopes = grantedScopes.length > 0 ? grantedScopes : [...scopes];

        return {
          externalAccountId,
          displayName: formatDeviceSyncAccountLabel(descriptor.provider, externalAccountId),
          scopes: effectiveScopes,
          tokens,
          initialJobs: [
            {
              kind: "backfill",
              priority: 100,
              payload: {
                windowStart: subtractDays(context.now, backfillDays),
                windowEnd: context.now,
              } satisfies WhoopDeviceSyncJobPayloads["backfill"],
            },
          ],
          nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
        };
      } catch (error) {
        await revokeWhoopAccessToken(tokens.accessToken).catch(() => undefined);
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
        tokenResponseToAuthTokens: refreshTokenResponseToAuthTokens,
        buildMissingRefreshTokenError: () =>
          deviceSyncError({
            code: "WHOOP_REFRESH_TOKEN_MISSING",
            message: "WHOOP account does not have a refresh token and must be reconnected.",
            retryable: false,
            accountStatus: "reauthorization_required",
          }),
        extraParameters: {
          scope: "offline",
        },
      });
    },
    async revokeAccess(account: DeviceSyncAccount): Promise<void> {
      const tokens = getDeviceSyncAccountOAuthTokens(account);
      if (!tokens?.accessToken) {
        return;
      }

      await revokeWhoopAccessToken(tokens.accessToken);
    },
    createScheduledJobs(account: StoredDeviceSyncAccount, now: string): ProviderScheduleResult {
      return buildScheduledReconcileJobs({
        accountId: account.id,
        nextReconcileAt: account.nextReconcileAt,
        now,
        reconcileDays,
        reconcileIntervalMs,
        payload: {} satisfies Omit<WhoopDeviceSyncJobPayloads["reconcile"], "windowStart" | "windowEnd">,
      });
    },
    async verifyAndParseWebhook(context: ProviderWebhookContext): Promise<ProviderWebhookResult> {
      const signature = context.headers.get("x-whoop-signature");
      const timestamp = context.headers.get("x-whoop-signature-timestamp");

      if (!signature || !timestamp) {
        throw deviceSyncError({
          code: "WHOOP_WEBHOOK_SIGNATURE_MISSING",
          message: "WHOOP webhook signature headers are missing.",
          retryable: false,
          httpStatus: 401,
        });
      }

      const rawTimestampNumber = Number(timestamp);

      if (!Number.isFinite(rawTimestampNumber)) {
        throw deviceSyncError({
          code: "WHOOP_WEBHOOK_TIMESTAMP_INVALID",
          message: "WHOOP webhook timestamp header was invalid.",
          retryable: false,
          httpStatus: 401,
        });
      }

      const timestampNumber = rawTimestampNumber < 10_000_000_000 ? rawTimestampNumber * 1000 : rawTimestampNumber;

      const nowMs = Date.parse(context.now);

      if (Math.abs(nowMs - timestampNumber) > webhookToleranceMs) {
        throw deviceSyncError({
          code: "WHOOP_WEBHOOK_TIMESTAMP_STALE",
          message: "WHOOP webhook timestamp fell outside the allowed replay window.",
          retryable: false,
          httpStatus: 401,
        });
      }

      const signedPayload = Buffer.concat([Buffer.from(timestamp, "utf8"), context.rawBody]);
      const expectedSignature = createHmac("sha256", config.clientSecret).update(signedPayload).digest("base64");

      if (!constantTimeBase64Equals(expectedSignature, signature)) {
        throw deviceSyncError({
          code: "WHOOP_WEBHOOK_SIGNATURE_INVALID",
          message: "WHOOP webhook signature validation failed.",
          retryable: false,
          httpStatus: 401,
        });
      }

      const payload = parseWhoopWebhookPayload(context.rawBody);
      const externalAccountId = normalizeIdentifier(payload.user_id);
      const eventType = normalizeString(payload.type);
      const resourceId = normalizeIdentifier(payload.id);

      if (!externalAccountId || !eventType) {
        throw deviceSyncError({
          code: "WHOOP_WEBHOOK_PAYLOAD_INVALID",
          message: "WHOOP webhook payload is missing required fields.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const traceId =
        normalizeString(payload.trace_id) ??
        sha256Text(
          `${externalAccountId}:${eventType}:${resourceId ?? ""}:${sha256Text(context.rawBody.toString("utf8"))}`,
        );
      const jobs = buildWhoopWebhookJobs(eventType, resourceId, payload, traceId);
      const occurredAt = normalizeIsoTimestamp(
        payload.occurred_at ?? payload.occurredAt,
      );

      return {
        acceptanceMode: classifyDeviceSyncWebhookAcceptanceMode(jobs),
        externalAccountId,
        eventType,
        traceId,
        ...(occurredAt ? { occurredAt } : {}),
        providerSentAt: new Date(timestampNumber).toISOString(),
        resourceCategory: WHOOP_WEBHOOK_EVENT_MAP[eventType]?.resourceType ?? null,
        jobs,
      };
    },
    async executeJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult> {
      if (job.kind === "backfill") {
        return executeWindowImport(context, job.payload, backfillDays);
      }

      if (job.kind === "reconcile") {
        return executeWindowImport(context, job.payload, reconcileDays);
      }

      if (job.kind === "resource") {
        return executeWhoopResourceJob(context, job);
      }

      if (job.kind === "delete") {
        return executeWhoopDeleteJob(context, job);
      }

      throw deviceSyncError({
        code: "WHOOP_JOB_KIND_UNSUPPORTED",
        message: `WHOOP job kind ${job.kind} is not supported.`,
        retryable: false,
      });
    },
  });

  return provider;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
