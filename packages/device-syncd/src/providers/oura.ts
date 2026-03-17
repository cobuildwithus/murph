import { deviceSyncError } from "../errors.js";
import {
  addMilliseconds,
  coerceRecord,
  computeRetryDelayMs,
  normalizeIdentifier,
  normalizeString,
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
  StoredDeviceSyncAccount,
} from "../types.js";

const OURA_AUTH_BASE_URL = "https://cloud.ouraring.com";
const OURA_API_BASE_URL = "https://api.ouraring.com";
const OURA_AUTHORIZE_PATH = "/oauth/authorize";
const OURA_TOKEN_PATH = "/oauth/token";
const OURA_CALLBACK_PATH = "/oauth/oura/callback";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BACKFILL_DAYS = 90;
const DEFAULT_RECONCILE_DAYS = 21;
const DEFAULT_RECONCILE_INTERVAL_MS = 6 * 60 * 60_000;
const OURA_DEFAULT_SCOPES = Object.freeze([
  "personal",
  "daily",
  "heartrate",
  "workout",
  "session",
  "spo2",
]);

interface OuraTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

interface OuraCollectionResponse<TRecord extends Record<string, unknown>> {
  data?: TRecord[];
  next_token?: string | null;
}

export interface OuraDeviceSyncProviderConfig {
  clientId: string;
  clientSecret: string;
  authBaseUrl?: string;
  apiBaseUrl?: string;
  scopes?: string[];
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function buildOuraScopes(input: string[] | undefined): string[] {
  const requested = [...OURA_DEFAULT_SCOPES, ...(input ?? [])];
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

  return value
    .split(/\s+/u)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function hasOuraScope(account: DeviceSyncAccount, scope: string): boolean {
  return account.scopes.includes(scope);
}

function isTokenNearExpiry(account: DeviceSyncAccount, skewMs = 60_000): boolean {
  if (!account.accessTokenExpiresAt) {
    return false;
  }

  return Date.parse(account.accessTokenExpiresAt) - Date.now() <= skewMs;
}

function toDateParameter(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildDisplayName(personalInfo: Record<string, unknown>): string {
  const email = normalizeString(personalInfo.email);
  const accountId = normalizeIdentifier(personalInfo.id ?? personalInfo.user_id ?? personalInfo.userId);
  return email ?? `Oura ${accountId ?? "user"}`;
}

function tokenResponseToAuthTokens(payload: OuraTokenResponse): ProviderAuthTokens {
  const accessToken = normalizeString(payload.access_token);

  if (!accessToken) {
    throw deviceSyncError({
      code: "OURA_TOKEN_RESPONSE_INVALID",
      message: "Oura token response did not include an access token.",
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

async function parseResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function buildOuraApiError(
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

export function createOuraDeviceSyncProvider(config: OuraDeviceSyncProviderConfig): DeviceSyncProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const authBaseUrl = (config.authBaseUrl ?? OURA_AUTH_BASE_URL).replace(/\/+$/u, "");
  const apiBaseUrl = (config.apiBaseUrl ?? OURA_API_BASE_URL).replace(/\/+$/u, "");
  const scopes = buildOuraScopes(config.scopes);
  const backfillDays = Math.max(1, config.backfillDays ?? DEFAULT_BACKFILL_DAYS);
  const reconcileDays = Math.max(1, config.reconcileDays ?? DEFAULT_RECONCILE_DAYS);
  const reconcileIntervalMs = Math.max(60_000, config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
  const timeoutMs = Math.max(1_000, config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);

  async function postTokenRequest(parameters: Record<string, string>): Promise<OuraTokenResponse> {
    const response = await fetchImpl(`${apiBaseUrl}${OURA_TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(parameters),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw buildOuraApiError(
        "OURA_TOKEN_REQUEST_FAILED",
        "Oura token request failed.",
        response,
        await parseResponseBody(response),
        {
          retryable: response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        },
      );
    }

    return (await response.json()) as OuraTokenResponse;
  }

  async function fetchOuraJson<T>(input: {
    path: string;
    accessToken: string;
    optional?: boolean;
  }): Promise<T | null> {
    const response = await fetchImpl(`${apiBaseUrl}${input.path}`, {
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
      throw buildOuraApiError(
        "OURA_API_REQUEST_FAILED",
        `Oura API request failed for ${input.path}.`,
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
    parameters: Record<string, string | null | undefined>,
  ): Promise<Record<string, unknown>[]> {
    const records: Record<string, unknown>[] = [];
    let nextToken: string | null | undefined = null;

    do {
      const search = new URLSearchParams();

      for (const [key, value] of Object.entries(parameters)) {
        const normalized = normalizeString(value);

        if (normalized) {
          search.set(key, normalized);
        }
      }

      if (nextToken) {
        search.set("next_token", nextToken);
      }

      const response =
        (await requestJson<OuraCollectionResponse<Record<string, unknown>>>(`${path}?${search.toString()}`)) ?? {
          data: [],
        };
      records.push(...((response.data ?? []).map((entry) => coerceRecord(entry))));
      nextToken = normalizeString(response.next_token) ?? null;
    } while (nextToken);

    return records;
  }

  async function fetchPersonalInfo(accessToken: string): Promise<Record<string, unknown>> {
    const personalInfo = await fetchOuraJson<Record<string, unknown>>({
      path: "/v2/usercollection/personal_info",
      accessToken,
      optional: false,
    });

    return coerceRecord(personalInfo);
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
          return await fetchOuraJson<T>({
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
      fetchPagedCollection(path: string, parameters: Record<string, string | null | undefined>) {
        return fetchPagedCollection(requestJson, path, parameters);
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
    const includePersonalInfo = payload.includePersonalInfo === true;
    const api = createApiSession(context);
    const snapshot: Record<string, unknown> = {
      accountId: api.account.externalAccountId,
      importedAt: now,
    };

    if (includePersonalInfo && hasOuraScope(api.account, "personal")) {
      snapshot.personalInfo = coerceRecord(
        await api.requestJson<Record<string, unknown>>("/v2/usercollection/personal_info"),
      );
    }

    if (hasOuraScope(api.account, "daily")) {
      snapshot.dailyActivity = await api.fetchPagedCollection("/v2/usercollection/daily_activity", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
      snapshot.dailySleep = await api.fetchPagedCollection("/v2/usercollection/daily_sleep", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
      snapshot.dailyReadiness = await api.fetchPagedCollection("/v2/usercollection/daily_readiness", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
      snapshot.sleeps = await api.fetchPagedCollection("/v2/usercollection/sleep", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    }

    if (hasOuraScope(api.account, "spo2")) {
      snapshot.dailySpO2 = await api.fetchPagedCollection("/v2/usercollection/daily_spo2", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    }

    if (hasOuraScope(api.account, "session")) {
      snapshot.sessions = await api.fetchPagedCollection("/v2/usercollection/session", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    }

    if (hasOuraScope(api.account, "workout")) {
      snapshot.workouts = await api.fetchPagedCollection("/v2/usercollection/workout", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    }

    if (hasOuraScope(api.account, "heartrate")) {
      snapshot.heartrate = await api.fetchPagedCollection("/v2/usercollection/heartrate", {
        start_datetime: windowStart,
        end_datetime: windowEnd,
      });
    }

    await context.importSnapshot(snapshot);

    return {
      metadataPatch:
        includePersonalInfo && snapshot.personalInfo
          ? {
              personalInfo: snapshot.personalInfo,
            }
          : undefined,
    };
  }

  const provider: DeviceSyncProvider = {
    provider: "oura",
    callbackPath: OURA_CALLBACK_PATH,
    defaultScopes: scopes,
    buildConnectUrl(context) {
      const search = new URLSearchParams({
        client_id: config.clientId,
        response_type: "code",
        redirect_uri: context.callbackUrl,
        scope: context.scopes.join(" "),
        state: context.state,
      });

      return `${authBaseUrl}${OURA_AUTHORIZE_PATH}?${search.toString()}`;
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
          code: "OURA_REFRESH_TOKEN_MISSING",
          message:
            "Oura did not return a refresh token. Use the server-side OAuth flow so the connection can auto-sync.",
          retryable: false,
          httpStatus: 502,
        });
      }

      const grantedScopesFromToken = splitScopes(tokenPayload.scope);
      const grantedScopes =
        grantedScopesFromToken.length > 0
          ? grantedScopesFromToken
          : context.grantedScopes.length > 0
            ? [...context.grantedScopes]
            : [...scopes];

      if (!grantedScopes.includes("personal")) {
        throw deviceSyncError({
          code: "OURA_PERSONAL_SCOPE_REQUIRED",
          message: "Oura connections require the personal scope so Healthy Bob can identify the account.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const personalInfo = await fetchPersonalInfo(tokens.accessToken);
      const externalAccountId = normalizeIdentifier(personalInfo.id ?? personalInfo.user_id ?? personalInfo.userId);

      if (!externalAccountId) {
        throw deviceSyncError({
          code: "OURA_PROFILE_INVALID",
          message: "Oura personal info response did not include a stable user identifier.",
          retryable: false,
          httpStatus: 502,
        });
      }

      return {
        externalAccountId,
        displayName: buildDisplayName(personalInfo),
        scopes: grantedScopes,
        metadata: {
          personalInfo,
        },
        tokens,
        initialJobs: [
          {
            kind: "backfill",
            priority: 100,
            payload: {
              windowStart: subtractDays(context.now, backfillDays),
              windowEnd: context.now,
              includePersonalInfo: true,
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
          code: "OURA_REFRESH_TOKEN_MISSING",
          message: "Oura account does not have a refresh token and must be reconnected.",
          retryable: false,
          accountStatus: "reauthorization_required",
        });
      }

      const tokenPayload = await postTokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      });
      const tokens = tokenResponseToAuthTokens(tokenPayload);

      if (!tokens.refreshToken) {
        throw deviceSyncError({
          code: "OURA_REFRESH_TOKEN_ROTATION_MISSING",
          message: "Oura refresh response did not include a replacement refresh token.",
          retryable: false,
          accountStatus: "reauthorization_required",
        });
      }

      return tokens;
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
              includePersonalInfo: false,
            },
          },
        ],
        nextReconcileAt: addMilliseconds(now, reconcileIntervalMs),
      };
    },
    async executeJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult> {
      if (job.kind === "backfill") {
        return executeWindowImport(context, job.payload, backfillDays);
      }

      if (job.kind === "reconcile") {
        return executeWindowImport(context, job.payload, reconcileDays);
      }

      throw deviceSyncError({
        code: "OURA_JOB_KIND_UNSUPPORTED",
        message: `Oura job kind ${job.kind} is not supported.`,
        retryable: false,
      });
    },
  };

  return provider;
}
