import { createHmac, timingSafeEqual } from "node:crypto";

import { deviceSyncError } from "../errors.ts";
import {
  addMilliseconds,
  coerceRecord,
  normalizeIdentifier,
  normalizeString,
  sha256Text,
  subtractDays,
} from "../shared.ts";
import {
  buildOAuthConnectUrl,
  buildProviderApiError,
  buildScheduledReconcileJobs,
  createRefreshingApiSession,
  exchangeOAuthAuthorizationCode,
  fetchBearerJson,
  postOAuthTokenRequest,
  refreshOAuthTokens,
  requireRefreshToken,
  splitScopes,
  tokenResponseToAuthTokens as sharedTokenResponseToAuthTokens,
} from "./shared-oauth.ts";
import { createOuraWebhookSubscriptionClient, OURA_DEFAULT_WEBHOOK_TARGETS } from "./oura-webhooks.ts";

import type {
  DeviceSyncAccount,
  DeviceSyncJobRecord,
  DeviceSyncProvider,
  ProviderWebhookAdminCapability,
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
import type { OuraWebhookSubscriptionClient } from "./oura-webhooks.ts";

const OURA_AUTH_BASE_URL = "https://cloud.ouraring.com";
const OURA_API_BASE_URL = "https://api.ouraring.com";
const OURA_AUTHORIZE_PATH = "/oauth/authorize";
const OURA_TOKEN_PATH = "/oauth/token";
const OURA_CALLBACK_PATH = "/oauth/oura/callback";
const OURA_WEBHOOK_PATH = "/webhooks/oura";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BACKFILL_DAYS = 90;
const DEFAULT_RECONCILE_DAYS = 21;
const DEFAULT_RECONCILE_INTERVAL_MS = 6 * 60 * 60_000;
const DEFAULT_WEBHOOK_TOLERANCE_MS = 5 * 60_000;
const OURA_SECONDS_TIMESTAMP_THRESHOLD = 10_000_000_000;
const OURA_WEBHOOK_RESOURCE_PRIORITY = 90;
const OURA_WEBHOOK_DELETE_PRIORITY = 95;
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

type OuraScope = "daily" | "spo2" | "session" | "workout" | "heartrate";
type OuraWebhookOperation = "create" | "update" | "delete";
type OuraWebhookDataType =
  | "daily_activity"
  | "daily_readiness"
  | "daily_sleep"
  | "daily_spo2"
  | "heartrate"
  | "session"
  | "sleep"
  | "workout";

interface OuraDeleteMarker {
  resource_type: string;
  resource_id: string;
  occurred_at: string;
  source_event_type?: string;
  payload?: Record<string, unknown>;
}

interface OuraApiSession {
  account: DeviceSyncAccount;
  requestJson<T>(path: string, options?: { optional?: boolean }): Promise<T | null>;
  fetchPagedCollection(
    path: string,
    parameters: Record<string, string | null | undefined>,
  ): Promise<Record<string, unknown>[]>;
}

interface OuraResourceDescriptor {
  scope: OuraScope;
  snapshotKey:
    | "dailyActivity"
    | "dailySleep"
    | "dailyReadiness"
    | "dailySpO2"
    | "sleeps"
    | "sessions"
    | "workouts"
    | "heartrate";
  matchFields: readonly string[];
  narrowWindowDaysBefore: number;
  narrowWindowDaysAfter: number;
  fetch(api: OuraApiSession, windowStart: string, windowEnd: string): Promise<Record<string, unknown>[]>;
}

const HEARTRATE_CHUNK_MS = 30 * 24 * 60 * 60_000;

async function fetchOuraHeartRateInChunks(
  api: OuraApiSession,
  windowStart: string,
  windowEnd: string,
): Promise<Record<string, unknown>[]> {
  const resolvedWindowStart = toDateTimeParameter(windowStart);
  const resolvedWindowEnd = toDateTimeParameter(windowEnd);
  const records: Record<string, unknown>[] = [];
  let chunkStart = Date.parse(resolvedWindowStart);
  const end = Date.parse(resolvedWindowEnd);

  while (chunkStart < end) {
    const chunkEnd = Math.min(chunkStart + HEARTRATE_CHUNK_MS, end);
    const chunk = await api.fetchPagedCollection("/v2/usercollection/heartrate", {
      start_datetime: new Date(chunkStart).toISOString(),
      end_datetime: new Date(chunkEnd).toISOString(),
    });
    records.push(...chunk);
    chunkStart = chunkEnd;
  }

  return records;
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
  webhookTimestampToleranceMs?: number;
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

function toDateTimeParameter(timestamp: string): string {
  return new Date(timestamp).toISOString();
}

function normalizeGrantedScopes(value: unknown): string[] {
  return [...new Set(splitScopes(value).map((scope) => scope.replace(/^extapi:/u, "")))];
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

function buildOuraSignatureCandidates(timestamp: string, rawBody: Buffer, secret: string): string[] {
  const signatureBase = `${timestamp}${rawBody.toString("utf8")}`;
  const digest = createHmac("sha256", secret).update(signatureBase).digest();
  const hex = digest.toString("hex");
  return [hex, hex.toUpperCase(), digest.toString("base64"), digest.toString("base64url")];
}

function constantTimeMatchSignature(expectedCandidates: readonly string[], actual: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");

  for (const expected of expectedCandidates) {
    const expectedBuffer = Buffer.from(expected, "utf8");

    if (expectedBuffer.length !== actualBuffer.length) {
      continue;
    }

    if (timingSafeEqual(expectedBuffer, actualBuffer)) {
      return true;
    }
  }

  return false;
}

function parseOuraWebhookPayload(rawBody: Buffer): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    throw deviceSyncError({
      code: "OURA_WEBHOOK_INVALID_JSON",
      message: "Oura webhook payload was not valid JSON.",
      retryable: false,
      httpStatus: 400,
      cause: error,
    });
  }

  return coerceRecord(parsed);
}

function parseTimestampMillis(value: string | null): number | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);

  if (Number.isFinite(numeric)) {
    return numeric < OURA_SECONDS_TIMESTAMP_THRESHOLD ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function startOfUtcDay(timestamp: string): string {
  const date = new Date(timestamp);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function endOfUtcDay(timestamp: string): string {
  return addMilliseconds(startOfUtcDay(timestamp), 24 * 60 * 60_000 - 1);
}

function buildOuraWebhookWindow(
  occurredAt: string,
  descriptor: Pick<OuraResourceDescriptor, "narrowWindowDaysBefore" | "narrowWindowDaysAfter">,
): { windowStart: string; windowEnd: string } {
  const dayStart = startOfUtcDay(occurredAt);
  const dayEnd = endOfUtcDay(occurredAt);

  return {
    windowStart:
      descriptor.narrowWindowDaysBefore > 0
        ? subtractDays(dayStart, descriptor.narrowWindowDaysBefore)
        : dayStart,
    windowEnd:
      descriptor.narrowWindowDaysAfter > 0
        ? addMilliseconds(dayEnd, descriptor.narrowWindowDaysAfter * 24 * 60 * 60_000)
        : dayEnd,
  };
}

function pickOuraRecordCandidates(record: Record<string, unknown>, fields: readonly string[]): string[] {
  const candidates = new Set<string>();

  for (const field of fields) {
    const value = normalizeString(record[field]);

    if (value) {
      candidates.add(value);
    }
  }

  return [...candidates];
}

function filterOuraResourceRecords(
  records: readonly Record<string, unknown>[],
  descriptor: OuraResourceDescriptor,
  objectId: string | null,
): Record<string, unknown>[] {
  if (!objectId) {
    return [...records];
  }

  return records.filter((record) => pickOuraRecordCandidates(record, descriptor.matchFields).includes(objectId));
}

async function populateOuraSnapshotCollections(
  api: OuraApiSession,
  snapshot: Record<string, unknown>,
  windowStart: string,
  windowEnd: string,
  dataTypes?: readonly OuraWebhookDataType[],
): Promise<void> {
  const descriptors = dataTypes
    ? dataTypes
        .map((dataType) => OURA_RESOURCE_DESCRIPTORS[dataType])
        .filter((descriptor): descriptor is OuraResourceDescriptor => Boolean(descriptor))
    : Object.values(OURA_RESOURCE_DESCRIPTORS);

  for (const descriptor of descriptors) {
    if (!hasOuraScope(api.account, descriptor.scope)) {
      continue;
    }

    snapshot[descriptor.snapshotKey] = await descriptor.fetch(api, windowStart, windowEnd);
  }
}

function normalizeOuraWebhookOperation(value: string | null): OuraWebhookOperation | null {
  const normalized = normalizeString(value)?.toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "create" || normalized === "created") {
    return "create";
  }

  if (normalized === "update" || normalized === "updated") {
    return "update";
  }

  if (normalized === "delete" || normalized === "deleted") {
    return "delete";
  }

  const suffix = normalized.split(".").at(-1);
  return suffix ? normalizeOuraWebhookOperation(suffix) : null;
}

function buildOuraSourceEventType(
  rawEventType: string | null,
  dataType: string,
  operation: OuraWebhookOperation | null,
): string {
  const normalized = normalizeString(rawEventType);

  if (normalized?.includes(".")) {
    return normalized;
  }

  if (!operation) {
    return normalized ?? dataType;
  }

  const suffix =
    operation === "create" ? "created" : operation === "update" ? "updated" : "deleted";

  return `${dataType}.${suffix}`;
}

function buildOuraDeleteSnapshot(
  account: DeviceSyncAccount,
  now: string,
  marker: OuraDeleteMarker,
): Record<string, unknown> {
  return {
    accountId: account.externalAccountId,
    importedAt: now,
    deletions: [marker],
  };
}

const OURA_RESOURCE_DESCRIPTORS: Readonly<Record<OuraWebhookDataType, OuraResourceDescriptor>> = Object.freeze({
  daily_activity: {
    scope: "daily",
    snapshotKey: "dailyActivity",
    matchFields: ["id", "day", "date"],
    narrowWindowDaysBefore: 0,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return api.fetchPagedCollection("/v2/usercollection/daily_activity", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    },
  },
  daily_readiness: {
    scope: "daily",
    snapshotKey: "dailyReadiness",
    matchFields: ["id", "day", "date"],
    narrowWindowDaysBefore: 0,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return api.fetchPagedCollection("/v2/usercollection/daily_readiness", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    },
  },
  daily_sleep: {
    scope: "daily",
    snapshotKey: "dailySleep",
    matchFields: ["id", "day", "date"],
    narrowWindowDaysBefore: 1,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return api.fetchPagedCollection("/v2/usercollection/daily_sleep", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    },
  },
  daily_spo2: {
    scope: "spo2",
    snapshotKey: "dailySpO2",
    matchFields: ["id", "day", "date"],
    narrowWindowDaysBefore: 0,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return api.fetchPagedCollection("/v2/usercollection/daily_spo2", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    },
  },
  heartrate: {
    scope: "heartrate",
    snapshotKey: "heartrate",
    matchFields: ["id", "timestamp", "recorded_at", "recordedAt"],
    narrowWindowDaysBefore: 0,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return fetchOuraHeartRateInChunks(api, windowStart, windowEnd);
    },
  },
  session: {
    scope: "session",
    snapshotKey: "sessions",
    matchFields: ["id", "day", "date", "start_datetime", "start_time", "start"],
    narrowWindowDaysBefore: 0,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return api.fetchPagedCollection("/v2/usercollection/session", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    },
  },
  sleep: {
    scope: "daily",
    snapshotKey: "sleeps",
    matchFields: ["id", "day", "date", "sleep_date", "start_datetime", "bedtime_start"],
    narrowWindowDaysBefore: 1,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return api.fetchPagedCollection("/v2/usercollection/sleep", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    },
  },
  workout: {
    scope: "workout",
    snapshotKey: "workouts",
    matchFields: ["id", "day", "date", "start_datetime", "start_time", "start"],
    narrowWindowDaysBefore: 0,
    narrowWindowDaysAfter: 0,
    fetch(api, windowStart, windowEnd) {
      return api.fetchPagedCollection("/v2/usercollection/workout", {
        start_date: toDateParameter(windowStart),
        end_date: toDateParameter(windowEnd),
      });
    },
  },
});

export function resolveOuraWebhookVerificationChallenge(input: {
  url: URL;
  verificationToken: string | null | undefined;
}): string | null {
  const challenge = normalizeString(input.url.searchParams.get("challenge"));
  const receivedToken = normalizeString(input.url.searchParams.get("verification_token"));
  const expectedToken = normalizeString(input.verificationToken);

  if (!challenge && !receivedToken) {
    return null;
  }

  if (!expectedToken) {
    throw deviceSyncError({
      code: "OURA_WEBHOOK_VERIFICATION_TOKEN_MISSING",
      message: "Oura webhook verification requires OURA_WEBHOOK_VERIFICATION_TOKEN.",
      retryable: false,
      httpStatus: 500,
    });
  }

  if (!challenge || !receivedToken || receivedToken !== expectedToken) {
    throw deviceSyncError({
      code: "OURA_WEBHOOK_VERIFICATION_FAILED",
      message: "Oura webhook verification token did not match the configured verification token.",
      retryable: false,
      httpStatus: 403,
    });
  }

  return challenge;
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
  const webhookTimestampToleranceMs = Math.max(1_000, config.webhookTimestampToleranceMs ?? DEFAULT_WEBHOOK_TOLERANCE_MS);
  let webhookSubscriptionClient: OuraWebhookSubscriptionClient | null = null;

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

  function getWebhookSubscriptionClient(): OuraWebhookSubscriptionClient {
    if (!webhookSubscriptionClient) {
      webhookSubscriptionClient = createOuraWebhookSubscriptionClient({
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
    resolveVerificationChallenge(context) {
      return resolveOuraWebhookVerificationChallenge(context);
    },
    async ensureSubscriptions(context) {
      const verificationToken = normalizeString(context.verificationToken);

      if (!verificationToken) {
        return;
      }

      const callbackUrl = new URL(OURA_WEBHOOK_PATH.replace(/^\/+/u, ""), `${context.publicBaseUrl}/`).toString();
      await getWebhookSubscriptionClient().ensure({
        callbackUrl,
        verificationToken,
        desired: OURA_DEFAULT_WEBHOOK_TARGETS,
        renewIfExpiringWithinMs: 7 * 24 * 60 * 60_000,
        pruneDuplicates: true,
      });
    },
  };

  function createApiSession(context: ProviderJobContext): OuraApiSession {
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

    await populateOuraSnapshotCollections(api, snapshot, windowStart, windowEnd);

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

  async function fetchOuraResourceSnapshot(
    api: OuraApiSession,
    input: {
      dataType: string | null;
      objectId: string | null;
      occurredAt: string;
      now: string;
    },
  ): Promise<Record<string, unknown> | null> {
    if (!input.dataType) {
      return null;
    }

    const descriptor = OURA_RESOURCE_DESCRIPTORS[input.dataType as OuraWebhookDataType];

    if (!descriptor || !hasOuraScope(api.account, descriptor.scope)) {
      return null;
    }

    const narrowWindow = buildOuraWebhookWindow(input.occurredAt, descriptor);
    const narrowRecords = await descriptor.fetch(api, narrowWindow.windowStart, narrowWindow.windowEnd);
    const filteredNarrowRecords = filterOuraResourceRecords(narrowRecords, descriptor, input.objectId);

    if (filteredNarrowRecords.length > 0 || !input.objectId) {
      return {
        accountId: api.account.externalAccountId,
        importedAt: input.now,
        [descriptor.snapshotKey]: filteredNarrowRecords,
      };
    }

    const broaderRecords = await descriptor.fetch(api, subtractDays(input.now, reconcileDays), input.now);
    const filteredBroaderRecords = filterOuraResourceRecords(broaderRecords, descriptor, input.objectId);

    return {
      accountId: api.account.externalAccountId,
      importedAt: input.now,
      [descriptor.snapshotKey]: filteredBroaderRecords,
    };
  }

  async function executeOuraResourceJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
  ): Promise<ProviderJobResult> {
    const dataType = normalizeString(job.payload.dataType) ?? null;
    const objectId = normalizeIdentifier(job.payload.objectId) ?? null;
    const occurredAt = normalizeIsoTimestamp(job.payload.occurredAt) ?? context.now;
    const api = createApiSession(context);
    const snapshot = await fetchOuraResourceSnapshot(api, {
      dataType,
      objectId,
      occurredAt,
      now: context.now,
    });

    if (!snapshot) {
      return executeWindowImport(context, job.payload, reconcileDays);
    }

    await context.importSnapshot(snapshot);
    return {};
  }

  async function executeOuraDeleteJob(
    context: ProviderJobContext,
    job: DeviceSyncJobRecord,
  ): Promise<ProviderJobResult> {
    const dataType = normalizeString(job.payload.dataType);
    const objectId = normalizeIdentifier(job.payload.objectId);
    const occurredAt = normalizeIsoTimestamp(job.payload.occurredAt) ?? context.now;
    const sourceEventType = normalizeString(job.payload.sourceEventType) ?? undefined;
    const webhookPayload = coerceRecord(job.payload.webhookPayload);

    if (!dataType || !objectId) {
      throw deviceSyncError({
        code: "OURA_DELETE_JOB_INVALID",
        message: "Oura delete job did not include a dataType and objectId.",
        retryable: false,
      });
    }

    await context.importSnapshot(
      buildOuraDeleteSnapshot(context.account, context.now, {
        resource_type: dataType,
        resource_id: objectId,
        occurred_at: occurredAt,
        source_event_type: sourceEventType,
        payload: webhookPayload,
      }),
    );

    return {};
  }

  const provider: DeviceSyncProvider = {
    provider: "oura",
    callbackPath: OURA_CALLBACK_PATH,
    webhookAdmin,
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
      const { tokenPayload, tokens } = await exchangeOAuthAuthorizationCode({
        postTokenRequest,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        callbackUrl: context.callbackUrl,
        code,
        tokenResponseToAuthTokens,
        buildMissingRefreshTokenError: () =>
          deviceSyncError({
            code: "OURA_REFRESH_TOKEN_MISSING",
            message:
              "Oura did not return a refresh token. Use the server-side OAuth flow so the connection can auto-sync.",
            retryable: false,
            httpStatus: 502,
          }),
      });

      const grantedScopesFromToken = normalizeGrantedScopes(tokenPayload.scope);
      const grantedScopes =
        grantedScopesFromToken.length > 0
          ? grantedScopesFromToken
          : context.grantedScopes.length > 0
            ? [...context.grantedScopes]
            : [...scopes];

      if (!grantedScopes.includes("personal")) {
        throw deviceSyncError({
          code: "OURA_PERSONAL_SCOPE_REQUIRED",
          message: "Oura connections require the personal scope so Murph can identify the account.",
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
      return refreshOAuthTokens({
        postTokenRequest,
        account,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tokenResponseToAuthTokens,
        buildMissingRefreshTokenError: () =>
          deviceSyncError({
            code: "OURA_REFRESH_TOKEN_MISSING",
            message: "Oura account does not have a refresh token and must be reconnected.",
            retryable: false,
            accountStatus: "reauthorization_required",
          }),
        resolveRefreshToken: ({ responseRefreshToken }) =>
          requireRefreshToken(responseRefreshToken, () =>
            deviceSyncError({
              code: "OURA_REFRESH_TOKEN_ROTATION_MISSING",
              message: "Oura refresh response did not include a replacement refresh token.",
              retryable: false,
              accountStatus: "reauthorization_required",
            }),
          ),
      });
    },
    webhookPath: OURA_WEBHOOK_PATH,
    async verifyAndParseWebhook(context: ProviderWebhookContext): Promise<ProviderWebhookResult> {
      const signature = normalizeString(context.headers.get("x-oura-signature"));
      const timestamp = normalizeString(context.headers.get("x-oura-timestamp"));

      if (!signature || !timestamp) {
        throw deviceSyncError({
          code: "OURA_WEBHOOK_SIGNATURE_MISSING",
          message: "Oura webhook is missing required signature headers.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const timestampMs = parseTimestampMillis(timestamp);

      if (timestampMs === null) {
        throw deviceSyncError({
          code: "OURA_WEBHOOK_TIMESTAMP_INVALID",
          message: "Oura webhook timestamp header was invalid.",
          retryable: false,
          httpStatus: 400,
        });
      }

      if (Math.abs(Date.parse(context.now) - timestampMs) > webhookTimestampToleranceMs) {
        throw deviceSyncError({
          code: "OURA_WEBHOOK_TIMESTAMP_INVALID",
          message: "Oura webhook timestamp is outside the allowed tolerance window.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const expectedSignatures = buildOuraSignatureCandidates(timestamp, context.rawBody, config.clientSecret);

      if (!constantTimeMatchSignature(expectedSignatures, signature)) {
        throw deviceSyncError({
          code: "OURA_WEBHOOK_SIGNATURE_INVALID",
          message: "Oura webhook signature verification failed.",
          retryable: false,
          httpStatus: 401,
        });
      }

      const payload = parseOuraWebhookPayload(context.rawBody);
      const externalAccountId = normalizeIdentifier(payload.user_id ?? payload.userId);
      const rawEventType = normalizeString(payload.event_type ?? payload.eventType) ?? null;
      const dataType = normalizeString(payload.data_type ?? payload.dataType) ?? null;
      const objectId = normalizeIdentifier(payload.object_id ?? payload.objectId ?? payload.id);
      const operation = normalizeOuraWebhookOperation(rawEventType);
      const eventType = dataType ? buildOuraSourceEventType(rawEventType, dataType, operation) : rawEventType;
      const occurredAt = normalizeIsoTimestamp(payload.event_time ?? payload.eventTime ?? payload.timestamp) ?? context.now;

      if (!externalAccountId || !eventType || !dataType || !objectId) {
        throw deviceSyncError({
          code: "OURA_WEBHOOK_PAYLOAD_INVALID",
          message: "Oura webhook payload did not include user_id, event_type, data_type, and object_id.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const traceId =
        normalizeString(payload.trace_id ?? payload.traceId ?? payload.event_id ?? payload.eventId) ??
        sha256Text(
          `${externalAccountId}:${eventType}:${dataType}:${objectId}:${
            normalizeString(payload.event_time ?? payload.eventTime ?? payload.timestamp) ?? ""
          }`,
        );

      return {
        externalAccountId,
        eventType,
        traceId,
        occurredAt,
        payload: {
          eventType,
          dataType,
          operation,
        },
        jobs: [
          {
            kind: operation === "delete" ? "delete" : operation ? "resource" : "reconcile",
            priority: operation === "delete" ? OURA_WEBHOOK_DELETE_PRIORITY : OURA_WEBHOOK_RESOURCE_PRIORITY,
            dedupeKey: `oura-webhook:${traceId}`,
            payload: {
              sourceEventType: eventType,
              dataType,
              objectId,
              occurredAt,
              webhookPayload: payload,
              windowStart: subtractDays(context.now, reconcileDays),
              windowEnd: context.now,
              includePersonalInfo: false,
            },
          },
        ],
      };
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

      if (job.kind === "resource") {
        return executeOuraResourceJob(context, job);
      }

      if (job.kind === "delete") {
        return executeOuraDeleteJob(context, job);
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
