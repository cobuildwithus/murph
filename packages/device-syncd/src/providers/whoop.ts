import { createHmac, timingSafeEqual } from "node:crypto";

import { deviceSyncError } from "../errors.js";
import {
  addMilliseconds,
  coerceRecord,
  normalizeIdentifier,
  normalizeString,
  subtractDays,
} from "../shared.js";
import {
  buildOAuthConnectUrl,
  buildProviderApiError,
  buildScheduledReconcileJobs,
  createRefreshingApiSession,
  fetchBearerJson,
  isTokenNearExpiry,
  parseResponseBody,
  postOAuthTokenRequest,
  splitScopes,
  tokenResponseToAuthTokens as sharedTokenResponseToAuthTokens,
} from "./shared-oauth.js";

import type {
  DeviceSyncAccount,
  DeviceSyncJobInput,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
  ProviderAuthTokens,
  ProviderCallbackContext,
  ProviderConnectionResult,
  ProviderJobContext,
  ProviderJobResult,
  ProviderScheduleResult,
  ProviderWebhookContext,
  ProviderWebhookResult,
  StoredDeviceSyncAccount,
} from "../types.js";

const WHOOP_AUTH_PATH = "/oauth/oauth2/auth";
const WHOOP_TOKEN_PATH = "/oauth/oauth2/token";
const WHOOP_API_PREFIX = "/developer";
const WHOOP_CALLBACK_PATH = "/oauth/whoop/callback";
const WHOOP_WEBHOOK_PATH = "/webhooks/whoop";
const DEFAULT_WHOOP_BASE_URL = "https://api.prod.whoop.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60_000;
const DEFAULT_BACKFILL_DAYS = 90;
const DEFAULT_RECONCILE_DAYS = 21;
const DEFAULT_RECONCILE_INTERVAL_MS = 6 * 60 * 60_000;
const WHOOP_DEFAULT_SCOPES = Object.freeze([
  "offline",
  "read:profile",
  "read:body_measurement",
  "read:sleep",
  "read:recovery",
  "read:cycles",
  "read:workout",
]);

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

export interface WhoopDeviceSyncProviderConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  scopes?: string[];
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  webhookTimestampToleranceMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface WhoopDeleteMarker {
  resource_type: string;
  resource_id: string;
  occurred_at: string;
  source_event_type?: string;
  payload?: Record<string, unknown>;
}

type WhoopResourceType = "sleep" | "recovery" | "workout";
type WhoopWebhookJobKind = "resource" | "delete";

interface WhoopApiSession {
  account: DeviceSyncAccount;
  requestJson<T>(path: string, options?: { optional?: boolean }): Promise<T | null>;
}

interface WhoopResourceDescriptor {
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
  const cycle = cycleId ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}`, { optional: true }) : null;
  const recovery = cycleId ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}/recovery`, { optional: true }) : null;

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
    importResource: importWhoopSleepRelatedSnapshot,
  },
  recovery: {
    importResource: importWhoopSleepRelatedSnapshot,
  },
  workout: {
    importResource: importWhoopWorkoutSnapshot,
  },
});

function whoopBaseUrl(config: WhoopDeviceSyncProviderConfig): string {
  return (config.baseUrl ?? DEFAULT_WHOOP_BASE_URL).replace(/\/+$/u, "");
}

function buildWhoopScopes(input: string[] | undefined): string[] {
  const requested = [...WHOOP_DEFAULT_SCOPES, ...(input ?? [])];
  return [...new Set(requested.map((scope) => scope.trim()).filter(Boolean))];
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

function buildDisplayName(profile: Record<string, unknown>): string {
  const firstName = normalizeString(profile.first_name);
  const lastName = normalizeString(profile.last_name);
  const email = normalizeString(profile.email);
  const userId = normalizeIdentifier(profile.user_id ?? profile.id);
  return [firstName, lastName].filter(Boolean).join(" ") || email || `WHOOP ${userId ?? "user"}`;
}

function hasWhoopScope(account: DeviceSyncAccount, scope: string): boolean {
  return account.scopes.includes(scope);
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
  } = {},
) {
  return buildProviderApiError(code, message, response, body, options);
}

export function createWhoopDeviceSyncProvider(config: WhoopDeviceSyncProviderConfig): DeviceSyncProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = whoopBaseUrl(config);
  const scopes = buildWhoopScopes(config.scopes);
  const backfillDays = Math.max(1, config.backfillDays ?? DEFAULT_BACKFILL_DAYS);
  const reconcileDays = Math.max(1, config.reconcileDays ?? DEFAULT_RECONCILE_DAYS);
  const reconcileIntervalMs = Math.max(60_000, config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
  const webhookToleranceMs = Math.max(1_000, config.webhookTimestampToleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS);
  const timeoutMs = Math.max(1_000, config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);

  async function postTokenRequest(parameters: Record<string, string>): Promise<WhoopTokenResponse> {
    return postOAuthTokenRequest<WhoopTokenResponse>({
      fetchImpl,
      url: `${baseUrl}${WHOOP_TOKEN_PATH}`,
      timeoutMs,
      parameters,
      buildError: (response, body) =>
        buildWhoopApiError("WHOOP_TOKEN_REQUEST_FAILED", "WHOOP token request failed.", response, body, {
          retryable: response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        }),
    });
  }

  async function fetchWhoopJson<T>(input: {
    path: string;
    accessToken: string;
    optional?: boolean;
  }): Promise<T | null> {
    return fetchBearerJson<T>({
      fetchImpl,
      url: `${baseUrl}${WHOOP_API_PREFIX}${input.path}`,
      accessToken: input.accessToken,
      timeoutMs,
      optional: input.optional,
      buildError: (response, body) =>
        buildWhoopApiError("WHOOP_API_REQUEST_FAILED", `WHOOP API request failed for ${input.path}.`, response, body, {
          retryable: response.status === 429 || response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        }),
    });
  }

  async function fetchPagedCollection(
    requestJson: <T>(path: string, options?: { optional?: boolean }) => Promise<T | null>,
    path: string,
    start: string,
    end: string,
  ): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = [];
    let nextToken: string | null | undefined = null;

    do {
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
      nextToken = response.next_token ?? response.nextToken ?? null;
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
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      occurred_at: now,
      source_event_type: normalizeString(payload.eventType),
      payload: coerceRecord(payload.webhookPayload),
    };
  }

  function buildWhoopWebhookJobs(
    eventType: string,
    resourceId: string | null | undefined,
    payload: Record<string, unknown>,
  ): DeviceSyncJobInput[] {
    const eventDescriptor = WHOOP_WEBHOOK_EVENT_MAP[eventType];

    if (!eventDescriptor || !resourceId) {
      return [];
    }

    return [
      {
        kind: eventDescriptor.kind,
        payload: {
          resourceType: eventDescriptor.resourceType,
          resourceId,
          eventType,
          webhookPayload: payload,
        },
        priority: eventDescriptor.priority,
      },
    ];
  }

  async function refreshAccountForRevoke(account: DeviceSyncAccount): Promise<string> {
    if (!isTokenNearExpiry(account) || !account.refreshToken) {
      return account.accessToken;
    }

    try {
      const refreshed = await provider.refreshTokens(account);
      return refreshed.accessToken;
    } catch {
      return account.accessToken;
    }
  }

  function createApiSession(context: ProviderJobContext) {
    const session = createRefreshingApiSession({
      context,
      requestJsonWithAccessToken: <T>(accessToken: string, path: string, options: { optional?: boolean }) =>
        fetchWhoopJson<T>({
          path,
          accessToken,
          optional: options.optional,
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

  async function executeWindowImport(
    context: ProviderJobContext,
    payload: Record<string, unknown>,
    fallbackWindowDays: number,
  ): Promise<ProviderJobResult> {
    const now = context.now;
    const windowStart = normalizeString(payload.windowStart) ?? subtractDays(now, fallbackWindowDays);
    const windowEnd = normalizeString(payload.windowEnd) ?? now;
    const includeProfile = payload.includeProfile === true;
    const includeBodyMeasurement = payload.includeBodyMeasurement === true;
    const api = createApiSession(context);

    const snapshot: Record<string, unknown> = {
      accountId: api.account.externalAccountId,
      importedAt: now,
      sleeps: await api.fetchPagedCollection("/v2/activity/sleep", windowStart, windowEnd),
      recoveries: await api.fetchPagedCollection("/v2/recovery", windowStart, windowEnd),
      cycles: await api.fetchPagedCollection("/v2/cycle", windowStart, windowEnd),
      workouts: await api.fetchPagedCollection("/v2/activity/workout", windowStart, windowEnd),
    };

    if (includeProfile && hasWhoopScope(api.account, "read:profile")) {
      snapshot.profile = await api.requestJson<Record<string, unknown>>("/v2/user/profile/basic", { optional: false });
    }

    if (includeBodyMeasurement && hasWhoopScope(api.account, "read:body_measurement")) {
      snapshot.bodyMeasurement = await api.requestJson<Record<string, unknown>>("/v2/user/measurement/body", {
        optional: true,
      });
    }

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

    const snapshot = await descriptor.importResource(api, resourceId, now);

    if (!snapshot) {
      await context.importSnapshot(
        buildDeleteSnapshot(api.account, now, buildWhoopDeleteMarker(resourceType, resourceId, now, job.payload)),
      );
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

  const provider: DeviceSyncProvider = {
    provider: "whoop",
    callbackPath: WHOOP_CALLBACK_PATH,
    webhookPath: WHOOP_WEBHOOK_PATH,
    defaultScopes: scopes,
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
      const tokenPayload = await postTokenRequest({
        grant_type: "authorization_code",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: context.callbackUrl,
        code,
      });
      const tokens = tokenResponseToAuthTokens(tokenPayload);

      if (!tokens.refreshToken) {
        throw deviceSyncError({
          code: "WHOOP_REFRESH_TOKEN_MISSING",
          message:
            "WHOOP did not return a refresh token. Ensure the offline scope is enabled so the connection can auto-sync.",
          retryable: false,
          httpStatus: 502,
        });
      }

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

      return {
        externalAccountId,
        displayName: buildDisplayName(profile ?? {}),
        scopes: grantedScopes.length > 0 ? grantedScopes : [...scopes],
        metadata: {
          profile,
        },
        tokens,
        initialJobs: [
          {
            kind: "backfill",
            priority: 100,
            payload: {
              windowStart: subtractDays(context.now, backfillDays),
              windowEnd: context.now,
              includeProfile: true,
              includeBodyMeasurement: true,
            },
          },
        ],
        nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
      };
    },
    async refreshTokens(account: DeviceSyncAccount): Promise<ProviderAuthTokens> {
      const refreshToken = normalizeString(account.refreshToken);

      if (!refreshToken) {
        throw deviceSyncError({
          code: "WHOOP_REFRESH_TOKEN_MISSING",
          message: "WHOOP account does not have a refresh token and must be reconnected.",
          retryable: false,
          accountStatus: "reauthorization_required",
        });
      }

      const tokenPayload = await postTokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: "offline",
      });
      const tokens = tokenResponseToAuthTokens(tokenPayload);

      if (!tokens.refreshToken) {
        tokens.refreshToken = refreshToken;
      }

      return tokens;
    },
    async revokeAccess(account: DeviceSyncAccount): Promise<void> {
      const accessToken = await refreshAccountForRevoke(account);
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
          },
        );
      }
    },
    createScheduledJobs(account: StoredDeviceSyncAccount, now: string): ProviderScheduleResult {
      return buildScheduledReconcileJobs({
        accountId: account.id,
        nextReconcileAt: account.nextReconcileAt,
        now,
        reconcileDays,
        reconcileIntervalMs,
        payload: {
          includeProfile: false,
          includeBodyMeasurement: false,
        },
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
      const traceId = normalizeString(payload.trace_id);

      if (!externalAccountId || !eventType) {
        throw deviceSyncError({
          code: "WHOOP_WEBHOOK_PAYLOAD_INVALID",
          message: "WHOOP webhook payload is missing required fields.",
          retryable: false,
          httpStatus: 400,
        });
      }

      return {
        externalAccountId,
        eventType,
        traceId,
        occurredAt: context.now,
        payload,
        jobs: buildWhoopWebhookJobs(eventType, resourceId, payload),
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
  };

  return provider;
}
