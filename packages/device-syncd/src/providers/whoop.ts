import { createHmac, timingSafeEqual } from "node:crypto";

import { deviceSyncError } from "../errors.js";
import {
  addMilliseconds,
  coerceRecord,
  computeRetryDelayMs,
  normalizeIdentifier,
  normalizeString,
  normalizeStringList,
  sha256Text,
  sleep,
  subtractDays,
} from "../shared.js";

import type {
  DeviceSyncAccount,
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

function whoopBaseUrl(config: WhoopDeviceSyncProviderConfig): string {
  return (config.baseUrl ?? DEFAULT_WHOOP_BASE_URL).replace(/\/+$/u, "");
}

function buildWhoopScopes(input: string[] | undefined): string[] {
  const requested = [...WHOOP_DEFAULT_SCOPES, ...(input ?? [])];
  return [...new Set(requested.map((scope) => scope.trim()).filter(Boolean))];
}

function isoFromExpiresIn(expiresIn: unknown): string | undefined {
  const numeric = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  return Number.isFinite(numeric) ? addMilliseconds(new Date().toISOString(), numeric * 1000) : undefined;
}

function splitScopes(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return normalizeStringList(value.split(/\s+/u));
}

function tokenResponseToAuthTokens(payload: WhoopTokenResponse): ProviderAuthTokens {
  const accessToken = normalizeString(payload.access_token);

  if (!accessToken) {
    throw deviceSyncError({
      code: "WHOOP_TOKEN_RESPONSE_INVALID",
      message: "WHOOP token response did not include an access token.",
      retryable: false,
      httpStatus: 502,
    });
  }

  return {
    accessToken,
    refreshToken: normalizeString(payload.refresh_token) ?? null,
    accessTokenExpiresAt: isoFromExpiresIn(payload.expires_in),
  };
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

function isTokenNearExpiry(account: DeviceSyncAccount, skewMs = 60_000): boolean {
  if (!account.accessTokenExpiresAt) {
    return false;
  }

  return Date.parse(account.accessTokenExpiresAt) - Date.now() <= skewMs;
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

async function parseResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
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
  return deviceSyncError({
    code,
    message,
    retryable: options.retryable ?? (response.status === 429 || response.status >= 500),
    httpStatus: response.status,
    accountStatus: options.accountStatus ?? null,
    details: {
      status: response.status,
      bodySnippet: body.slice(0, 500),
    },
  });
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
    const response = await fetchImpl(`${baseUrl}${WHOOP_TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(parameters),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw buildWhoopApiError(
        "WHOOP_TOKEN_REQUEST_FAILED",
        "WHOOP token request failed.",
        response,
        await parseResponseBody(response),
        {
          retryable: response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        },
      );
    }

    return (await response.json()) as WhoopTokenResponse;
  }

  async function fetchWhoopJson<T>(input: {
    path: string;
    accessToken: string;
    optional?: boolean;
  }): Promise<T | null> {
    const response = await fetchImpl(`${baseUrl}${WHOOP_API_PREFIX}${input.path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 404 && input.optional) {
      return null;
    }

    if (!response.ok) {
      const body = await parseResponseBody(response);
      throw buildWhoopApiError(
        "WHOOP_API_REQUEST_FAILED",
        `WHOOP API request failed for ${input.path}.`,
        response,
        body,
        {
          retryable: response.status === 429 || response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        },
      );
    }

    return (await response.json()) as T;
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
    let currentAccount = context.account;

    async function refresh(): Promise<DeviceSyncAccount> {
      currentAccount = await context.refreshAccountTokens();
      return currentAccount;
    }

    async function requestJson<T>(path: string, options: { optional?: boolean } = {}): Promise<T | null> {
      let attempt = 0;

      while (true) {
        if (isTokenNearExpiry(currentAccount)) {
          await refresh();
        }

        try {
          return await fetchWhoopJson<T>({
            path,
            accessToken: currentAccount.accessToken,
            optional: options.optional,
          });
        } catch (error) {
          const retryable =
            typeof error === "object" &&
            error !== null &&
            "retryable" in error &&
            Boolean((error as { retryable?: boolean }).retryable);
          const accountStatus =
            typeof error === "object" &&
            error !== null &&
            "accountStatus" in error
              ? ((error as { accountStatus?: "reauthorization_required" | "disconnected" | null }).accountStatus ??
                null)
              : null;
          const httpStatus =
            typeof error === "object" &&
            error !== null &&
            "httpStatus" in error
              ? Number((error as { httpStatus?: number }).httpStatus)
              : undefined;

          if (httpStatus === 401 && attempt === 0) {
            await refresh();
            attempt += 1;
            continue;
          }

          if (retryable && attempt < 3) {
            attempt += 1;
            await sleep(computeRetryDelayMs(attempt));
            continue;
          }

          if (accountStatus === "reauthorization_required") {
            throw error;
          }

          throw error;
        }
      }
    }

    return {
      get account() {
        return currentAccount;
      },
      requestJson,
      fetchPagedCollection(path: string, start: string, end: string) {
        return fetchPagedCollection(requestJson, path, start, end);
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

  async function executeResourceImport(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult> {
    const payload = job.payload;
    const resourceType = normalizeString(payload.resourceType);
    const resourceId = normalizeIdentifier(payload.resourceId);
    const now = context.now;

    if (!resourceType || !resourceId) {
      throw deviceSyncError({
        code: "WHOOP_JOB_INVALID",
        message: `WHOOP ${job.kind} job is missing resource information.`,
        retryable: false,
      });
    }

    const api = createApiSession(context);

    if (resourceType === "sleep") {
      const sleepRecord = await api.requestJson<Record<string, unknown>>(`/v2/activity/sleep/${resourceId}`, {
        optional: true,
      });

      if (!sleepRecord) {
        await context.importSnapshot(
          buildDeleteSnapshot(api.account, now, {
            resource_type: "sleep",
            resource_id: resourceId,
            occurred_at: now,
            source_event_type: normalizeString(payload.eventType),
            payload: coerceRecord(payload.webhookPayload),
          }),
        );
        return {};
      }

      const cycleId = normalizeIdentifier(sleepRecord.cycle_id);
      const cycle = cycleId ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}`, { optional: true }) : null;
      const recovery = cycleId
        ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}/recovery`, { optional: true })
        : null;

      await context.importSnapshot({
        accountId: api.account.externalAccountId,
        importedAt: now,
        sleeps: [sleepRecord],
        cycles: cycle ? [cycle] : [],
        recoveries: recovery ? [recovery] : [],
      });
      return {};
    }

    if (resourceType === "recovery") {
      const sleepRecord = await api.requestJson<Record<string, unknown>>(`/v2/activity/sleep/${resourceId}`, {
        optional: true,
      });

      if (!sleepRecord) {
        await context.importSnapshot(
          buildDeleteSnapshot(api.account, now, {
            resource_type: "recovery",
            resource_id: resourceId,
            occurred_at: now,
            source_event_type: normalizeString(payload.eventType),
            payload: coerceRecord(payload.webhookPayload),
          }),
        );
        return {};
      }

      const cycleId = normalizeIdentifier(sleepRecord.cycle_id);
      const cycle = cycleId ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}`, { optional: true }) : null;
      const recovery = cycleId
        ? await api.requestJson<Record<string, unknown>>(`/v2/cycle/${cycleId}/recovery`, { optional: true })
        : null;

      await context.importSnapshot({
        accountId: api.account.externalAccountId,
        importedAt: now,
        sleeps: [sleepRecord],
        cycles: cycle ? [cycle] : [],
        recoveries: recovery ? [recovery] : [],
      });
      return {};
    }

    if (resourceType === "workout") {
      const workout = await api.requestJson<Record<string, unknown>>(`/v2/activity/workout/${resourceId}`, {
        optional: true,
      });

      if (!workout) {
        await context.importSnapshot(
          buildDeleteSnapshot(api.account, now, {
            resource_type: "workout",
            resource_id: resourceId,
            occurred_at: now,
            source_event_type: normalizeString(payload.eventType),
            payload: coerceRecord(payload.webhookPayload),
          }),
        );
        return {};
      }

      await context.importSnapshot({
        accountId: api.account.externalAccountId,
        importedAt: now,
        workouts: [workout],
      });
      return {};
    }

    throw deviceSyncError({
      code: "WHOOP_RESOURCE_UNSUPPORTED",
      message: `WHOOP resource type ${resourceType} is not supported.`,
      retryable: false,
    });
  }

  const provider: DeviceSyncProvider = {
    provider: "whoop",
    callbackPath: WHOOP_CALLBACK_PATH,
    webhookPath: WHOOP_WEBHOOK_PATH,
    defaultScopes: scopes,
    buildConnectUrl(context) {
      const search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: context.callbackUrl,
        scope: context.scopes.join(" "),
        state: context.state,
      });

      return `${baseUrl}${WHOOP_AUTH_PATH}?${search.toString()}`;
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
      const dedupeKey = `reconcile:${sha256Text(`${account.id}:${account.nextReconcileAt ?? now}`)}`;
      return {
        jobs: [
          {
            kind: "reconcile",
            dedupeKey,
            priority: 25,
            payload: {
              windowStart: subtractDays(now, reconcileDays),
              windowEnd: now,
              includeProfile: false,
              includeBodyMeasurement: false,
            },
          },
        ],
        nextReconcileAt: addMilliseconds(now, reconcileIntervalMs),
      };
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

      if (Math.abs(Date.now() - timestampNumber) > webhookToleranceMs) {
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

      const jobs = (() => {
        if (eventType === "sleep.updated" && resourceId) {
          return [
            {
              kind: "resource",
              payload: {
                resourceType: "sleep",
                resourceId,
                eventType,
                webhookPayload: payload,
              },
              priority: 90,
            },
          ];
        }

        if (eventType === "recovery.updated" && resourceId) {
          return [
            {
              kind: "resource",
              payload: {
                resourceType: "recovery",
                resourceId,
                eventType,
                webhookPayload: payload,
              },
              priority: 90,
            },
          ];
        }

        if (eventType === "workout.updated" && resourceId) {
          return [
            {
              kind: "resource",
              payload: {
                resourceType: "workout",
                resourceId,
                eventType,
                webhookPayload: payload,
              },
              priority: 90,
            },
          ];
        }

        if (eventType === "sleep.deleted" && resourceId) {
          return [
            {
              kind: "delete",
              payload: {
                resourceType: "sleep",
                resourceId,
                eventType,
                webhookPayload: payload,
              },
              priority: 95,
            },
          ];
        }

        if (eventType === "recovery.deleted" && resourceId) {
          return [
            {
              kind: "delete",
              payload: {
                resourceType: "recovery",
                resourceId,
                eventType,
                webhookPayload: payload,
              },
              priority: 95,
            },
          ];
        }

        if (eventType === "workout.deleted" && resourceId) {
          return [
            {
              kind: "delete",
              payload: {
                resourceType: "workout",
                resourceId,
                eventType,
                webhookPayload: payload,
              },
              priority: 95,
            },
          ];
        }

        return [];
      })();

      return {
        externalAccountId,
        eventType,
        traceId,
        occurredAt: context.now,
        payload,
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
        return executeResourceImport(context, job);
      }

      if (job.kind === "delete") {
        const resourceType = normalizeString(job.payload.resourceType);
        const resourceId = normalizeIdentifier(job.payload.resourceId);

        if (!resourceType || !resourceId) {
          throw deviceSyncError({
            code: "WHOOP_DELETE_JOB_INVALID",
            message: "WHOOP delete job did not include a resourceType and resourceId.",
            retryable: false,
          });
        }

        await context.importSnapshot(
          buildDeleteSnapshot(context.account, context.now, {
            resource_type: resourceType,
            resource_id: resourceId,
            occurred_at: context.now,
            source_event_type: normalizeString(job.payload.eventType),
            payload: coerceRecord(job.payload.webhookPayload),
          }),
        );
        return {};
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
