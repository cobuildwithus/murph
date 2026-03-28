import { deviceSyncError } from "../errors.ts";
import { coerceRecord, normalizeIdentifier, normalizeString } from "../shared.ts";
import { buildProviderApiError, parseResponseBody } from "./shared-oauth.ts";

const OURA_API_BASE_URL = "https://api.ouraring.com";
const OURA_WEBHOOK_SUBSCRIPTION_PATH = "/v2/webhook/subscription";
const OURA_WEBHOOK_SUBSCRIPTION_RENEW_PATH = "/v2/webhook/subscription/renew";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RENEW_IF_EXPIRING_WITHIN_MS = 7 * 24 * 60 * 60_000;

export const OURA_WEBHOOK_EVENT_TYPES = Object.freeze(["create", "update", "delete"] as const);
export type OuraWebhookOperation = (typeof OURA_WEBHOOK_EVENT_TYPES)[number];

export const OURA_DEFAULT_WEBHOOK_DATA_TYPES = Object.freeze([
  "daily_activity",
  "daily_readiness",
  "daily_sleep",
  "daily_spo2",
  "heartrate",
  "session",
  "sleep",
  "workout",
] as const);
export type OuraWebhookDataType = (typeof OURA_DEFAULT_WEBHOOK_DATA_TYPES)[number] | (string & {});

export interface OuraWebhookTarget {
  eventType: OuraWebhookOperation;
  dataType: OuraWebhookDataType;
}

export const OURA_DEFAULT_WEBHOOK_TARGETS: readonly OuraWebhookTarget[] = Object.freeze(
  OURA_DEFAULT_WEBHOOK_DATA_TYPES.flatMap((dataType): OuraWebhookTarget[] =>
    OURA_WEBHOOK_EVENT_TYPES.map((eventType) => ({
      eventType,
      dataType,
    })),
  ),
);

export interface OuraWebhookSubscription {
  id: string;
  callbackUrl: string;
  eventType: OuraWebhookOperation;
  dataType: OuraWebhookDataType;
  expirationTime: string | null;
}

export interface OuraWebhookEnsureResult {
  retained: OuraWebhookSubscription[];
  created: OuraWebhookSubscription[];
  renewed: OuraWebhookSubscription[];
  deleted: OuraWebhookSubscription[];
}

export interface OuraWebhookSubscriptionClient {
  list(): Promise<OuraWebhookSubscription[]>;
  create(input: {
    callbackUrl: string;
    verificationToken: string;
    eventType: OuraWebhookOperation;
    dataType: OuraWebhookDataType;
  }): Promise<OuraWebhookSubscription>;
  renew(id: string): Promise<OuraWebhookSubscription>;
  delete(id: string): Promise<void>;
  ensure(input: {
    callbackUrl: string;
    verificationToken: string;
    desired: readonly OuraWebhookTarget[];
    renewIfExpiringWithinMs?: number;
    pruneDuplicates?: boolean;
  }): Promise<OuraWebhookEnsureResult>;
}

export interface CreateOuraWebhookSubscriptionClientInput {
  clientId: string;
  clientSecret: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function buildOuraWebhookSubscriptionApiError(
  code: string,
  message: string,
  response: Response,
  body: string,
  options: { retryable?: boolean } = {},
) {
  return buildProviderApiError(code, message, response, body, {
    retryable: options.retryable ?? (response.status === 429 || response.status >= 500),
  });
}

function normalizeOuraWebhookOperation(value: unknown): OuraWebhookOperation | null {
  const normalized = normalizeString(value)?.toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "create" || normalized === "update" || normalized === "delete") {
    return normalized;
  }

  return null;
}

function normalizeOuraWebhookCallbackUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function createOuraWebhookSubscriptionKey(input: {
  callbackUrl: string;
  eventType: OuraWebhookOperation;
  dataType: OuraWebhookDataType;
}): string {
  return `${normalizeOuraWebhookCallbackUrl(input.callbackUrl)}|${input.eventType}|${input.dataType}`;
}

function parseExpirationTime(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function choosePrimarySubscription(subscriptions: readonly OuraWebhookSubscription[]): OuraWebhookSubscription {
  return [...subscriptions].sort((left, right) => {
    const leftExpiration = parseExpirationTime(left.expirationTime);
    const rightExpiration = parseExpirationTime(right.expirationTime);

    if (leftExpiration !== rightExpiration) {
      if (leftExpiration === null) {
        return 1;
      }

      if (rightExpiration === null) {
        return -1;
      }

      return rightExpiration - leftExpiration;
    }

    return 0;
  })[0]!;
}

function shouldRenewSubscription(subscription: OuraWebhookSubscription, renewIfExpiringWithinMs: number): boolean {
  if (renewIfExpiringWithinMs <= 0) {
    return false;
  }

  const expirationTimeMs = parseExpirationTime(subscription.expirationTime);

  if (expirationTimeMs === null) {
    return true;
  }

  return expirationTimeMs - Date.now() <= renewIfExpiringWithinMs;
}

function extractListEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = coerceRecord(payload);

  if (Array.isArray(record.data)) {
    return record.data;
  }

  if (Array.isArray(record.webhook_subscriptions)) {
    return record.webhook_subscriptions;
  }

  const nestedData = coerceRecord(record.data);

  if (Array.isArray(nestedData.subscriptions)) {
    return nestedData.subscriptions;
  }

  return [];
}

function extractSingleEntry(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload[0] ?? null;
  }

  const record = coerceRecord(payload);
  const nestedData = record.data;

  if (nestedData && typeof nestedData === "object" && !Array.isArray(nestedData)) {
    return nestedData;
  }

  if (Array.isArray(nestedData)) {
    return nestedData[0] ?? null;
  }

  return record;
}

function parseWebhookSubscription(payload: unknown): OuraWebhookSubscription {
  const record = coerceRecord(payload);
  const id = normalizeIdentifier(record.id ?? record.subscription_id ?? record.subscriptionId);
  const callbackUrl = normalizeString(record.callback_url ?? record.callbackUrl ?? record.url);
  const eventType = normalizeOuraWebhookOperation(record.event_type ?? record.eventType);
  const dataType = normalizeString(record.data_type ?? record.dataType) as OuraWebhookDataType | undefined;
  const expirationTime =
    normalizeString(record.expiration_time ?? record.expirationTime ?? record.expires_at ?? record.expiresAt) ?? null;

  if (!id || !callbackUrl || !eventType || !dataType) {
    throw deviceSyncError({
      code: "OURA_WEBHOOK_SUBSCRIPTION_RESPONSE_INVALID",
      message: "Oura webhook subscription response was missing id, callback_url, event_type, or data_type.",
      retryable: false,
      httpStatus: 502,
    });
  }

  return {
    id,
    callbackUrl: normalizeOuraWebhookCallbackUrl(callbackUrl),
    eventType,
    dataType,
    expirationTime,
  };
}

function normalizeDesiredTargets(desired: readonly OuraWebhookTarget[]): OuraWebhookTarget[] {
  const seen = new Set<string>();
  const normalizedTargets: OuraWebhookTarget[] = [];

  for (const entry of desired) {
    const eventType = normalizeOuraWebhookOperation(entry.eventType);
    const dataType = normalizeString(entry.dataType) as OuraWebhookDataType | undefined;

    if (!eventType || !dataType) {
      throw deviceSyncError({
        code: "OURA_WEBHOOK_TARGET_INVALID",
        message: "Oura webhook ensure targets require non-empty eventType and dataType values.",
        retryable: false,
        httpStatus: 500,
      });
    }

    const dedupeKey = `${eventType}|${dataType}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    normalizedTargets.push({
      eventType,
      dataType,
    });
  }

  return normalizedTargets;
}

export function createOuraWebhookSubscriptionClient(
  input: CreateOuraWebhookSubscriptionClientInput,
): OuraWebhookSubscriptionClient {
  const apiBaseUrl = (input.apiBaseUrl ?? OURA_API_BASE_URL).replace(/\/+$/u, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  async function requestJson<T>(options: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    body?: Record<string, unknown>;
    buildError: (response: Response, body: string) => Error;
  }): Promise<T | null> {
    const headers = new Headers({
      "x-client-id": input.clientId,
      "x-client-secret": input.clientSecret,
    });

    if (options.body) {
      headers.set("content-type", "application/json");
    }

    const response = await fetchImpl(`${apiBaseUrl}${options.path}`, {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw options.buildError(response, await parseResponseBody(response));
    }

    if (response.status === 204) {
      return null;
    }

    return (await response.json()) as T;
  }

  async function list(): Promise<OuraWebhookSubscription[]> {
    const payload = await requestJson<unknown>({
      method: "GET",
      path: OURA_WEBHOOK_SUBSCRIPTION_PATH,
      buildError: (response, body) =>
        buildOuraWebhookSubscriptionApiError(
          "OURA_WEBHOOK_SUBSCRIPTIONS_LIST_FAILED",
          "Oura webhook subscriptions could not be listed.",
          response,
          body,
        ),
    });

    return extractListEntries(payload).map((entry) => parseWebhookSubscription(entry));
  }

  async function create(subscription: {
    callbackUrl: string;
    verificationToken: string;
    eventType: OuraWebhookOperation;
    dataType: OuraWebhookDataType;
  }): Promise<OuraWebhookSubscription> {
    const callbackUrl = normalizeOuraWebhookCallbackUrl(subscription.callbackUrl);
    const verificationToken = normalizeString(subscription.verificationToken);
    const eventType = normalizeOuraWebhookOperation(subscription.eventType);
    const dataType = normalizeString(subscription.dataType) as OuraWebhookDataType | undefined;

    if (!verificationToken || !eventType || !dataType) {
      throw deviceSyncError({
        code: "OURA_WEBHOOK_SUBSCRIPTION_CREATE_INVALID",
        message: "Oura webhook subscription create requires callbackUrl, verificationToken, eventType, and dataType.",
        retryable: false,
        httpStatus: 500,
      });
    }

    const payload = await requestJson<unknown>({
      method: "POST",
      path: OURA_WEBHOOK_SUBSCRIPTION_PATH,
      body: {
        callback_url: callbackUrl,
        verification_token: verificationToken,
        event_type: eventType,
        data_type: dataType,
      },
      buildError: (response, body) =>
        buildOuraWebhookSubscriptionApiError(
          "OURA_WEBHOOK_SUBSCRIPTION_CREATE_FAILED",
          "Oura webhook subscription could not be created.",
          response,
          body,
        ),
    });

    return parseWebhookSubscription(extractSingleEntry(payload));
  }

  async function renew(id: string): Promise<OuraWebhookSubscription> {
    const normalizedId = normalizeIdentifier(id);

    if (!normalizedId) {
      throw deviceSyncError({
        code: "OURA_WEBHOOK_SUBSCRIPTION_ID_INVALID",
        message: "Oura webhook subscription renew requires a subscription id.",
        retryable: false,
        httpStatus: 500,
      });
    }

    const payload = await requestJson<unknown>({
      method: "PUT",
      path: `${OURA_WEBHOOK_SUBSCRIPTION_RENEW_PATH}/${encodeURIComponent(normalizedId)}`,
      buildError: (response, body) =>
        buildOuraWebhookSubscriptionApiError(
          "OURA_WEBHOOK_SUBSCRIPTION_RENEW_FAILED",
          "Oura webhook subscription could not be renewed.",
          response,
          body,
        ),
    });

    return parseWebhookSubscription(extractSingleEntry(payload));
  }

  async function remove(id: string): Promise<void> {
    const normalizedId = normalizeIdentifier(id);

    if (!normalizedId) {
      throw deviceSyncError({
        code: "OURA_WEBHOOK_SUBSCRIPTION_ID_INVALID",
        message: "Oura webhook subscription delete requires a subscription id.",
        retryable: false,
        httpStatus: 500,
      });
    }

    await requestJson<unknown>({
      method: "DELETE",
      path: `${OURA_WEBHOOK_SUBSCRIPTION_PATH}/${encodeURIComponent(normalizedId)}`,
      buildError: (response, body) =>
        buildOuraWebhookSubscriptionApiError(
          "OURA_WEBHOOK_SUBSCRIPTION_DELETE_FAILED",
          "Oura webhook subscription could not be deleted.",
          response,
          body,
        ),
    });
  }

  async function ensure(options: {
    callbackUrl: string;
    verificationToken: string;
    desired: readonly OuraWebhookTarget[];
    renewIfExpiringWithinMs?: number;
    pruneDuplicates?: boolean;
  }): Promise<OuraWebhookEnsureResult> {
    const callbackUrl = normalizeOuraWebhookCallbackUrl(options.callbackUrl);
    const verificationToken = normalizeString(options.verificationToken);
    const renewIfExpiringWithinMs = Math.max(
      0,
      options.renewIfExpiringWithinMs ?? DEFAULT_RENEW_IF_EXPIRING_WITHIN_MS,
    );
    const desiredTargets = normalizeDesiredTargets(options.desired);

    if (!verificationToken) {
      throw deviceSyncError({
        code: "OURA_WEBHOOK_VERIFICATION_TOKEN_MISSING",
        message: "Oura webhook subscription ensure requires a verification token.",
        retryable: false,
        httpStatus: 500,
      });
    }

    const retained: OuraWebhookSubscription[] = [];
    const created: OuraWebhookSubscription[] = [];
    const renewed: OuraWebhookSubscription[] = [];
    const deleted: OuraWebhookSubscription[] = [];
    const existing = await list();
    const existingByKey = new Map<string, OuraWebhookSubscription[]>();
    const desiredKeys = new Set<string>();

    for (const subscription of existing) {
      const key = createOuraWebhookSubscriptionKey(subscription);
      const bucket = existingByKey.get(key);

      if (bucket) {
        bucket.push(subscription);
      } else {
        existingByKey.set(key, [subscription]);
      }
    }

    for (const target of desiredTargets) {
      const key = createOuraWebhookSubscriptionKey({
        callbackUrl,
        eventType: target.eventType,
        dataType: target.dataType,
      });
      desiredKeys.add(key);
      const matching = existingByKey.get(key) ?? [];

      if (matching.length === 0) {
        created.push(
          await create({
            callbackUrl,
            verificationToken,
            eventType: target.eventType,
            dataType: target.dataType,
          }),
        );
        continue;
      }

      let active = choosePrimarySubscription(matching);

      if (shouldRenewSubscription(active, renewIfExpiringWithinMs)) {
        active = await renew(active.id);
        renewed.push(active);
      } else {
        retained.push(active);
      }

      if (options.pruneDuplicates) {
        for (const duplicate of matching) {
          if (duplicate.id === active.id) {
            continue;
          }

          await remove(duplicate.id);
          deleted.push(duplicate);
        }
      }
    }

    if (options.pruneDuplicates) {
      for (const subscription of existing) {
        if (subscription.callbackUrl !== callbackUrl) {
          continue;
        }

        const key = createOuraWebhookSubscriptionKey(subscription);

        if (desiredKeys.has(key)) {
          continue;
        }

        await remove(subscription.id);
        deleted.push(subscription);
      }
    }

    return {
      retained,
      created,
      renewed,
      deleted,
    };
  }

  return {
    list,
    create,
    renew,
    delete: remove,
    ensure,
  };
}
