import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";

import { normalizeJunctionProviderSlug } from "../config/connect-routes.ts";
import { deviceSyncError, isDeviceSyncError } from "../errors.ts";
import { normalizeString } from "../shared.ts";
import { buildProviderApiError as buildProviderApiErrorBase } from "./shared-oauth.ts";
import {
  createProviderRequestAbortSignal,
  throwIfProviderRequestAborted,
  waitForProviderRetryDelay,
} from "./request-abort.ts";
import {
  buildProviderRequestDiagnostics,
  extractProviderQueryParameterNames,
} from "./provider-diagnostics.ts";

export type JunctionEnvironment = "sandbox" | "production";
export type JunctionRegion = "us" | "eu";

export interface JunctionClientConfig {
  apiKey: string;
  environment: JunctionEnvironment;
  region: JunctionRegion;
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

export interface JunctionProviderConnectionSource {
  deviceId: string | null;
  appId: string | null;
}

export interface JunctionProviderConnectionOrigin {
  sourceProviderSlug?: string;
  sourceInstanceId?: string | null;
}

export interface JunctionProviderConnection {
  id: string | null;
  slug: string;
  name: string | null;
  status: string;
  source: JunctionProviderConnectionSource | null;
  origin: JunctionProviderConnectionOrigin;
  resourceAvailability: Record<string, unknown>;
}

export interface JunctionWindowInput {
  resource: string;
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
  userId: string;
  windowStart: string;
  windowEnd: string;
}

export interface JunctionIntrospectionInput {
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
  userId: string;
  userLimit?: number;
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

export const JUNCTION_DEFAULT_ALLOWED_LINK_HOSTS = Object.freeze([
  "junction.com",
  "tryvital.io",
] as const);

const JUNCTION_ENVIRONMENT_MATRIX: Readonly<Record<
  `${JunctionEnvironment}:${JunctionRegion}`,
  { apiKeyPrefix: string; baseUrl: string }
>> = Object.freeze({
  "production:us": {
    apiKeyPrefix: "pk_us_",
    baseUrl: "https://api.us.junction.com/",
  },
  "production:eu": {
    apiKeyPrefix: "pk_eu_",
    baseUrl: "https://api.eu.junction.com/",
  },
  "sandbox:us": {
    apiKeyPrefix: "sk_us_",
    baseUrl: "https://api.sandbox.us.junction.com/",
  },
  "sandbox:eu": {
    apiKeyPrefix: "sk_eu_",
    baseUrl: "https://api.sandbox.eu.junction.com/",
  },
});

export function resolveJunctionBaseUrl(
  config: Pick<JunctionClientConfig, "environment" | "region">,
): string {
  const expected = requireJunctionEnvironmentProfile(config.environment, config.region);
  return normalizeJunctionBaseUrl(expected.baseUrl);
}

export function assertValidJunctionClientConfig(config: JunctionClientConfig): void {
  const profile = requireJunctionEnvironmentProfile(config.environment, config.region);
  const apiKey = normalizeString(config.apiKey);

  if (!apiKey) {
    throw new TypeError("JUNCTION_API_KEY must be a non-empty string.");
  }

  if (!apiKey.startsWith(profile.apiKeyPrefix)) {
    throw new TypeError(
      `JUNCTION_API_KEY must start with ${profile.apiKeyPrefix} for ${config.environment}/${config.region}.`,
    );
  }

  resolveJunctionBaseUrl(config);
}

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
    providerFilter?: readonly string[];
    signal?: AbortSignal | null;
  }): Promise<JunctionLinkToken> {
    const body: Record<string, unknown> = {
      user_id: input.userId,
      redirect_url: input.callbackUrl,
    };

    if (input.providerFilter && input.providerFilter.length > 0) {
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
    return this.fetchWindowedCollection(
      `/v2/summary/${encodeURIComponent(input.resource)}/${encodeURIComponent(input.userId)}`,
      input,
      { endpointKind: "junction_summary_collection" },
    );
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

  async introspectResources(input: JunctionIntrospectionInput): Promise<unknown> {
    return this.requestJson<unknown>(
      "GET",
      `/v2/introspect/resources?${buildJunctionIntrospectionSearch(input).toString()}`,
      undefined,
      { endpointKind: "junction_introspect_resources", signal: input.signal ?? null },
    );
  }

  async introspectHistoricalPull(input: JunctionIntrospectionInput): Promise<unknown> {
    return this.requestJson<unknown>(
      "GET",
      `/v2/introspect/historical_pull?${buildJunctionIntrospectionSearch(input).toString()}`,
      undefined,
      { endpointKind: "junction_introspect_historical_pull", signal: input.signal ?? null },
    );
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

      const search = new URLSearchParams({
        start_date: toDateParameter(input.windowStart),
        end_date: toDateParameter(input.windowEnd),
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
    options: { endpointKind?: string; optional404?: boolean; signal?: AbortSignal | null } = {},
  ): Promise<T> {
    const attempts = method === "GET" ? MAX_GET_ATTEMPTS : 1;
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

        if (options.optional404 && response.status === 404) {
          return null as T;
        }

        const text = await response.text();
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

        if (isDeviceSyncError(error)) {
          if (!error.retryable || attempt >= attempts) {
            throw error;
          }
        } else if (attempt >= attempts || isDeviceSyncAbortError(error)) {
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

  return "junction_api";
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

function requireJunctionEnvironmentProfile(environment: JunctionEnvironment, region: JunctionRegion) {
  const profile = JUNCTION_ENVIRONMENT_MATRIX[`${environment}:${region}`];
  if (!profile) {
    throw new TypeError("Junction environment and region must be one of sandbox|production and us|eu.");
  }

  return profile;
}

function normalizeJunctionBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("Junction API base URL must be a valid absolute URL.", { cause: error });
  }

  if (url.search || url.hash) {
    throw new TypeError("Junction API base URL must not include a query string or fragment.");
  }

  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url.toString();
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

function parseJunctionProviderConnection(value: unknown): JunctionProviderConnection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const origin = resolveJunctionOrigin(record);
  const slug =
    normalizeSourceSlug(record.slug)
    ?? normalizeSourceSlug(record.sourceProviderSlug)
    ?? normalizeSourceSlug(record.source_provider_slug)
    ?? normalizeSourceSlug(record.provider_slug)
    ?? normalizeSourceSlug(record.provider)
    ?? normalizeSourceSlug(origin.sourceProviderSlug);

  if (!slug) {
    return null;
  }

  return {
    id: readJunctionProviderConnectionId(record),
    slug,
    name: normalizeString(record.name) ?? normalizeString(record.display_name) ?? null,
    status: normalizeString(record.status) ?? "unknown",
    source: readJunctionProviderConnectionSource(record),
    origin: {
      sourceProviderSlug: origin.sourceProviderSlug,
      sourceInstanceId: origin.sourceInstanceId,
    },
    resourceAvailability: readResourceAvailability(record),
  };
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
  const resourceRecords = resource ? record[resource] : undefined;
  if (Array.isArray(resourceRecords)) {
    return resourceRecords;
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

function toDateParameter(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
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

function isDeviceSyncAbortError(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === "AbortError" || error.name === "TimeoutError");
}
