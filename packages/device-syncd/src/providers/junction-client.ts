import { ActivityClient, type GetActivityRequest } from "@junction-api/sdk/activity";
import { BodyClient } from "@junction-api/sdk/body";
import { ElectrocardiogramClient } from "@junction-api/sdk/electrocardiogram";
import {
  type GetUserHistoricalPullsIntrospectRequest,
  type GetUserResourcesIntrospectRequest,
  IntrospectClient,
} from "@junction-api/sdk/introspect";
import {
  type BulkTriggerHistoricalPullBody,
  LinkClient,
  type LinkTokenExchange,
} from "@junction-api/sdk/link";
import { MealClient } from "@junction-api/sdk/meal";
import { MenstrualCycleClient } from "@junction-api/sdk/menstrualCycle";
import { ProfileClient, type GetProfileRequest } from "@junction-api/sdk/profile";
import { SleepClient } from "@junction-api/sdk/sleep";
import { SleepCycleClient } from "@junction-api/sdk/sleepCycle";
import {
  type DeregisterProviderUserRequest,
  type RefreshUserRequest,
  UserClient,
} from "@junction-api/sdk/user";
import { VitalsClient, type StepsGroupedVitalsRequest } from "@junction-api/sdk/vitals";
import { WorkoutsClient } from "@junction-api/sdk/workouts";
import { resolveJunctionTimeseriesResourcePolicy } from "@murphai/contracts";
import { resolveJunctionOrigin } from "@murphai/importers/device-providers/junction-origin";

import {
  normalizeJunctionProviderSlug,
  resolveJunctionDeviceConnectRouteByProviderSlug,
} from "../config/connect-routes.ts";
import { deviceSyncError, isDeviceSyncError } from "../errors.ts";
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
import { buildProviderRequestDiagnostics } from "./provider-diagnostics.ts";
import {
  assertValidJunctionClientConfig,
  resolveJunctionBaseUrl,
} from "../config/junction-client-config.ts";
import type { JunctionEnvironment, JunctionRegion } from "../config/provider-types.ts";

type JunctionSdkClientOptions = VitalsClient.Options;
type JunctionSdkRequestOptions = VitalsClient.RequestOptions;

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

export interface JunctionCollectionWorkLimit {
  maxAttemptsPerPage: number;
  maxPages: number;
  requestTimeoutMs: number;
}

export interface JunctionWindowInput {
  collectionWorkLimit?: JunctionCollectionWorkLimit;
  dateQueryFormat?: JunctionDateQueryFormat;
  requireStructurallyCompleteCollection?: boolean;
  maxRecords?: number;
  resource: string;
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
  userId: string;
  windowStart: string;
  windowEnd: string;
}

export interface JunctionProfileSummaryInput {
  collectionWorkLimit?: JunctionCollectionWorkLimit;
  signal?: AbortSignal | null;
  sourceProviderSlug?: string | null;
  userId: string;
}

export interface JunctionWorkoutStreamInput {
  collectionWorkLimit?: JunctionCollectionWorkLimit;
  signal?: AbortSignal | null;
  workoutId: string;
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

type JunctionSdkProvider = DeregisterProviderUserRequest["provider"];
type JunctionSdkOAuthProvider = BulkTriggerHistoricalPullBody["provider"];

const JUNCTION_SDK_PROVIDERS = Object.freeze([
  "oura", "fitbit", "garmin", "whoop", "strava", "renpho", "peloton", "wahoo",
  "zwift", "freestyle_libre", "abbott_libreview", "tandem_source", "freestyle_libre_ble",
  "eight_sleep", "withings", "apple_health_kit", "manual", "ihealth", "google_fit",
  "beurer_api", "beurer_ble", "omron", "omron_ble", "onetouch_ble", "accuchek_ble",
  "contour_ble", "dexcom", "dexcom_v3", "hammerhead", "my_fitness_pal", "health_connect",
  "samsung_health", "polar", "cronometer", "kardia", "whoop_v2", "ultrahuman",
  "my_fitness_pal_v2", "map_my_fitness", "runkeeper",
] as const satisfies readonly JunctionSdkProvider[]);
const JUNCTION_SDK_OAUTH_PROVIDERS = Object.freeze([
  "oura", "fitbit", "garmin", "strava", "wahoo", "ihealth", "withings", "google_fit",
  "dexcom_v3", "polar", "cronometer", "omron", "whoop_v2", "my_fitness_pal_v2",
  "ultrahuman", "runkeeper",
] as const satisfies readonly JunctionSdkOAuthProvider[]);

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_GET_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 5_000;
const MAX_COLLECTION_PAGES = 100;
const MAX_COLLECTION_RECORDS = 25_000;
export const JUNCTION_MAX_USER_PROVIDERS = 64;
const MAX_SDK_COMPAT_RESPONSE_BYTES = 32 * 1_024 * 1_024;
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
    const payload = await this.requestSdkResource<Record<string, unknown> | null>(
      "GET",
      {
        endpointKind: "junction_user_resolve",
        optional404: true,
        signal: options.signal ?? null,
      },
      (clientOptions, requestOptions) => new UserClient(clientOptions)
        .getByClientUserId({ clientUserId }, requestOptions),
    );
    return payload ? parseJunctionUser(payload, "Junction resolve user response") : null;
  }

  async createUser(
    clientUserId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<JunctionUser> {
    const payload = await this.requestSdkResource<Record<string, unknown>>(
      "POST",
      {
        bodyFieldNames: ["client_user_id"],
        endpointKind: "junction_user_create",
        signal: options.signal ?? null,
      },
      (clientOptions, requestOptions) => new UserClient(clientOptions)
        .create({ clientUserId }, requestOptions),
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
    const provider = normalizeJunctionProviderSlug(input.provider);
    const sdkProvider = provider ? requireJunctionSdkProvider(provider) : undefined;
    const providerFilter = input.providerFilter?.map((candidate) =>
      requireJunctionSdkProvider(normalizeRequiredProviderSlug(candidate))
    );
    const bodyFieldNames = ["user_id", "redirect_url"];
    if (sdkProvider) {
      bodyFieldNames.push("provider");
    } else if (providerFilter && providerFilter.length > 0) {
      bodyFieldNames.push("filter_on_providers");
    }

    const payload = await this.requestSdkResource<Record<string, unknown>>(
      "POST",
      {
        bodyFieldNames,
        endpointKind: "junction_link_token_create",
        signal: input.signal ?? null,
      },
      (clientOptions, requestOptions) => {
        const request: LinkTokenExchange = {
          userId: input.userId,
          redirectUrl: input.callbackUrl,
        };
        if (sdkProvider) {
          request.provider = sdkProvider;
        } else if (providerFilter && providerFilter.length > 0) {
          request.filterOnProviders = providerFilter;
        }
        return new LinkClient(clientOptions).token(request, requestOptions);
      },
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

    const payload = await this.requestSdkResource<Record<string, unknown>>(
      "POST",
      {
        endpointKind: "junction_user_sign_in_token",
        signal: options.signal ?? null,
      },
      (clientOptions, requestOptions) => new UserClient(clientOptions).getUserSignInToken(
        { userId: normalizedUserId },
        requestOptions,
      ),
    );
    const signInToken = normalizeString(payload.sign_in_token) ?? normalizeString(payload.signInToken);
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
    options: {
      collectionWorkLimit?: JunctionCollectionWorkLimit;
      signal?: AbortSignal | null;
    } = {},
  ): Promise<JunctionProviderConnection[]> {
    const payload = await this.requestSdkResource<unknown>(
      "GET",
      {
        endpointKind: "junction_user_providers",
        signal: options.signal ?? null,
        ...(options.collectionWorkLimit
          ? {
              maxAttempts: options.collectionWorkLimit.maxAttemptsPerPage,
              timeoutMs: options.collectionWorkLimit.requestTimeoutMs,
            }
          : {}),
      },
      (clientOptions, requestOptions) => new UserClient(clientOptions)
        .getConnectedProviders({ userId }, requestOptions),
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

    await this.requestSdkResource<unknown>(
      "DELETE",
      { endpointKind: "junction_user_provider_deregister", signal: input.signal ?? null },
      (clientOptions, requestOptions) => new UserClient(clientOptions).deregisterProvider({
        provider: requireJunctionSdkProvider(providerSlug),
        userId,
      }, requestOptions),
    );
  }

  async listUserDevices(
    userId: string,
    options: { signal?: AbortSignal | null } = {},
  ): Promise<unknown[]> {
    const payload = await this.requestSdkResource<unknown>(
      "GET",
      { endpointKind: "junction_user_devices", signal: options.signal ?? null },
      (clientOptions, requestOptions) => new UserClient(clientOptions)
        .getDevices({ userId }, requestOptions),
    );
    return extractCollectionRecords(payload);
  }

  async listSummary(input: JunctionWindowInput): Promise<unknown[]> {
    if (input.resource === "profile") {
      return this.listProfileSummary(input);
    }
    return this.fetchWindowedCollection(
      { ...input, dateQueryFormat: resolveJunctionSummaryDateQueryFormat(input) },
      extractCollectionRecords,
      (cursor) => this.requestSummaryPage(input, cursor),
    );
  }

  async listProfileSummary(input: JunctionProfileSummaryInput): Promise<unknown[]> {
    const provider = optionalJunctionSdkProvider(input.sourceProviderSlug);
    const payload = await this.requestSdkResource<unknown>(
      "GET",
      {
        endpointKind: "junction_summary_collection",
        queryParameterNames: provider ? ["provider"] : [],
        signal: input.signal ?? null,
        ...(input.collectionWorkLimit
          ? {
              maxAttempts: input.collectionWorkLimit.maxAttemptsPerPage,
              timeoutMs: input.collectionWorkLimit.requestTimeoutMs,
            }
          : {}),
      },
      (clientOptions, requestOptions) => {
        const request: GetProfileRequest = { userId: input.userId };
        if (provider) {
          request.provider = provider;
        }
        return new ProfileClient(clientOptions).get(request, requestOptions);
      },
    );
    return extractCollectionRecords(payload, "profile");
  }

  async listTimeseries(input: JunctionWindowInput): Promise<unknown[]> {
    const policy = resolveJunctionTimeseriesResourcePolicy(input.resource);
    if (policy?.fetchMode === "workout_stream") {
      throw new TypeError(
        "Junction workout_stream uses the dedicated workout stream endpoint.",
      );
    }
    return this.fetchWindowedCollection(
      {
        ...input,
        maxRecords: policy?.maxSamplesPerWindow === undefined
          ? input.maxRecords
          : Math.min(input.maxRecords ?? policy.maxSamplesPerWindow, policy.maxSamplesPerWindow),
      },
      input.requireStructurallyCompleteCollection
        ? (payload, resource) => extractStructurallyCompleteTimeseriesRecords(
            payload,
            resource,
            normalizeSourceSlug(input.sourceProviderSlug),
          )
        : extractTimeseriesRecords,
      (cursor) => this.requestTimeseriesPage(input, cursor),
    );
  }

  async getWorkoutStream(input: JunctionWorkoutStreamInput): Promise<unknown> {
    const workoutId = normalizeString(input.workoutId);
    if (!workoutId) {
      throw new TypeError("Junction workout stream requires a workout id.");
    }
    return this.requestSdkResource<unknown>(
      "GET",
      {
        endpointKind: "junction_workout_stream",
        signal: input.signal ?? null,
        ...(input.collectionWorkLimit
          ? {
              maxAttempts: input.collectionWorkLimit.maxAttemptsPerPage,
              timeoutMs: input.collectionWorkLimit.requestTimeoutMs,
            }
          : {}),
      },
      (clientOptions, requestOptions) => new WorkoutsClient(clientOptions)
        .getByWorkoutId({ workoutId }, requestOptions),
    );
  }

  async introspectResources(input: JunctionIntrospectionInput): Promise<unknown> {
    const provider = optionalJunctionSdkProvider(input.sourceProviderSlug);
    return this.requestSdkResource<unknown>(
      "GET",
      {
        endpointKind: "junction_introspect_resources",
        queryParameterNames: ["user_id", "user_limit", ...(provider ? ["provider"] : [])],
        signal: input.signal ?? null,
      },
      (clientOptions, requestOptions) => {
        const request: GetUserResourcesIntrospectRequest = {
          userId: input.userId,
          userLimit: input.userLimit ?? 1,
        };
        if (provider) {
          request.provider = provider;
        }
        return new IntrospectClient(clientOptions).getUserResources(request, requestOptions);
      },
    );
  }

  async introspectHistoricalPull(
    input: JunctionIntrospectionInput,
  ): Promise<JunctionHistoricalPullSnapshot> {
    const provider = optionalJunctionSdkProvider(input.sourceProviderSlug);
    const payload = await this.requestSdkResource<unknown>(
      "GET",
      {
        endpointKind: "junction_introspect_historical_pull",
        queryParameterNames: ["user_id", "user_limit", ...(provider ? ["provider"] : [])],
        signal: input.signal ?? null,
      },
      (clientOptions, requestOptions) => {
        const request: GetUserHistoricalPullsIntrospectRequest = {
          userId: input.userId,
          userLimit: input.userLimit ?? 1,
        };
        if (provider) {
          request.provider = provider;
        }
        return new IntrospectClient(clientOptions).getUserHistoricalPulls(request, requestOptions);
      },
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
    const userIds = [...new Set(input.userIds
      .map((userId) => normalizeString(userId))
      .filter((userId): userId is string => typeof userId === "string"))];
    if (userIds.length === 0) {
      throw new TypeError("Junction historical pull triggers require at least one user id.");
    }

    try {
      await this.requestSdkResource<unknown>(
        "POST",
        {
          bodyFieldNames: ["provider", "user_ids"],
          endpointKind: "junction_bulk_trigger_historical_pull",
          signal: input.signal ?? null,
        },
        (clientOptions, requestOptions) => new LinkClient(clientOptions).bulkTriggerHistoricalPull({
          provider: requireJunctionSdkOAuthProvider(sourceProviderSlug),
          userIds,
        }, requestOptions),
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
    const timeout = normalizeJunctionRefreshTimeoutSeconds(input.timeoutSeconds);
    return this.requestSdkResource<unknown>(
      "POST",
      {
        endpointKind: "junction_user_refresh",
        queryParameterNames: timeout === null ? [] : ["timeout"],
        signal: input.signal ?? null,
      },
      (clientOptions, requestOptions) => {
        const request: RefreshUserRequest = { userId: input.userId };
        if (timeout !== null) {
          request.timeout = timeout;
        }
        return new UserClient(clientOptions).refresh(request, requestOptions);
      },
    );
  }

  private async fetchWindowedCollection(
    input: JunctionWindowInput,
    extractRecords: (payload: unknown, resource: string) => unknown[],
    requestPage: (cursor: string | null) => Promise<unknown>,
  ): Promise<unknown[]> {
    const records: unknown[] = [];
    let cursor: string | null = null;
    let pages = 0;
    const pageLimit = input.collectionWorkLimit?.maxPages ?? MAX_COLLECTION_PAGES;

    do {
      if (pages >= pageLimit) {
        throw deviceSyncError({
          code: input.collectionWorkLimit
            ? "JUNCTION_API_WINDOW_TOO_LARGE"
            : "JUNCTION_API_PAGINATION_LIMIT",
          message: `Junction ${input.resource} response exceeded the page budget for one complete window.`,
          retryable: true,
          httpStatus: 502,
        });
      }
      const payload = await requestPage(cursor);
      const maxRecords = input.maxRecords ?? MAX_COLLECTION_RECORDS;
      if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
        throw new TypeError("Junction collection record limit must be a positive integer.");
      }
      for (const record of extractRecords(payload, input.resource)) {
        if (records.length >= maxRecords) {
          throw deviceSyncError({
            code: "JUNCTION_API_RECORD_LIMIT",
            message: `Junction ${input.resource} response exceeded the configured record limit.`,
            retryable: true,
            httpStatus: 502,
          });
        }
        records.push(record);
      }
      pages += 1;
      cursor = extractNextCursor(payload);
    } while (cursor);

    return records;
  }

  private requestSummaryPage(input: JunctionWindowInput, cursor: string | null): Promise<unknown> {
    const format = resolveJunctionSummaryDateQueryFormat(input);
    const provider = optionalJunctionSdkProvider(input.sourceProviderSlug);
    const request: GetActivityRequest = {
      userId: input.userId,
      startDate: toDateParameter(input.windowStart, format, "start"),
      endDate: toDateParameter(input.windowEnd, format, "end"),
    };
    if (provider) {
      request.provider = provider;
    }
    const queryParameterNames = [
      "start_date",
      "end_date",
      ...(provider ? ["provider"] : []),
      ...(cursor ? ["next_cursor"] : []),
    ];
    return this.requestSdkResource<unknown>(
      "GET",
      {
        endpointKind: "junction_summary_collection",
        queryParameterNames,
        signal: input.signal ?? null,
        ...(input.collectionWorkLimit
          ? {
              maxAttempts: input.collectionWorkLimit.maxAttemptsPerPage,
              timeoutMs: input.collectionWorkLimit.requestTimeoutMs,
            }
          : {}),
      },
      (clientOptions, requestOptions) => {
        if (cursor) {
          requestOptions.queryParams = { next_cursor: cursor };
        }
        switch (input.resource) {
          case "activity": return new ActivityClient(clientOptions).get(request, requestOptions);
          case "sleep": return new SleepClient(clientOptions).get(request, requestOptions);
          case "sleep_cycle": return new SleepCycleClient(clientOptions).get(request, requestOptions);
          case "workouts": return new WorkoutsClient(clientOptions).get(request, requestOptions);
          case "body": return new BodyClient(clientOptions).get(request, requestOptions);
          case "meal": return new MealClient(clientOptions).get(request, requestOptions);
          case "menstrual_cycle": return new MenstrualCycleClient(clientOptions).get(request, requestOptions);
          case "electrocardiogram": return new ElectrocardiogramClient(clientOptions).get(request, requestOptions);
          default: throw new TypeError(`Unsupported Junction summary resource: ${input.resource}`);
        }
      },
    );
  }

  private requestTimeseriesPage(input: JunctionWindowInput, cursor: string | null): Promise<unknown> {
    const provider = optionalJunctionSdkProvider(input.sourceProviderSlug);
    const request: StepsGroupedVitalsRequest = {
      userId: input.userId,
      startDate: toDateParameter(input.windowStart, input.dateQueryFormat ?? "datetime", "start"),
      endDate: toDateParameter(input.windowEnd, input.dateQueryFormat ?? "datetime", "end"),
    };
    if (cursor) {
      request.nextCursor = cursor;
    }
    if (provider) {
      request.provider = provider;
    }
    const queryParameterNames = [
      "start_date",
      "end_date",
      ...(provider ? ["provider"] : []),
      ...(cursor ? ["next_cursor"] : []),
    ];
    return this.requestSdkResource<unknown>(
      "GET",
      {
        endpointKind: "junction_timeseries_collection",
        queryParameterNames,
        signal: input.signal ?? null,
      },
      (clientOptions, requestOptions) => {
        const client = new VitalsClient(clientOptions);
        switch (input.resource) {
          case "steps": return client.stepsGrouped(request, requestOptions);
          case "distance": return client.distanceGrouped(request, requestOptions);
          case "calories_active": return client.caloriesActiveGrouped(request, requestOptions);
          case "heartrate": return client.heartrateGrouped(request, requestOptions);
          case "hrv": return client.hrvGrouped(request, requestOptions);
          case "respiratory_rate": return client.respiratoryRateGrouped(request, requestOptions);
          case "blood_oxygen": return client.bloodOxygenGrouped(request, requestOptions);
          case "stress_level": return client.stressLevelGrouped(request, requestOptions);
          case "vo2_max": return client.vo2MaxGrouped(request, requestOptions);
          case "weight": return client.bodyWeightGrouped(request, requestOptions);
          case "body_temperature_delta": return client.bodyTemperatureDeltaGrouped(request, requestOptions);
          case "body_temperature": return client.bodyTemperatureGrouped(request, requestOptions);
          case "basal_body_temperature": return client.basalBodyTemperatureGrouped(request, requestOptions);
          case "caffeine": return client.caffeineGrouped(request, requestOptions);
          case "water": return client.waterGrouped(request, requestOptions);
          case "mindfulness_minutes": return client.mindfulnessMinutesGrouped(request, requestOptions);
          case "heart_rate_recovery_one_minute": return client.heartRateRecoveryOneMinuteGrouped(request, requestOptions);
          case "sleep_breathing_disturbance": return client.sleepBreathingDisturbanceGrouped(request, requestOptions);
          case "afib_burden": return client.afibBurdenGrouped(request, requestOptions);
          case "glucose": return client.glucoseGrouped(request, requestOptions);
          case "blood_pressure": return client.bloodPressureGrouped(request, requestOptions);
          case "note": return client.noteGrouped(request, requestOptions);
          case "body_mass_index": return client.bodyMassIndexGrouped(request, requestOptions);
          case "carbohydrates": return client.carbohydratesGrouped(request, requestOptions);
          case "fat": return client.bodyFatGrouped(request, requestOptions);
          case "forced_expiratory_volume_1": return client.forcedExpiratoryVolume1Grouped(request, requestOptions);
          case "forced_vital_capacity": return client.forcedVitalCapacityGrouped(request, requestOptions);
          case "heart_rate_alert": return client.heartRateAlertGrouped(request, requestOptions);
          case "inhaler_usage": return client.inhalerUsageGrouped(request, requestOptions);
          case "insulin_injection": return client.insulinInjectionGrouped(request, requestOptions);
          case "lean_body_mass": return client.leanBodyMassGrouped(request, requestOptions);
          case "peak_expiratory_flow_rate": return client.peakExpiratoryFlowRateGrouped(request, requestOptions);
          case "sleep_apnea_alert": return client.sleepApneaAlertGrouped(request, requestOptions);
          case "waist_circumference": return client.waistCircumferenceGrouped(request, requestOptions);
          case "calories_basal": return client.caloriesBasalGrouped(request, requestOptions);
          case "daylight_exposure": return client.daylightExposureGrouped(request, requestOptions);
          case "fall": return client.fallGrouped(request, requestOptions);
          case "floors_climbed": return client.floorsClimbedGrouped(request, requestOptions);
          case "handwashing": return client.handwashingGrouped(request, requestOptions);
          case "stand_duration": return client.standDurationGrouped(request, requestOptions);
          case "stand_hour": return client.standHourGrouped(request, requestOptions);
          case "uv_exposure": return client.uvExposureGrouped(request, requestOptions);
          case "wheelchair_push": return client.wheelchairPushGrouped(request, requestOptions);
          case "workout_distance": return client.workoutDistanceGrouped(request, requestOptions);
          case "workout_duration": return client.workoutDurationGrouped(request, requestOptions);
          case "workout_swimming_stroke": return client.workoutSwimmingStrokeGrouped(request, requestOptions);
          case "electrocardiogram_voltage": return client.electrocardiogramVoltageGrouped(request, requestOptions);
          default: throw new TypeError(`Unsupported Junction timeseries resource: ${input.resource}`);
        }
      },
    );
  }

  private async requestSdkResource<T>(
    method: "DELETE" | "GET" | "POST",
    options: {
      bodyFieldNames?: readonly string[];
      endpointKind: string;
      maxAttempts?: number;
      optional404?: boolean;
      queryParameterNames?: readonly string[];
      signal?: AbortSignal | null;
      timeoutMs?: number;
    },
    invoke: (
      clientOptions: JunctionSdkClientOptions,
      requestOptions: JunctionSdkRequestOptions,
    ) => PromiseLike<unknown>,
  ): Promise<T> {
    const attempts = method === "GET"
      ? options.maxAttempts ?? MAX_GET_ATTEMPTS
      : 1;
    let lastError: unknown;
    const hasJsonBody = (options.bodyFieldNames?.length ?? 0) > 0;
    const requestDiagnostics = buildProviderRequestDiagnostics({
      method,
      endpointKind: options.endpointKind,
      authKind: "provider_config_api_key_header",
      authPlacement: "headers",
      credentialPresent: Boolean(this.apiKey),
      contentType: hasJsonBody ? "application_json" : "none",
      bodyKind: hasJsonBody ? "json_object" : "none",
      bodyFieldNames: options.bodyFieldNames ?? [],
      queryParameterNames: options.queryParameterNames ?? [],
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      throwIfProviderRequestAborted(options.signal);
      const requestAbort = createProviderRequestAbortSignal({
        signal: options.signal ?? null,
        timeoutMs: options.timeoutMs ?? this.requestTimeoutMs,
      });
      let capturedResponse: JunctionSdkResponseCapture | null = null;
      let observedOptionalNotFound = false;
      const sdkFetch: typeof fetch = async (input, init) => {
        const response = await this.fetchImpl(input, {
          ...init,
          signal: requestAbort.signal,
        });
        if (options.optional404 && response.status === 404) {
          observedOptionalNotFound = true;
          await response.body?.cancel().catch(() => undefined);
          return new Response(null, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText,
          });
        }
        if (!response.body) {
          return response;
        }
        if (junctionSdkResponseExceedsDeclaredLimit(response)) {
          await response.body.cancel().catch(() => undefined);
          throw junctionSdkResponseTooLargeError();
        }

        const capture = createJunctionSdkResponseCapture(response);
        capturedResponse = capture;
        return new Response(
          createJunctionSdkBoundedBodyStream(response.body, capture),
          {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText,
          },
        );
      };
      const timeoutInSeconds = (options.timeoutMs ?? this.requestTimeoutMs) / 1_000;
      const clientOptions: JunctionSdkClientOptions = {
        apiKey: this.apiKey,
        baseUrl: this.baseUrl,
        fetch: sdkFetch,
        headers: { "Content-Type": "application/json" },
        maxRetries: 0,
        timeoutInSeconds,
      };

      try {
        const payload = await invoke(clientOptions, {
          abortSignal: requestAbort.signal,
          maxRetries: 0,
          timeoutInSeconds,
        });
        throwIfProviderRequestAborted(requestAbort.signal);
        return payload as T;
      } catch (error) {
        const providerError = unwrapJunctionSdkErrorCause(error);
        lastError = providerError;

        if (isProviderParentAbortError(providerError, requestAbort.signal)) {
          throw normalizeProviderAbortError(providerError, requestAbort.signal);
        }
        if (
          !requestAbort.signal.aborted
          && options.signal
          && isProviderParentAbortError(providerError, options.signal)
        ) {
          throw normalizeProviderAbortError(providerError, options.signal);
        }
        if (
          requestAbort.signal.aborted
          && isProviderTimeoutError(providerError, requestAbort.signal)
        ) {
          break;
        }

        if (observedOptionalNotFound) {
          throwIfProviderRequestAborted(requestAbort.signal);
          return null as T;
        }

        const sdkFailure = readJunctionSdkHttpFailure(error)
          ?? (error instanceof Error && error.name === "ParseError"
            ? readCapturedJunctionSdkHttpFailure(capturedResponse)
            : null);
        if (options.optional404 && sdkFailure?.response.status === 404) {
          throwIfProviderRequestAborted(requestAbort.signal);
          return null as T;
        }

        if (sdkFailure && !sdkFailure.response.ok) {
          const retryable = method === "GET"
            && (sdkFailure.response.status === 429 || sdkFailure.response.status >= 500);
          if (retryable && attempt < attempts) {
            await waitForProviderRetryDelay(
              resolveRetryDelayMs(sdkFailure.response, attempt),
              options.signal,
            );
            continue;
          }
          throw buildProviderApiError({
            code: "JUNCTION_API_REQUEST_FAILED",
            message: `Junction API request failed for ${options.endpointKind}.`,
            response: sdkFailure.response,
            body: sdkFailure.body,
            retryable,
            httpStatus: 502,
            diagnostics: requestDiagnostics,
          });
        }

        if (sdkFailure?.response.ok) {
          throw invalidJunctionSdkResponseError(sdkFailure.body);
        }

        if (error instanceof Error && error.name === "ParseError") {
          const legacyPayload = readCapturedJunctionSdkSuccess(capturedResponse);
          if (legacyPayload.present) {
            return legacyPayload.payload as T;
          }
          throw invalidJunctionSdkResponseError(legacyPayload.body);
        }

        if (
          error instanceof TypeError
          || (error instanceof Error && error.name === "JsonError")
        ) {
          throw deviceSyncError({
            code: "JUNCTION_SDK_REQUEST_INVALID",
            message: `Junction SDK could not construct ${options.endpointKind}.`,
            retryable: false,
            httpStatus: 502,
            details: requestDiagnostics,
            cause: error,
          });
        }

        if (isDeviceSyncError(providerError)) {
          if (!providerError.retryable || attempt >= attempts) {
            throw providerError;
          }
        } else if (
          attempt >= attempts
          || isJunctionSdkTimeoutError(error)
          || isProviderTimeoutError(providerError, requestAbort.signal)
        ) {
          break;
        }

        await waitForProviderRetryDelay(resolveRetryDelayMs(null, attempt), options.signal);
      } finally {
        requestAbort.cleanup();
      }
    }

    throw deviceSyncError({
      code: "JUNCTION_API_REQUEST_FAILED",
      message: `Junction API request failed for ${options.endpointKind}.`,
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

function unwrapJunctionSdkErrorCause(error: unknown): unknown {
  let current = error;
  const visited = new Set<unknown>();
  while (
    isJunctionSdkErrorWithCause(current)
    && !visited.has(current)
  ) {
    visited.add(current);
    current = current.cause;
  }
  return current;
}

interface JunctionSdkResponseCapture {
  chunks: Uint8Array[];
  complete: boolean;
  exceededLimit: boolean;
  rawResponse: Response;
  totalBytes: number;
}

function createJunctionSdkResponseCapture(response: Response): JunctionSdkResponseCapture {
  return {
    chunks: [],
    complete: false,
    exceededLimit: false,
    // Preserve the runtime's complete Response metadata. Cloudflare extends
    // the standard Response surface (for example with `webSocket`), and the
    // SDK's RawResponse mapped type follows the active runtime definition.
    rawResponse: response,
    totalBytes: 0,
  };
}

function createJunctionSdkBoundedBodyStream(
  body: ReadableStream<Uint8Array>,
  capture: JunctionSdkResponseCapture,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        capture.complete = true;
        controller.close();
        reader.releaseLock();
        return;
      }

      const chunk = value;
      capture.totalBytes += chunk.byteLength;
      if (capture.totalBytes > MAX_SDK_COMPAT_RESPONSE_BYTES) {
        capture.exceededLimit = true;
        capture.chunks = [];
        const error = junctionSdkResponseTooLargeError();
        await reader.cancel(error).catch(() => undefined);
        controller.error(error);
        reader.releaseLock();
        return;
      }
      capture.chunks.push(Uint8Array.from(chunk));
      controller.enqueue(chunk);
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      reader.releaseLock();
    },
  });
}

function junctionSdkResponseExceedsDeclaredLimit(response: Response): boolean {
  const contentLength = response.headers.get("content-length");
  if (contentLength === null || !/^\d+$/u.test(contentLength.trim())) {
    return false;
  }
  const parsedLength = Number(contentLength);
  return Number.isSafeInteger(parsedLength) && parsedLength > MAX_SDK_COMPAT_RESPONSE_BYTES;
}

function junctionSdkResponseTooLargeError() {
  return deviceSyncError({
    code: "JUNCTION_API_RESPONSE_TOO_LARGE",
    message: "Junction API response exceeded the configured size limit.",
    retryable: false,
    httpStatus: 502,
  });
}

function readCapturedJunctionSdkSuccess(
  capture: JunctionSdkResponseCapture | null,
): { body: string; payload: unknown; present: boolean } {
  if (!capture || capture.rawResponse.status < 200 || capture.rawResponse.status >= 300) {
    return { body: "", payload: null, present: false };
  }
  return readCapturedJunctionSdkBody(capture);
}

function readCapturedJunctionSdkHttpFailure(
  capture: JunctionSdkResponseCapture | null,
): { body: string; response: Response } | null {
  if (!capture || capture.rawResponse.status < 300) {
    return null;
  }
  const body = readCapturedJunctionSdkText(capture);
  if (body === null) {
    return null;
  }
  return {
    body,
    response: new Response(null, {
      headers: capture.rawResponse.headers,
      status: capture.rawResponse.status,
      statusText: capture.rawResponse.statusText,
    }),
  };
}

function readCapturedJunctionSdkBody(
  capture: JunctionSdkResponseCapture,
): { body: string; payload: unknown; present: boolean } {
  const body = readCapturedJunctionSdkText(capture);
  if (body === null) {
    return { body: "", payload: null, present: false };
  }
  if (!body.trim()) {
    return { body, payload: null, present: true };
  }
  try {
    return { body, payload: JSON.parse(body), present: true };
  } catch {
    return { body, payload: null, present: false };
  }
}

function readCapturedJunctionSdkText(capture: JunctionSdkResponseCapture): string | null {
  if (!capture.complete || capture.exceededLimit) {
    return null;
  }

  const bodyBytes = new Uint8Array(capture.totalBytes);
  let offset = 0;
  for (const chunk of capture.chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bodyBytes);
}

function readJunctionSdkHttpFailure(
  error: unknown,
): { body: string; response: Response } | null {
  const sdkError = readPlainObject(error);
  if (!sdkError || !isJunctionSdkErrorName(error)) {
    return null;
  }

  const rawResponse = readPlainObject(sdkError.rawResponse);
  const status = sdkError.statusCode ?? rawResponse?.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 599) {
    return null;
  }

  return {
    body: serializeJunctionSdkErrorBody(sdkError.body),
    response: new Response(null, {
      headers: readHeaders(rawResponse?.headers),
      status,
      statusText: normalizeString(rawResponse?.statusText) ?? undefined,
    }),
  };
}

function isJunctionSdkErrorWithCause(error: unknown): error is Error & { cause: unknown } {
  return (isJunctionSdkErrorName(error) || isJunctionSdkTimeoutError(error))
    && error.cause !== undefined;
}

function isJunctionSdkErrorName(error: unknown): error is Error {
  return error instanceof Error && (
    error.name === "JunctionError"
    || error.name === "BadRequestError"
    || error.name === "NotFoundError"
    || error.name === "UnprocessableEntityError"
  );
}

function isJunctionSdkTimeoutError(error: unknown): error is Error {
  return error instanceof Error && error.name === "JunctionTimeoutError";
}

function readHeaders(value: unknown): HeadersInit | undefined {
  return value instanceof Headers ? value : undefined;
}

function serializeJunctionSdkErrorBody(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body === null || body === undefined) {
    return "";
  }
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

function invalidJunctionSdkResponseError(body: string) {
  if (body.trim()) {
    try {
      JSON.parse(body);
    } catch (error) {
      return deviceSyncError({
        code: "JUNCTION_API_INVALID_JSON",
        message: "Junction API response was not valid JSON.",
        retryable: false,
        httpStatus: 502,
        cause: error,
      });
    }
  }

  return deviceSyncError({
    code: "JUNCTION_API_RESPONSE_INVALID",
    message: "Junction API response did not match the documented response shape.",
    retryable: false,
    httpStatus: 502,
  });
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

export function resolveJunctionTimeseriesApiResource(resource: string): string {
  switch (resource) {
    case "fat":
      return "body_fat";
    case "weight":
      return "body_weight";
    default:
      return resource;
  }
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

function normalizeRequiredProviderSlug(value: unknown): string {
  const provider = normalizeJunctionProviderSlug(value);
  if (!provider) {
    throw new TypeError("Junction provider value is invalid.");
  }
  return provider;
}

function optionalJunctionSdkProvider(value: unknown): JunctionSdkProvider | undefined {
  const normalized = normalizeJunctionProviderSlug(value);
  return normalized ? requireJunctionSdkProvider(normalized) : undefined;
}

function requireJunctionSdkProvider(value: string): JunctionSdkProvider {
  const route = resolveJunctionDeviceConnectRouteByProviderSlug(value);
  const canonicalValue = route?.route.sourceProviderSlug ?? value;

  const provider = JUNCTION_SDK_PROVIDERS.find((candidate) => candidate === canonicalValue);
  if (provider) {
    return provider;
  }
  throw new TypeError(`Unsupported Junction provider slug: ${value}`);
}

function requireJunctionSdkOAuthProvider(value: string): JunctionSdkOAuthProvider {
  const route = resolveJunctionDeviceConnectRouteByProviderSlug(value);
  const canonicalValue = route?.route.sourceProviderSlug ?? value;

  const provider = JUNCTION_SDK_OAUTH_PROVIDERS.find((candidate) => candidate === canonicalValue);
  if (provider) {
    return provider;
  }
  throw new TypeError(`Unsupported Junction OAuth provider slug: ${value}`);
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
  const records = extractCollectionRecords(payload);
  return records
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

      const rawNotPulled = details.not_pulled ?? details.notPulled;
      const notPulledResources = Array.isArray(rawNotPulled)
        ? [...new Set(rawNotPulled.flatMap((resource) => {
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
                normalizeJunctionDateString(statistics.range_end)
                ?? normalizeJunctionDateString(statistics.rangeEnd)
                ?? null,
              rangeStart:
                normalizeJunctionDateString(statistics.range_start)
                ?? normalizeJunctionDateString(statistics.rangeStart)
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
  const erroredAt = normalizeJunctionDateString(details.errored_at ?? details.erroredAt);
  if (!errorType && !errorMessage && !erroredAt) {
    return null;
  }

  return { errorType, errorMessage, erroredAt };
}

function normalizeJunctionDateString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  return normalizeString(value) ?? null;
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

  if (!resource) {
    const providerCollections = Object.values(record).filter(
      (candidate): candidate is unknown[] => Array.isArray(candidate),
    );
    if (providerCollections.length > 0) {
      return providerCollections.flat();
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

function extractStructurallyCompleteTimeseriesRecords(
  payload: unknown,
  resource: string,
  requestedSourceProviderSlug: string | null,
): unknown[] {
  const groupedRecords = flattenGroupedTimeseries(resource, payload, {
    strict: true,
  });
  const records = groupedRecords ?? extractCollectionRecords(payload, resource);
  if (
    groupedRecords === null
    && (!payload || typeof payload !== "object")
  ) {
    throw incompleteJunctionCalendarCollectionError();
  }

  for (const record of records) {
    const entry = readPlainObject(record);
    const sourceProviderSlug = entry
      ? normalizeSourceSlug(resolveJunctionOrigin(entry).sourceProviderSlug)
      : null;
    if (!entry || (requestedSourceProviderSlug && !sourceProviderSlug)) {
      throw incompleteJunctionCalendarCollectionError();
    }
  }
  return records;
}

function flattenGroupedTimeseries(
  resource: string,
  payload: unknown,
  options: {
    strict?: boolean;
  } = {},
): unknown[] | null {
  const envelope = readPlainObject(payload);
  if (options.strict && envelope && "groups" in envelope && !readPlainObject(envelope.groups)) {
    throw incompleteJunctionCalendarCollectionError();
  }
  const groups = readPlainObject(envelope?.groups);
  if (!groups) {
    return null;
  }

  const records: unknown[] = [];

  for (const [sourceSlug, rawGroups] of Object.entries(groups)) {
    const normalizedGroupedSourceSlug = normalizeSourceSlug(sourceSlug);
    if (options.strict && !normalizedGroupedSourceSlug) {
      throw incompleteJunctionCalendarCollectionError();
    }
    if (options.strict && (rawGroups === undefined || rawGroups === null)) {
      throw incompleteJunctionCalendarCollectionError();
    }
    for (const rawGroup of asArray(rawGroups)) {
      const group = readPlainObject(rawGroup);
      if (!group) {
        if (options.strict) {
          throw incompleteJunctionCalendarCollectionError();
        }
        if (resource === "electrocardiogram_voltage") {
          throw new TypeError("Junction ECG group must be an object.");
        }
        continue;
      }
      if (
        options.strict
        && (!("data" in group) || group.data === undefined || group.data === null)
      ) {
        throw incompleteJunctionCalendarCollectionError();
      }

      const groupId = firstDefinedString(group, ["id", "recordingId", "recording_id"]);
      if (resource === "electrocardiogram_voltage" && !groupId) {
        throw new TypeError("Junction ECG group lacked a stable recording id.");
      }
      if (resource === "electrocardiogram_voltage" && !Array.isArray(group.data)) {
        throw new TypeError("Junction ECG group data must be an array.");
      }

      for (const rawSample of asArray(group.data)) {
        const sample = readPlainObject(rawSample);
        if (!sample) {
          if (options.strict) {
            throw incompleteJunctionCalendarCollectionError();
          }
          if (resource === "electrocardiogram_voltage") {
            throw new TypeError("Junction ECG sample must be an object.");
          }
          continue;
        }

        const sampleId = firstDefinedString(sample, ["recordingId", "recording_id"]);
        if (
          resource === "electrocardiogram_voltage"
          && sampleId
          && sampleId !== groupId
        ) {
          throw new TypeError("Junction ECG sample conflicted with its group recording id.");
        }

        const origin = resolveJunctionOrigin(sample, {
          ...group,
          groupedSourceSlug: normalizedGroupedSourceSlug ?? sourceSlug,
        });
        const sourceProviderSlug = normalizeSourceSlug(origin.sourceProviderSlug);
        if (options.strict && !sourceProviderSlug) {
          throw incompleteJunctionCalendarCollectionError();
        }
        records.push(stripUndefinedRecord({
          ...sample,
          sourceProviderSlug: sourceProviderSlug ?? undefined,
          junctionGroupId: resource === "electrocardiogram_voltage"
            ? groupId
            : undefined,
          sourceType: origin.sourceType,
          sourceInstanceId: origin.sourceInstanceId,
          junctionResource: resource,
        }));
      }
    }
  }

  return records;
}

function incompleteJunctionCalendarCollectionError() {
  return deviceSyncError({
    code: "JUNCTION_CALENDAR_REFRESH_INCOMPLETE_NORMALIZATION",
    message: "Junction calendar refresh response was not structurally complete.",
    retryable: true,
    httpStatus: 502,
  });
}

function firstDefinedValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function firstDefinedString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  return normalizeString(firstDefinedValue(record, keys));
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
