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
  postOAuthTokenRequest,
  splitScopes,
  tokenResponseToAuthTokens as sharedTokenResponseToAuthTokens,
} from "./shared-oauth.js";

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

function hasOuraScope(account: DeviceSyncAccount, scope: string): boolean {
  return account.scopes.includes(scope);
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
  return sharedTokenResponseToAuthTokens(payload, () =>
    deviceSyncError({
      code: "OURA_TOKEN_RESPONSE_INVALID",
      message: "Oura token response did not include an access token.",
      retryable: false,
      httpStatus: 502,
    }),
  );
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
  return buildProviderApiError(code, message, response, body, options);
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
    return postOAuthTokenRequest<OuraTokenResponse>({
      fetchImpl,
      url: `${apiBaseUrl}${OURA_TOKEN_PATH}`,
      timeoutMs,
      parameters,
      buildError: (response, body) =>
        buildOuraApiError("OURA_TOKEN_REQUEST_FAILED", "Oura token request failed.", response, body, {
          retryable: response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        }),
    });
  }

  async function fetchOuraJson<T>(input: {
    path: string;
    accessToken: string;
    optional?: boolean;
  }): Promise<T | null> {
    return fetchBearerJson<T>({
      fetchImpl,
      url: `${apiBaseUrl}${input.path}`,
      accessToken: input.accessToken,
      timeoutMs,
      optional: input.optional,
      buildError: (response, body) =>
        buildOuraApiError("OURA_API_REQUEST_FAILED", `Oura API request failed for ${input.path}.`, response, body, {
          retryable: response.status === 429 || response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        }),
    });
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
    const session = createRefreshingApiSession({
      context,
      requestJsonWithAccessToken: <T>(accessToken: string, path: string, options: { optional?: boolean }) =>
        fetchOuraJson<T>({
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
      fetchPagedCollection(path: string, parameters: Record<string, string | null | undefined>) {
        return fetchPagedCollection(session.requestJson, path, parameters);
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
      return buildOAuthConnectUrl({
        baseUrl: authBaseUrl,
        authorizePath: OURA_AUTHORIZE_PATH,
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
      return buildScheduledReconcileJobs({
        accountId: account.id,
        nextReconcileAt: account.nextReconcileAt,
        now,
        reconcileDays,
        reconcileIntervalMs,
        payload: {
          includePersonalInfo: false,
        },
      });
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
