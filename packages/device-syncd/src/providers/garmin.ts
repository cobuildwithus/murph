import { createHash } from "node:crypto";

import {
  GARMIN_DEVICE_PROVIDER_DESCRIPTOR,
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError } from "../errors.ts";
import {
  addMilliseconds,
  coerceRecord,
  normalizeIdentifier,
  normalizeString,
  normalizeStringList,
  subtractDays,
} from "../shared.ts";
import {
  buildProviderApiError,
  buildScheduledReconcileJobs,
  createRefreshingApiSession,
  parseResponseBody,
  postOAuthTokenRequest,
  refreshOAuthTokens,
  splitScopes,
  tokenResponseToAuthTokens as sharedTokenResponseToAuthTokens,
} from "./shared-oauth.ts";

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
} from "../types.ts";

const DEFAULT_GARMIN_AUTH_BASE_URL = "https://connect.garmin.com";
const DEFAULT_GARMIN_TOKEN_BASE_URL = "https://connectapi.garmin.com";
const DEFAULT_GARMIN_API_BASE_URL = "https://apis.garmin.com";
const GARMIN_AUTHORIZE_PATH = "/oauth2Confirm";
const GARMIN_TOKEN_PATH = "/di-oauth2-service/oauth/token";
const GARMIN_API_PREFIX = "/wellness-api/rest";
const GARMIN_PROVIDER_DESCRIPTOR = GARMIN_DEVICE_PROVIDER_DESCRIPTOR;
const GARMIN_OAUTH = requireDeviceProviderOAuthDescriptor(GARMIN_PROVIDER_DESCRIPTOR);
const GARMIN_SYNC = requireDeviceProviderSyncDescriptor(GARMIN_PROVIDER_DESCRIPTOR);
const GARMIN_CALLBACK_PATH = GARMIN_OAUTH.callbackPath;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BACKFILL_DAYS = GARMIN_SYNC.windows.backfillDays;
const DEFAULT_RECONCILE_DAYS = GARMIN_SYNC.windows.reconcileDays;
const DEFAULT_RECONCILE_INTERVAL_MS = GARMIN_SYNC.windows.reconcileIntervalMs;

type GarminSnapshotKey =
  | "dailySummaries"
  | "epochSummaries"
  | "sleeps"
  | "activities"
  | "activityFiles"
  | "womenHealth";

export interface GarminDeviceSyncProviderConfig {
  clientId: string;
  clientSecret: string;
  authBaseUrl?: string;
  tokenBaseUrl?: string;
  apiBaseUrl?: string;
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface GarminTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
}

interface GarminWindow {
  windowStart: string;
  windowEnd: string;
}

interface GarminApiSession {
  readonly account: DeviceSyncAccount;
  requestJson<T>(path: string, options?: { optional?: boolean }): Promise<T | null>;
}

const GARMIN_SNAPSHOT_KEYS: readonly GarminSnapshotKey[] = Object.freeze([
  "dailySummaries",
  "epochSummaries",
  "sleeps",
  "activities",
  "activityFiles",
  "womenHealth",
]);

const GARMIN_COLLECTION_ENDPOINTS: Readonly<Record<GarminSnapshotKey, string>> = Object.freeze({
  dailySummaries: "/dailies",
  epochSummaries: "/epochs",
  sleeps: "/sleeps",
  activities: "/activities",
  activityFiles: "/activityDetails",
  womenHealth: "/mct",
});

const GARMIN_DATA_TYPE_ALIASES: Readonly<Record<string, GarminSnapshotKey>> = Object.freeze({
  activities: "activities",
  activitydetails: "activityFiles",
  activityfiles: "activityFiles",
  activitysummaries: "activities",
  dailies: "dailySummaries",
  dailysummaries: "dailySummaries",
  daysummary: "dailySummaries",
  daysummaries: "dailySummaries",
  epochs: "epochSummaries",
  epochsummaries: "epochSummaries",
  mct: "womenHealth",
  sleep: "sleeps",
  sleeps: "sleeps",
  womenhealth: "womenHealth",
  womenhealthsummaries: "womenHealth",
});

function garminAuthBaseUrl(config: GarminDeviceSyncProviderConfig): string {
  return (config.authBaseUrl ?? DEFAULT_GARMIN_AUTH_BASE_URL).replace(/\/+$/u, "");
}

function garminApiBaseUrl(config: GarminDeviceSyncProviderConfig): string {
  return (config.apiBaseUrl ?? DEFAULT_GARMIN_API_BASE_URL).replace(/\/+$/u, "");
}

function garminTokenBaseUrl(config: GarminDeviceSyncProviderConfig): string {
  return (config.tokenBaseUrl ?? DEFAULT_GARMIN_TOKEN_BASE_URL).replace(/\/+$/u, "");
}

function tokenResponseToAuthTokens(payload: GarminTokenResponse): ProviderAuthTokens {
  return sharedTokenResponseToAuthTokens(payload, () =>
    deviceSyncError({
      code: "GARMIN_TOKEN_RESPONSE_INVALID",
      message: "Garmin token response did not include an access token.",
      retryable: false,
      httpStatus: 502,
    }),
  );
}

function buildGarminApiError(
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

function buildGarminPkceVerifier(state: string, clientSecret: string): string {
  return createHash("sha256")
    .update(`garmin-pkce:${clientSecret}:${state}`)
    .digest("base64url");
}

function buildGarminPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function normalizeIsoTimestamp(value: unknown): string | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function toUnixSeconds(timestamp: string): string {
  return String(Math.floor(Date.parse(timestamp) / 1000));
}

function buildGarminApiPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${GARMIN_API_PREFIX}${normalized}`;
}

function extractGarminUserId(value: unknown): string | null {
  const direct = normalizeIdentifier(value);

  if (direct) {
    return direct;
  }

  const record = coerceRecord(value);
  return (
    normalizeIdentifier(record.userId)
    ?? normalizeIdentifier(record.user_id)
    ?? normalizeIdentifier(record.id)
    ?? normalizeIdentifier(record.accountId)
    ?? normalizeIdentifier(record.account_id)
    ?? normalizeIdentifier(record.externalAccountId)
    ?? normalizeIdentifier(record.external_account_id)
    ?? null
  );
}

function normalizeGarminPermissions(value: unknown): string[] {
  const fromScalarList = normalizeStringList(value);

  if (fromScalarList.length > 0) {
    return [...new Set(fromScalarList)];
  }

  if (Array.isArray(value)) {
    const permissions = value.flatMap((entry) => {
      const record = coerceRecord(entry);
      return [
        normalizeString(record.permission),
        normalizeString(record.name),
        normalizeString(record.scope),
      ].filter((candidate): candidate is string => Boolean(candidate));
    });

    if (permissions.length > 0) {
      return [...new Set(permissions)];
    }
  }

  const record = coerceRecord(value);
  const nestedList = [
    record.permissions,
    record.authorizedPermissions,
    record.grantedPermissions,
    record.scopes,
    record.scope,
  ].flatMap((candidate) => normalizeGarminPermissions(candidate));

  if (nestedList.length > 0) {
    return [...new Set(nestedList)];
  }

  const enabledFlags = Object.entries(record)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => key.trim())
    .filter(Boolean);

  return [...new Set(enabledFlags)];
}

function normalizeGarminDataType(value: unknown): GarminSnapshotKey | null {
  const normalized = normalizeString(value)?.replace(/[^a-z0-9]+/gu, "").toLowerCase() ?? null;

  if (!normalized) {
    return null;
  }

  return GARMIN_DATA_TYPE_ALIASES[normalized] ?? null;
}

function normalizeGarminRequestedSnapshotKeys(payload: Record<string, unknown>): GarminSnapshotKey[] {
  const explicitDataType = normalizeGarminDataType(payload.dataType ?? payload.data_type);
  const requested = [
    ...(explicitDataType ? [explicitDataType] : []),
    ...normalizeStringList(payload.dataTypes).map((entry) => normalizeGarminDataType(entry)).filter(
      (entry): entry is GarminSnapshotKey => entry !== null,
    ),
  ];

  return [...new Set(requested)];
}

function resolveGarminWindow(
  payload: Record<string, unknown>,
  now: string,
  fallbackWindowDays: number,
): GarminWindow {
  const windowStart = normalizeIsoTimestamp(payload.windowStart) ?? subtractDays(now, fallbackWindowDays);
  const windowEnd = normalizeIsoTimestamp(payload.windowEnd) ?? now;

  return Date.parse(windowStart) <= Date.parse(windowEnd)
    ? { windowStart, windowEnd }
    : { windowStart: windowEnd, windowEnd: windowStart };
}

function coerceGarminCollectionRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((entry) => coerceRecord(entry)).filter((entry) => Object.keys(entry).length > 0);
  }

  const record = coerceRecord(value);

  for (const key of [
    "records",
    "items",
    "data",
    "results",
    "activities",
    "activityDetails",
    "dailies",
    "dailySummaries",
    "dailySummary",
    "epochs",
    "epochSummaries",
    "sleeps",
    "womenHealth",
    "womenHealthSummaries",
  ]) {
    const nested = record[key];

    if (Array.isArray(nested)) {
      return nested.map((entry) => coerceRecord(entry)).filter((entry) => Object.keys(entry).length > 0);
    }
  }

  const firstArray = Object.values(record).find(Array.isArray);

  if (Array.isArray(firstArray)) {
    return firstArray.map((entry) => coerceRecord(entry)).filter((entry) => Object.keys(entry).length > 0);
  }

  return Object.keys(record).length > 0 ? [record] : [];
}

function createGarminApiSession(input: {
  context: Pick<ProviderJobContext, "account" | "refreshAccountTokens">;
  requestJsonWithAccessToken: <T>(
    accessToken: string,
    path: string,
    options: { optional?: boolean },
  ) => Promise<T | null>;
}): GarminApiSession {
  return createRefreshingApiSession({
    context: input.context,
    requestJsonWithAccessToken: input.requestJsonWithAccessToken,
  });
}

export function createGarminDeviceSyncProvider(config: GarminDeviceSyncProviderConfig): DeviceSyncProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const authBaseUrl = garminAuthBaseUrl(config);
  const apiBaseUrl = garminApiBaseUrl(config);
  const tokenBaseUrl = garminTokenBaseUrl(config);
  const backfillDays = Math.max(1, config.backfillDays ?? DEFAULT_BACKFILL_DAYS);
  const reconcileDays = Math.max(1, config.reconcileDays ?? DEFAULT_RECONCILE_DAYS);
  const reconcileIntervalMs = Math.max(60_000, config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
  const timeoutMs = Math.max(1_000, config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const descriptor = {
    ...GARMIN_PROVIDER_DESCRIPTOR,
    oauth: {
      ...GARMIN_OAUTH,
      defaultScopes: [...GARMIN_OAUTH.defaultScopes],
    },
    sync: {
      ...GARMIN_SYNC,
      windows: {
        backfillDays,
        reconcileDays,
        reconcileIntervalMs,
      },
    },
  };

  async function postTokenRequest(parameters: Record<string, string>): Promise<GarminTokenResponse> {
    return postOAuthTokenRequest<GarminTokenResponse>({
      fetchImpl,
      url: `${tokenBaseUrl}${GARMIN_TOKEN_PATH}`,
      timeoutMs,
      parameters,
      buildError: (response, body) =>
        buildGarminApiError("GARMIN_TOKEN_REQUEST_FAILED", "Garmin token request failed.", response, body, {
          retryable: response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        }),
    });
  }

  async function fetchGarminJson<T>(input: {
    path: string;
    accessToken: string;
    optional?: boolean;
  }): Promise<T | null> {
    const response = await fetchImpl(`${apiBaseUrl}${buildGarminApiPath(input.path)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 404 && input.optional) {
      return null;
    }

    if (!response.ok) {
      throw buildGarminApiError(
        "GARMIN_API_REQUEST_FAILED",
        `Garmin API request failed for ${input.path}.`,
        response,
        await parseResponseBody(response),
        {
          retryable: response.status === 429 || response.status >= 500,
          accountStatus: response.status === 401 ? "reauthorization_required" : null,
        },
      );
    }

    const body = await response.text();

    if (!body.trim()) {
      return null;
    }

    try {
      return JSON.parse(body) as T;
    } catch (error) {
      throw deviceSyncError({
        code: "GARMIN_API_RESPONSE_INVALID",
        message: `Garmin API response for ${input.path} was not valid JSON.`,
        retryable: false,
        httpStatus: 502,
        cause: error,
      });
    }
  }

  async function fetchGarminUserId(accessToken: string): Promise<string> {
    const response = await fetchGarminJson<unknown>({
      path: "/user/id",
      accessToken,
    });
    const externalAccountId = extractGarminUserId(response);

    if (!externalAccountId) {
      throw deviceSyncError({
        code: "GARMIN_PROFILE_INVALID",
        message: "Garmin user id response did not include a stable user identifier.",
        retryable: false,
        httpStatus: 502,
      });
    }

    return externalAccountId;
  }

  async function fetchGarminPermissions(accessToken: string): Promise<string[]> {
    try {
      const response = await fetchGarminJson<unknown>({
        path: "/user/permissions",
        accessToken,
        optional: true,
      });

      return normalizeGarminPermissions(response);
    } catch (error) {
      const httpStatus =
        typeof error === "object" && error !== null && "httpStatus" in error
          ? Number((error as { httpStatus?: number }).httpStatus)
          : null;

      if (httpStatus === 403 || httpStatus === 404) {
        return [];
      }

      throw error;
    }
  }

  async function fetchGarminCollection(
    api: GarminApiSession,
    snapshotKey: GarminSnapshotKey,
    window: GarminWindow,
  ): Promise<Record<string, unknown>[]> {
    const search = new URLSearchParams({
      uploadEndTimeInSeconds: toUnixSeconds(window.windowEnd),
      uploadStartTimeInSeconds: toUnixSeconds(window.windowStart),
    });

    try {
      const response = await api.requestJson<unknown>(
        `${GARMIN_COLLECTION_ENDPOINTS[snapshotKey]}?${search.toString()}`,
        { optional: true },
      );

      return coerceGarminCollectionRecords(response);
    } catch (error) {
      const httpStatus =
        typeof error === "object" && error !== null && "httpStatus" in error
          ? Number((error as { httpStatus?: number }).httpStatus)
          : null;

      if (httpStatus === 403 || httpStatus === 404) {
        return [];
      }

      throw error;
    }
  }

  async function populateGarminSnapshotCollections(
    api: GarminApiSession,
    snapshot: Record<string, unknown>,
    window: GarminWindow,
    requestedSnapshotKeys: readonly GarminSnapshotKey[],
  ): Promise<void> {
    const snapshotKeys = requestedSnapshotKeys.length > 0 ? requestedSnapshotKeys : GARMIN_SNAPSHOT_KEYS;

    for (const snapshotKey of snapshotKeys) {
      snapshot[snapshotKey] = await fetchGarminCollection(api, snapshotKey, window);
    }
  }

  async function executeWindowImport(
    context: ProviderJobContext,
    payload: Record<string, unknown>,
    fallbackWindowDays: number,
  ): Promise<ProviderJobResult> {
    const window = resolveGarminWindow(payload, context.now, fallbackWindowDays);
    const requestedSnapshotKeys = normalizeGarminRequestedSnapshotKeys(payload);
    const includeProfile = payload.includeProfile === true;
    const api = createGarminApiSession({
      context,
      requestJsonWithAccessToken: <T>(accessToken: string, path: string, options: { optional?: boolean }) =>
        fetchGarminJson<T>({
          path,
          accessToken,
          optional: options.optional,
        }),
    });
    const snapshot: Record<string, unknown> = {
      accountId: api.account.externalAccountId,
      importedAt: context.now,
    };

    if (includeProfile) {
      snapshot.profile = {
        id: api.account.externalAccountId,
        permissions: api.account.scopes,
      };
    }

    await populateGarminSnapshotCollections(api, snapshot, window, requestedSnapshotKeys);

    const hasCollections = requestedSnapshotKeys.length > 0
      ? requestedSnapshotKeys.some((snapshotKey) => Array.isArray(snapshot[snapshotKey]) && (snapshot[snapshotKey] as unknown[]).length > 0)
      : GARMIN_SNAPSHOT_KEYS.some((snapshotKey) => Array.isArray(snapshot[snapshotKey]) && (snapshot[snapshotKey] as unknown[]).length > 0);

    if (includeProfile || hasCollections) {
      await context.importSnapshot(snapshot);
    }

    return {};
  }

  return {
    provider: descriptor.provider,
    descriptor,
    buildConnectUrl(context) {
      const verifier = buildGarminPkceVerifier(context.state, config.clientSecret);
      const search = new URLSearchParams({
        client_id: config.clientId,
        code_challenge: buildGarminPkceChallenge(verifier),
        code_challenge_method: "S256",
        redirect_uri: context.callbackUrl,
        response_type: "code",
        state: context.state,
      });

      return `${authBaseUrl}${GARMIN_AUTHORIZE_PATH}?${search.toString()}`;
    },
    async exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult> {
      const tokenPayload = await postTokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: buildGarminPkceVerifier(context.state, config.clientSecret),
        grant_type: "authorization_code",
        redirect_uri: context.callbackUrl,
      });
      const tokens = tokenResponseToAuthTokens(tokenPayload);

      if (!tokens.refreshToken) {
        throw deviceSyncError({
          code: "GARMIN_REFRESH_TOKEN_MISSING",
          message: "Garmin token response did not include a refresh token.",
          retryable: false,
          accountStatus: "reauthorization_required",
        });
      }

      const externalAccountId = await fetchGarminUserId(tokens.accessToken);
      const permissionScopes = await fetchGarminPermissions(tokens.accessToken);
      const tokenScopes = splitScopes(tokenPayload.scope);
      const scopes = permissionScopes.length > 0 ? permissionScopes : tokenScopes;

      return {
        externalAccountId,
        displayName: `Garmin ${externalAccountId}`,
        scopes,
        metadata: {
          syncMode: "polling",
        },
        tokens,
        initialJobs: [
          {
            kind: "backfill",
            priority: 100,
            payload: {
              includeProfile: true,
              windowEnd: context.now,
              windowStart: subtractDays(context.now, backfillDays),
            },
          },
        ],
        nextReconcileAt: addMilliseconds(context.now, reconcileIntervalMs),
      };
    },
    async refreshTokens(account: DeviceSyncAccount): Promise<ProviderAuthTokens> {
      return refreshOAuthTokens({
        postTokenRequest,
        account,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenResponseToAuthTokens,
        buildMissingRefreshTokenError: () =>
          deviceSyncError({
            code: "GARMIN_REFRESH_TOKEN_MISSING",
            message: "Garmin account does not have a refresh token and must be reconnected.",
            retryable: false,
            accountStatus: "reauthorization_required",
          }),
        resolveRefreshToken: ({ currentRefreshToken, responseRefreshToken }) => responseRefreshToken ?? currentRefreshToken,
      });
    },
    async revokeAccess(account: DeviceSyncAccount): Promise<void> {
      const response = await fetchImpl(`${apiBaseUrl}${buildGarminApiPath("/user/registration")}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 401 || response.status === 404 || response.status === 204) {
        return;
      }

      if (!response.ok) {
        throw buildGarminApiError(
          "GARMIN_REVOKE_FAILED",
          "Garmin revoke access request failed.",
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
        payload: {},
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
        code: "GARMIN_JOB_KIND_UNSUPPORTED",
        message: `Garmin job kind ${job.kind} is not supported.`,
        retryable: false,
      });
    },
  };
}
