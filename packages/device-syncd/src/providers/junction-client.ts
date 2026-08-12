import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";

import { normalizeJunctionProviderSlug } from "../config/connect-routes.ts";
import { deviceSyncError, isDeviceSyncError, type DeviceSyncError } from "../errors.ts";
import { normalizeString } from "../shared.ts";
import { buildProviderApiError as buildProviderApiErrorBase } from "./shared-oauth.ts";
import {
  createProviderRequestAbortSignal,
  isProviderParentAbortError,
  isProviderTimeoutError,
  normalizeProviderAbortError,
  throwIfProviderRequestAborted,
  waitForProviderRetryDelay,
} from "./request-abort.ts";
import {
  buildProviderRequestDiagnostics,
  extractProviderQueryParameterNames,
} from "./provider-diagnostics.ts";
import {
  assertValidJunctionClientConfig,
  resolveJunctionBaseUrl,
} from "../config/junction-client-config.ts";
import type { JunctionEnvironment, JunctionRegion } from "../config/provider-types.ts";

export {
  assertValidJunctionClientConfig,
  resolveJunctionBaseUrl,
} from "../config/junction-client-config.ts";
export type { JunctionEnvironment, JunctionRegion } from "../config/provider-types.ts";

export interface JunctionClientConfig {
  apiKey: string;
  environment: JunctionEnvironment;
  region: JunctionRegion;
  /** Overrides the environment/region-derived Junction API base URL. */
  apiBaseUrl?: string;
  allowedLinkHosts?: readonly string[];
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface JunctionUser {
  userId: string;
}

export interface JunctionLinkToken {
  linkWebUrl: string;
}

export interface JunctionSignInToken {
  signInToken: string;
}

export interface JunctionProviderConnectionSource {
  deviceId: string | null;
  appId: string | null;
}

export interface JunctionProviderConnectionOrigin {
  sourceProviderSlug?: string;
  sourceInstanceId?: string | null;
}

export interface JunctionProviderConnectionErrorDetails {
  errorType: string | null;
  errorMessage: string | null;
  erroredAt: string | null;
}

export interface JunctionProviderConnection {
  id: string | null;
  slug: string;
  name: string | null;
  status: string;
  source: JunctionProviderConnectionSource | null;
  origin: JunctionProviderConnectionOrigin;
  resourceAvailability: Record<string, unknown>;
  errorDetails: JunctionProviderConnectionErrorDetails | null;
}

export type JunctionDateQueryFormat = "date" | "datetime";

export interface JunctionWindowInput {
  dateQueryFormat?: JunctionDateQueryFormat;
  resource: string;
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
  userId: string;
  windowStart: string;
  windowEnd: string;
}

export interface JunctionProfileSummaryInput {
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
  userId: string;
}

export interface JunctionIntrospectionInput {
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
  userId: string;
  userLimit?: number;
}

export interface JunctionHistoricalPullResource {
  daysWithData: number | null;
  errorDetails: string | null;
  rangeEnd: string | null;
  rangeStart: string | null;
  resource: string;
  status: string;
}

export interface JunctionHistoricalPullSource {
  notPulledResources: readonly string[];
  pulledResources: readonly JunctionHistoricalPullResource[];
  sourceProviderSlug: string;
}

export interface JunctionHistoricalPullSnapshot {
  matchedUser: boolean;
  sources: readonly JunctionHistoricalPullSource[];
}

export interface JunctionBulkTriggerHistoricalPullInput {
  /** Junction source provider slug, for example `garmin`. */
  sourceProviderSlug: string;
  userIds: readonly string[];
  signal?: AbortSignal | null;
}

export interface JunctionBulkTriggerHistoricalPullResult {
  /** True when Junction accepted the trigger request. */
  accepted: boolean;
  /**
   * True when Junction rejects the endpoint itself rather than the request.
   * Link Migration endpoints are disabled by default per team, so this is the
   * expected response until support enables them.
   */
  endpointUnavailable: boolean;
}

export interface JunctionRefreshUserDataInput {
  signal?: AbortSignal | null;
  timeoutSeconds?: number | null;
  userId: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_GET_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5_000;
const MAX_COLLECTION_PAGES = 100;
const MAX_COLLECTION_RECORDS = 25_000;
export const JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// These summary endpoints declare `start_date`/`end_date` as YYYY-MM-DD dates
// (not datetimes) in the Junction API reference.
const JUNCTION_DATE_ONLY_SUMMARY_RESOURCES = new Set(["electrocardiogram", "menstrual_cycle", "sleep_cycle"]);

export const JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS = Object.freeze([
  "junction.com",
  "tryvital.io",
] as const);

export class JunctionClient {
  private readonly allowedLinkHosts: readonly string[];
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(config: JunctionClientConfig) {
    assertValidJunctionClientConfig(config);
    this.allowedLinkHosts = normalizeAllowedJunctionLinkHosts(config.allowedLinkHosts);
    this.apiKey = config.apiKey;
    this.baseUrl = resolveJunctionBaseUrl(config);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async resolveUser(
    clientUserId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<JunctionUser | null> {
    const payload = await this.requestJson<Record<string, unknown> | null>(
      "GET",
      `/v2/user/resolve/${encodeURIComponent(clientUserId)}`,
      undefined,
      { endpointKind: "junction_user_resolve", optional404: true, signal: options.signal ?? null },
    );

    return payload ? parseJunctionUser(payload, "Junction resolve user response") : null;
  }

  async createUser(
    clientUserId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<JunctionUser> {
    const payload = await this.requestJson<Record<string, unknown>>(
      "POST",
      "/v2/user/",
      {
        client_user_id: clientUserId,
      },
      { endpointKind: "junction_user_create", signal: options.signal ?? null },
    );
    return parseJunctionUser(payload, "Junction create user response");
  }

  async createOrResolveUser(
    clientUserId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<JunctionUser> {
    const resolved = await this.resolveUser(clientUserId, options);
    if (resolved) {
      return resolved;
    }

    try {
      return await this.createUser(clientUserId, options);
    } catch (error) {
      const retryResolved = await this.resolveUser(clientUserId, options);
      if (retryResolved) {
        return retryResolved;
      }

      throw error;
    }
  }

  async createLinkToken(input: {
    userId: string;
    callbackUrl: string;
    provider?: string | null;
    providerFilter?: readonly string[];
    signal?: AbortSignal | null;
  }): Promise<JunctionLinkToken> {
    const body: Record<string, unknown> = {
      user_id: input.userId,
      redirect_url: input.callbackUrl,
    };

    const provider = normalizeJunctionProviderSlug(input.provider);
    if (provider) {
      body.provider = provider;
    } else if (input.providerFilter && input.providerFilter.length > 0) {
      body.filter_on_providers = [...input.providerFilter];
    }

    const payload = await this.requestJson<Record<string, unknown>>(
      "POST",
      "/v2/link/token",
      body,
      { endpointKind: "junction_link_token_create", signal: input.signal ?? null },
    );
    const linkWebUrl = normalizeString(payload.link_web_url) ?? normalizeString(payload.linkWebUrl);

    if (!linkWebUrl) {
      throw deviceSyncError({
        code: "JUNCTION_LINK_TOKEN_INVALID",
        message: "Junction Link token response did not include link_web_url.",
        retryable: false,
        httpStatus: 502,
      });
    }

    assertValidJunctionLinkWebUrl(linkWebUrl, this.allowedLinkHosts);
    return { linkWebUrl };
  }

  /**
   * Mints a short-lived Junction Mobile SDK sign-in token for an existing
   * Junction user. The token is returned to the caller exactly once and must
   * never be logged or persisted anywhere on the backend.
   */
  async createSignInToken(
    userId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<JunctionSignInToken> {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
      throw new TypeError("Junction sign-in token creation requires a Junction user id.");
    }

    const payload = await this.requestJson<Record<string, unknown>>(
      "POST",
      `/v2/user/${encodeURIComponent(normalizedUserId)}/sign_in_token`,
      undefined,
      { endpointKind: "junction_user_sign_in_token", signal: options.signal ?? null },
    );
    const signInToken =
      normalizeString(payload?.sign_in_token) ?? normalizeString(payload?.signInToken);

    if (!signInToken) {
      throw deviceSyncError({
        code: "JUNCTION_SIGN_IN_TOKEN_INVALID",
        message: "Junction sign-in token response did not include sign_in_token.",
        retryable: false,
        httpStatus: 502,
      });
    }

    return { signInToken };
  }

  async listUserProviders(
    userId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<JunctionProviderConnection[]> {
    const payload = await this.requestJson<unknown>(
      "GET",
      `/v2/user/providers/${encodeURIComponent(userId)}`,
      undefined,
      { endpointKind: "junction_user_providers", signal: options.signal ?? null },
    );
    return parseJunctionProviders(payload);
  }

  async deregisterProvider(input: {
    providerSlug: string;
    signal?: AbortSignal | null;
    userId: string;
  }): Promise<void> {
    const providerSlug = normalizeJunctionProviderSlug(input.providerSlug);
    if (!providerSlug) {
      throw new TypeError("Junction provider deregistration requires a provider slug.");
    }
    const userId = normalizeString(input.userId);
    if (!userId) {
      throw new TypeError("Junction provider deregistration requires a Junction user id.");
    }

    await this.requestJson<unknown>(
      "DELETE",
      `/v2/user/${encodeURIComponent(userId)}/${encodeURIComponent(providerSlug)}`,
      undefined,
      { endpointKind: "junction_user_provider_deregister", signal: input.signal ?? null },
    );
  }

  async listUserDevices(
    userId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<unknown[]> {
    const payload = await this.requestJson<unknown>(
      "GET",
      `/v2/user/${encodeURIComponent(userId)}/device`,
      undefined,
      { endpointKind: "junction_user_devices", signal: options.signal ?? null },
    );
    return extractCollectionRecords(payload);
  }

  async listSummary(input: JunctionWindowInput): Promise<unknown[]> {
    if (input.resource === "profile") {
      return this.listProfileSummary(input);
    }

    return this.fetchWindowedCollection(
      `/v2/summary/${encodeURIComponent(input.resource)}/${encodeURIComponent(input.userId)}`,
      {
        ...input,
        dateQueryFormat: resolveJunctionSummaryDateQueryFormat(input),
      },
      { endpointKind: "junction_summary_collection" },
    );
  }

  async listProfileSummary(input: JunctionProfileSummaryInput): Promise<unknown[]> {
    const search = new URLSearchParams();
    const sourceProviderSlug = normalizeSourceSlug(input.sourceProviderSlug);
    if (sourceProviderSlug) {
      search.set("provider", sourceProviderSlug);
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const payload = await this.requestJson<unknown>(
      "GET",
      `/v2/summary/profile/${encodeURIComponent(input.userId)}${suffix}`,
      undefined,
      { endpointKind: "junction_summary_collection", signal: input.signal ?? null },
    );
    return extractCollectionRecords(payload, "profile");
  }

  async listTimeseries(input: JunctionWindowInput): Promise<unknown[]> {
    const apiResource = resolveJunctionTimeseriesApiResource(input.resource);
    return this.fetchWindowedCollection(
      `/v2/timeseries/${encodeURIComponent(input.userId)}/${encodeURIComponent(apiResource)}/grouped`,
      input,
      {
        endpointKind: "junction_timeseries_collection",
        extractRecords: extractTimeseriesRecords,
      },
    );
  }

  async getWorkoutStream(
    workoutId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<unknown> {
    const normalizedWorkoutId = normalizeString(workoutId);
    if (!normalizedWorkoutId || normalizedWorkoutId.length > 200) {
      throw new TypeError("Junction workout stream fetch requires a bounded workout id.");
    }

    return this.requestJson<unknown>(
      "GET",
      `/v2/timeseries/workouts/${encodeURIComponent(normalizedWorkoutId)}/stream`,
      undefined,
      {
        endpointKind: "junction_workout_stream",
        maxAttempts: 1,
        maxResponseBytes: JUNCTION_WORKOUT_STREAM_MAX_RESPONSE_BYTES,
        signal: options.signal ?? null,
      },
    );
  }

  async introspectResources(input: JunctionIntrospectionInput): Promise<unknown> {
    return this.requestJson<unknown>(
      "GET",
      `/v2/introspect/resources?${buildJunctionIntrospectionSearch(input).toString()}`,
      undefined,
      { endpointKind: "junction_introspect_resources", signal: input.signal ?? null },
    );
  }

  async introspectHistoricalPull(
    input: JunctionIntrospectionInput,
  ): Promise<JunctionHistoricalPullSnapshot> {
    const payload = await this.requestJson<unknown>(
      "GET",
      `/v2/introspect/historical_pull?${buildJunctionIntrospectionSearch(input).toString()}`,
      undefined,
      { endpointKind: "junction_introspect_historical_pull", signal: input.signal ?? null },
    );
    return parseJunctionHistoricalPullSnapshot(
      payload,
      input.userId,
      input.sourceProviderSlug ?? null,
    );
  }

  /**
   * Asks Junction to re-run its historical pull for one provider. For a
   * push-primary provider this is the only lever that can restart a dead
   * carrier without the member re-authorizing, because there is nothing to pull
   * directly and a refresh cannot make the provider push again.
   *
   * Junction ships this under Link Migration, which is disabled per team by
   * default. A disabled endpoint answers 403/404 rather than failing the
   * request, so that case is reported as `endpointUnavailable` and left for the
   * caller to treat as "not enabled yet" instead of a transport failure.
   */
  async bulkTriggerHistoricalPull(
    input: JunctionBulkTriggerHistoricalPullInput,
  ): Promise<JunctionBulkTriggerHistoricalPullResult> {
    const sourceProviderSlug = normalizeJunctionProviderSlug(input.sourceProviderSlug);
    if (!sourceProviderSlug) {
      throw new TypeError("Junction historical pull triggers require a provider slug.");
    }

    const userIds = [
      ...new Set(
        input.userIds
          .map((userId) => normalizeString(userId))
          .filter((userId): userId is string => typeof userId === "string"),
      ),
    ];
    if (userIds.length === 0) {
      throw new TypeError("Junction historical pull triggers require at least one user id.");
    }

    try {
      await this.requestJson<unknown>(
        "POST",
        "/v2/link/bulk_trigger_historical_pull",
        {
          provider: sourceProviderSlug,
          user_ids: userIds,
        },
        {
          endpointKind: "junction_bulk_trigger_historical_pull",
          signal: input.signal ?? null,
        },
      );

      return { accepted: true, endpointUnavailable: false };
    } catch (error) {
      if (isJunctionDisabledEndpointError(error)) {
        return { accepted: false, endpointUnavailable: true };
      }

      throw error;
    }
  }

  async refreshUserData(input: JunctionRefreshUserDataInput): Promise<unknown> {
    const search = new URLSearchParams();
    const timeoutSeconds = normalizeJunctionRefreshTimeoutSeconds(input.timeoutSeconds);
    if (timeoutSeconds !== null) {
      search.set("timeout", String(timeoutSeconds));
    }
    const suffix = search.size > 0 ? `?${search.toString()}` : "";

    return this.requestJson<unknown>(
      "POST",
      `/v2/user/refresh/${encodeURIComponent(input.userId)}${suffix}`,
      undefined,
      { endpointKind: "junction_user_refresh", signal: input.signal ?? null },
    );
  }

  private async fetchWindowedCollection(
    path: string,
    input: JunctionWindowInput,
    options: {
      endpointKind?: string;
      extractRecords?: (payload: unknown, resource: string) => unknown[];
    } = {},
  ): Promise<unknown[]> {
    const records: unknown[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const extractRecords = options.extractRecords ?? extractCollectionRecords;

    do {
      if (pages >= MAX_COLLECTION_PAGES) {
        throw deviceSyncError({
          code: "JUNCTION_API_PAGINATION_LIMIT",
          message: `Junction ${input.resource} response exceeded the configured page limit.`,
          retryable: true,
          httpStatus: 502,
        });
      }

      const dateQueryFormat = input.dateQueryFormat ?? "datetime";
      const search = new URLSearchParams({
        start_date: toDateParameter(input.windowStart, dateQueryFormat, "start"),
        end_date: toDateParameter(input.windowEnd, dateQueryFormat, "end"),
      });
      const sourceProviderSlug = normalizeSourceSlug(input.sourceProviderSlug);
      if (sourceProviderSlug) {
        search.set("provider", sourceProviderSlug);
      }

      if (cursor) {
        search.set("next_cursor", cursor);
      }

      const payload = await this.requestJson<unknown>(
        "GET",
        `${path}?${search.toString()}`,
        undefined,
        { endpointKind: options.endpointKind, signal: input.signal ?? null },
      );
      records.push(...extractRecords(payload, input.resource));
      pages += 1;

      if (records.length > MAX_COLLECTION_RECORDS) {
        throw deviceSyncError({
          code: "JUNCTION_API_RECORD_LIMIT",
          message: `Junction ${input.resource} response exceeded the configured record limit.`,
          retryable: true,
          httpStatus: 502,
        });
      }

      cursor = extractNextCursor(payload);
    } while (cursor);

    return records;
  }

  private async requestJson<T>(
    method: "DELETE" | "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    options: {
      endpointKind?: string;
      maxAttempts?: number;
      maxResponseBytes?: number;
      optional404?: boolean;
      signal?: AbortSignal | null;
    } = {},
  ): Promise<T> {
    const attempts = options.maxAttempts ?? (method === "GET" ? MAX_GET_ATTEMPTS : 1);
    let lastError: unknown;
    const endpointKind = options.endpointKind ?? resolveJunctionEndpointKind(path);
    const requestDiagnostics = buildProviderRequestDiagnostics({
      method,
      endpointKind,
      authKind: "provider_config_api_key_header",
      authPlacement: "headers",
      credentialPresent: Boolean(this.apiKey),
      contentType: body ? "application_json" : "none",
      bodyKind: body ? "json_object" : "none",
      bodyFieldNames: body ? Object.keys(body) : [],
      queryParameterNames: extractProviderQueryParameterNames(path),
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      throwIfProviderRequestAborted(options.signal);
      const requestAbort = createProviderRequestAbortSignal({
        signal: options.signal ?? null,
        timeoutMs: this.requestTimeoutMs,
      });

      try {
        const response = await this.fetchImpl(new URL(path.replace(/^\/+/u, ""), this.baseUrl), {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-vital-api-key": this.apiKey,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: requestAbort.signal,
        });
        throwIfProviderRequestAborted(requestAbort.signal);

        if (options.optional404 && response.status === 404) {
          await response.body?.cancel().catch(() => undefined);
          throwIfProviderRequestAborted(requestAbort.signal);
          return null as T;
        }

        const text = await readJunctionResponseText(response, options.maxResponseBytes);
        if (!response.ok) {
          const retryable = method === "GET" && (response.status === 429 || response.status >= 500);
          if (retryable && attempt < attempts) {
            await waitForProviderRetryDelay(resolveRetryDelayMs(response, attempt), options.signal);
            continue;
          }

          throw buildProviderApiError({
            code: "JUNCTION_API_REQUEST_FAILED",
            message: `Junction API request failed for ${endpointKind}.`,
            response,
            body: text,
            retryable,
            httpStatus: response.status >= 400 && response.status < 600 ? 502 : undefined,
            diagnostics: requestDiagnostics,
          });
        }

        return parseJsonResponse<T>(text);
      } catch (error) {
        lastError = error;

        if (isProviderParentAbortError(error, requestAbort.signal)) {
          throw normalizeProviderAbortError(error, requestAbort.signal);
        }

        if (
          !requestAbort.signal.aborted
          && options.signal
          && isProviderParentAbortError(error, options.signal)
        ) {
          throw normalizeProviderAbortError(error, options.signal);
        }

        if (isDeviceSyncError(error)) {
          if (!error.retryable || attempt >= attempts) {
            throw error;
          }
        } else if (attempt >= attempts || isProviderTimeoutError(error, requestAbort.signal)) {
          break;
        }

        await waitForProviderRetryDelay(resolveRetryDelayMs(null, attempt), options.signal);
      } finally {
        requestAbort.cleanup();
      }
    }

    throw deviceSyncError({
      code: "JUNCTION_API_REQUEST_FAILED",
      message: `Junction API request failed for ${endpointKind}.`,
      retryable: method === "GET",
      httpStatus: 502,
      details: requestDiagnostics,
      cause: lastError,
    });
  }
}

async function readJunctionResponseText(response: Response, maxBytes: number | undefined): Promise<string> {
  if (maxBytes === undefined) {
    return response.text();
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw junctionWorkoutStreamResponseLimitError(maxBytes);
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw junctionWorkoutStreamResponseLimitError(maxBytes);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function junctionWorkoutStreamResponseLimitError(maxBytes: number): DeviceSyncError {
  return deviceSyncError({
    code: "JUNCTION_WORKOUT_STREAM_RESPONSE_LIMIT",
    message: `Junction workout stream response exceeded the ${maxBytes}-byte limit.`,
    retryable: false,
    httpStatus: 502,
  });
}

function buildProviderApiError(input: {
  code: string;
  message: string;
  response: Response;
  body: string;
  retryable: boolean;
  httpStatus?: number;
  diagnostics: Record<string, boolean | number | string | null | undefined>;
}) {
  return buildProviderApiErrorBase(
    input.code,
    input.message,
    input.response,
    input.body,
    {
      retryable: input.retryable,
      httpStatus: input.httpStatus,
      diagnostics: input.diagnostics,
    },
  );
}

function resolveJunctionEndpointKind(path: string): string {
  const pathname = safeProviderPathname(path);

  if (pathname.startsWith("/v2/user/resolve/")) {
    return "junction_user_resolve";
  }

  if (pathname === "/v2/user/") {
    return "junction_user_create";
  }

  if (pathname === "/v2/link/token") {
    return "junction_link_token_create";
  }

  if (pathname.startsWith("/v2/user/refresh/")) {
    return "junction_user_refresh";
  }

  if (pathname.startsWith("/v2/user/providers/")) {
    return "junction_user_providers";
  }

  if (/^\/v2\/user\/[^/]+\/device$/u.test(pathname)) {
    return "junction_user_devices";
  }

  if (/^\/v2\/user\/[^/]+\/[^/]+$/u.test(pathname)) {
    return "junction_user_provider_deregister";
  }

  if (pathname.startsWith("/v2/summary/")) {
    return "junction_summary_collection";
  }

  if (pathname.startsWith("/v2/timeseries/")) {
    return "junction_timeseries_collection";
  }

  if (pathname === "/v2/introspect/resources") {
    return "junction_introspect_resources";
  }

  if (pathname === "/v2/introspect/historical_pull") {
    return "junction_introspect_historical_pull";
  }

  if (pathname === "/v2/link/bulk_trigger_historical_pull") {
    return "junction_bulk_trigger_historical_pull";
  }

  return "junction_api";
}

/**
 * A gated Junction endpoint answers 403 (not entitled) or 404 (not routed for
 * this team) instead of failing the call. Both mean "ask support to enable it",
 * not "the request was wrong", so callers should stop rather than retry.
 */
function isJunctionDisabledEndpointError(error: unknown): boolean {
  if (!isDeviceSyncError(error)) {
    return false;
  }

  const status = error.details?.status;
  return status === 403 || status === 404;
}

function buildJunctionIntrospectionSearch(input: JunctionIntrospectionInput): URLSearchParams {
  const search = new URLSearchParams({
    user_id: input.userId,
    user_limit: String(input.userLimit ?? 1),
  });
  const sourceProviderSlug = normalizeSourceSlug(input.sourceProviderSlug);
  if (sourceProviderSlug) {
    search.set("provider", sourceProviderSlug);
  }
  return search;
}

function resolveJunctionTimeseriesApiResource(resource: string): string {
  return resource === "weight" ? "body_weight" : resource;
}

function resolveJunctionSummaryDateQueryFormat(input: JunctionWindowInput): JunctionDateQueryFormat {
  return JUNCTION_DATE_ONLY_SUMMARY_RESOURCES.has(input.resource)
    ? "date"
    : input.dateQueryFormat ?? "datetime";
}

function normalizeJunctionRefreshTimeoutSeconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(5, Math.min(60, Math.trunc(value)));
}

function safeProviderPathname(path: string): string {
  try {
    return new URL(path, "https://provider.invalid").pathname;
  } catch {
    return path.split("?")[0] ?? "";
  }
}

export function isAllowedJunctionLinkHost(
  hostname: string,
  allowedLinkHosts: readonly string[] = JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS,
): boolean {
  const normalizedHostname = normalizeJunctionLinkHostname(hostname);
  if (!isJunctionLinkDnsHostname(normalizedHostname)) {
    return false;
  }

  return normalizeAllowedJunctionLinkHosts(allowedLinkHosts).some(
    (allowedHost) => normalizedHostname === allowedHost
      || normalizedHostname.endsWith(`.${allowedHost}`),
  );
}

function assertValidJunctionLinkWebUrl(value: string, allowedLinkHosts: readonly string[]): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw deviceSyncError({
      code: "JUNCTION_LINK_TOKEN_INVALID",
      message: "Junction Link token response included an invalid link_web_url.",
      retryable: false,
      httpStatus: 502,
      cause: error,
    });
  }

  if (url.protocol !== "https:" || !isAllowedJunctionLinkHost(url.hostname, allowedLinkHosts)) {
    throw deviceSyncError({
      code: "JUNCTION_LINK_TOKEN_INVALID",
      message: "Junction Link token response included an unexpected link_web_url host.",
      retryable: false,
      httpStatus: 502,
    });
  }
}

function normalizeAllowedJunctionLinkHosts(value: readonly string[] | undefined): readonly string[] {
  const hosts = value ?? JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS;
  const normalizedHosts = [...new Set(hosts.map(normalizeJunctionLinkHostConfig))];

  if (normalizedHosts.length === 0) {
    throw new TypeError("Junction allowedLinkHosts must include at least one host.");
  }

  return Object.freeze(normalizedHosts);
}

function normalizeJunctionLinkHostConfig(value: string): string {
  const normalized = normalizeJunctionLinkHostname(value);

  if (!isJunctionLinkDnsHostname(normalized)) {
    throw new TypeError("Junction allowedLinkHosts entries must be DNS hostnames.");
  }

  return normalized;
}

function normalizeJunctionLinkHostname(value: string): string {
  return value.toLowerCase().replace(/\.+$/u, "");
}

function isJunctionLinkDnsHostname(value: string): boolean {
  const label = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
  return new RegExp(`^${label}(?:\\.${label})+$`, "u").test(value);
}

function parseJunctionUser(payload: Record<string, unknown>, label: string): JunctionUser {
  const userId =
    normalizeString(payload.user_id)
    ?? normalizeString(payload.userId)
    ?? normalizeString(payload.id);

  if (!userId) {
    throw deviceSyncError({
      code: "JUNCTION_USER_RESPONSE_INVALID",
      message: `${label} did not include a user_id.`,
      retryable: false,
      httpStatus: 502,
    });
  }

  return { userId };
}

function parseJunctionProviders(payload: unknown): JunctionProviderConnection[] {
  return extractCollectionRecords(payload)
    .map(parseJunctionProviderConnection)
    .filter((provider): provider is JunctionProviderConnection => Boolean(provider));
}

export function parseJunctionHistoricalPullSnapshot(
  payload: unknown,
  expectedUserId: string,
  requestedSourceProviderSlug: string | null = null,
): JunctionHistoricalPullSnapshot {
  const root = readPlainObject(payload);
  if (!root || !Array.isArray(root.data)) {
    throw deviceSyncError({
      code: "JUNCTION_HISTORICAL_PULL_RESPONSE_INVALID",
      message: "Junction historical-pull introspection returned an invalid response.",
      retryable: true,
      httpStatus: 502,
    });
  }

  const normalizedExpectedUserId = normalizeString(expectedUserId);
  const requestedProvider = normalizeJunctionProviderSlug(requestedSourceProviderSlug);
  const sourcesByProvider = new Map<string, JunctionHistoricalPullSource>();
  let matchedUser = false;

  for (const value of root.data) {
    const user = readPlainObject(value);
    const userId = normalizeString(user?.user_id) ?? normalizeString(user?.userId);
    if (!user || !normalizedExpectedUserId || userId !== normalizedExpectedUserId) {
      continue;
    }
    matchedUser = true;

    const providers = readPlainObject(user.provider);
    if (!providers) {
      continue;
    }

    for (const [rawProviderSlug, rawDetails] of Object.entries(providers)) {
      const sourceProviderSlug = normalizeJunctionProviderSlug(rawProviderSlug);
      const details = readPlainObject(rawDetails);
      if (
        !sourceProviderSlug
        || !details
        || (requestedProvider && sourceProviderSlug !== requestedProvider)
      ) {
        continue;
      }

      const notPulledResources = Array.isArray(details.not_pulled)
        ? [...new Set(details.not_pulled.flatMap((resource) => {
            const normalized = normalizeJunctionProviderSlug(resource);
            return normalized ? [normalized] : [];
          }))].sort((left, right) => left.localeCompare(right))
        : [];
      const pulled = readPlainObject(details.pulled);
      const pulledResources = pulled
        ? Object.entries(pulled).flatMap(([rawResource, rawStatistics]) => {
            const resource = normalizeJunctionProviderSlug(rawResource);
            const statistics = readPlainObject(rawStatistics);
            const status = normalizeString(statistics?.status)?.toLowerCase();
            if (!resource || !statistics || !status) {
              return [];
            }

            const rawDaysWithData = statistics.days_with_data ?? statistics.daysWithData;
            const daysWithData = typeof rawDaysWithData === "number"
              && Number.isSafeInteger(rawDaysWithData)
              && rawDaysWithData >= 0
              ? rawDaysWithData
              : null;
            return [{
              daysWithData,
              errorDetails:
                normalizeString(statistics.error_details)
                ?? normalizeString(statistics.errorDetails)
                ?? null,
              rangeEnd:
                normalizeString(statistics.range_end)
                ?? normalizeString(statistics.rangeEnd)
                ?? null,
              rangeStart:
                normalizeString(statistics.range_start)
                ?? normalizeString(statistics.rangeStart)
                ?? null,
              resource,
              status,
            }];
          }).sort((left, right) => left.resource.localeCompare(right.resource))
        : [];

      sourcesByProvider.set(sourceProviderSlug, {
        notPulledResources,
        pulledResources,
        sourceProviderSlug,
      });
    }
  }

  return {
    matchedUser,
    sources: [...sourcesByProvider.values()].sort((left, right) =>
      left.sourceProviderSlug.localeCompare(right.sourceProviderSlug)
    ),
  };
}

function parseJunctionProviderConnection(value: unknown): JunctionProviderConnection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawOrigin = resolveJunctionOrigin(record);
  const slug =
    normalizeSourceSlug(record.slug)
    ?? normalizeSourceSlug(record.sourceProviderSlug)
    ?? normalizeSourceSlug(record.source_provider_slug)
    ?? normalizeSourceSlug(record.provider_slug)
    ?? normalizeSourceSlug(record.provider)
    ?? normalizeSourceSlug(rawOrigin.sourceProviderSlug);

  if (!slug) {
    return null;
  }
  const source = readJunctionProviderConnectionSource(record);
  const origin = resolveJunctionOrigin(record, {
    sourceProviderSlug: rawOrigin.sourceProviderSlug ?? slug,
  });

  return {
    id: readJunctionProviderConnectionId(record),
    slug,
    name: normalizeString(record.name) ?? normalizeString(record.display_name) ?? null,
    status: normalizeString(record.status) ?? "unknown",
    source,
    origin: {
      sourceProviderSlug: origin.sourceProviderSlug,
      sourceInstanceId: origin.sourceInstanceId,
    },
    resourceAvailability: readResourceAvailability(record),
    errorDetails: readJunctionProviderConnectionErrorDetails(record),
  };
}

function readJunctionProviderConnectionErrorDetails(
  record: Record<string, unknown>,
): JunctionProviderConnectionErrorDetails | null {
  const details = readPlainObject(record.error_details) ?? readPlainObject(record.errorDetails);
  if (!details) {
    return null;
  }

  const errorType = normalizeString(details.error_type) ?? normalizeString(details.errorType) ?? null;
  const errorMessage = normalizeString(details.error_message) ?? normalizeString(details.errorMessage) ?? null;
  const erroredAt = normalizeString(details.errored_at) ?? normalizeString(details.erroredAt) ?? null;
  if (!errorType && !errorMessage && !erroredAt) {
    return null;
  }

  return { errorType, errorMessage, erroredAt };
}

function readJunctionProviderConnectionId(record: Record<string, unknown>): string | null {
  return (
    normalizeString(record.id)
    ?? normalizeString(record.provider_connection_id)
    ?? normalizeString(record.providerConnectionId)
    ?? normalizeString(record.connection_id)
    ?? normalizeString(record.connectionId)
    ?? normalizeString(record.source_id)
    ?? normalizeString(record.sourceId)
    ?? null
  );
}

function readJunctionProviderConnectionSource(
  record: Record<string, unknown>,
): JunctionProviderConnectionSource | null {
  const source = readPlainObject(record.source);
  const deviceId = (
    normalizeString(source?.device_id)
    ?? normalizeString(source?.deviceId)
    ?? normalizeString(record.source_device_id)
    ?? normalizeString(record.sourceDeviceId)
    ?? normalizeString(record.device_id)
    ?? normalizeString(record.deviceId)
    ?? null
  );
  const appId = (
    normalizeString(source?.app_id)
    ?? normalizeString(source?.appId)
    ?? normalizeString(record.source_app_id)
    ?? normalizeString(record.sourceAppId)
    ?? normalizeString(record.app_id)
    ?? normalizeString(record.appId)
    ?? null
  );

  return deviceId || appId
    ? {
        deviceId,
        appId,
      }
    : null;
}

function readResourceAvailability(record: Record<string, unknown>): Record<string, unknown> {
  const value = record.resource_availability ?? record.resourceAvailability;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeSourceSlug(value: unknown): string | null {
  const normalized = normalizeString(value)?.toLowerCase().replace(/[^a-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized || null;
}

function extractCollectionRecords(payload: unknown, resource?: string): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (resource) {
    for (const resourceKey of resolveCollectionEnvelopeKeys(resource)) {
      const resourceRecords = record[resourceKey];
      if (Array.isArray(resourceRecords)) {
        return resourceRecords;
      }
    }
  }

  const candidates = [
    record.providers,
    record.data,
    record.results,
    record.items,
    record.records,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return resource ? [record] : [];
}

function resolveCollectionEnvelopeKeys(resource: string): readonly string[] {
  return resource === "meal" ? ["meal", "meals"] : [resource];
}

function extractTimeseriesRecords(payload: unknown, resource: string): unknown[] {
  const groupedRecords = flattenGroupedTimeseries(resource, payload);
  return groupedRecords ?? extractCollectionRecords(payload, resource);
}

function flattenGroupedTimeseries(resource: string, payload: unknown): unknown[] | null {
  const envelope = readPlainObject(payload);
  const groups = readPlainObject(envelope?.groups);
  if (!groups) {
    return null;
  }

  const records: unknown[] = [];

  for (const [sourceSlug, rawGroups] of Object.entries(groups)) {
    for (const rawGroup of asArray(rawGroups)) {
      const group = readPlainObject(rawGroup);
      if (!group) {
        continue;
      }

      for (const rawSample of asArray(group.data)) {
        const sample = readPlainObject(rawSample);
        if (!sample) {
          continue;
        }

        const origin = resolveJunctionOrigin(sample, {
          ...group,
          groupedSourceSlug: sourceSlug,
        });
        records.push(stripUndefinedRecord({
          ...sample,
          sourceProviderSlug: normalizeSourceSlug(origin.sourceProviderSlug) ?? undefined,
          sourceType: origin.sourceType,
          sourceInstanceId: origin.sourceInstanceId,
          junctionResource: resource,
        }));
      }
    }
  }

  return records;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value === undefined || value === null ? [] : [value];
}

function stripUndefinedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function extractNextCursor(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return (
    normalizeString(record.next_cursor)
    ?? normalizeString(record.nextCursor)
    ?? normalizeString(record.cursor)
    ?? normalizeString(record.next)
    ?? null
  );
}

function toDateParameter(
  timestamp: string,
  format: JunctionDateQueryFormat,
  boundary: "end" | "start",
): string {
  const date = new Date(timestamp);
  if (format === "date" && boundary === "end") {
    date.setTime(date.getTime() - 1);
  }
  const isoTimestamp = date.toISOString();
  return format === "date" ? isoTimestamp.slice(0, 10) : isoTimestamp;
}

function parseJsonResponse<T>(text: string): T {
  if (!text.trim()) {
    return null as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw deviceSyncError({
      code: "JUNCTION_API_INVALID_JSON",
      message: "Junction API response was not valid JSON.",
      retryable: false,
      httpStatus: 502,
      cause: error,
    });
  }
}

function resolveRetryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  const retryAfterMs = retryAfter ? parseRetryAfterMs(retryAfter) : null;
  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  }

  return Math.min(DEFAULT_RETRY_DELAY_MS * 2 ** Math.max(attempt - 1, 0), MAX_RETRY_DELAY_MS);
}

function parseRetryAfterMs(value: string): number | null {
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(parsed - Date.now(), 0);
}
