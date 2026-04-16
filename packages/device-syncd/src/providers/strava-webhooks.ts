import { deviceSyncError } from "../errors.ts";
import { coerceRecord, normalizeIdentifier, normalizeString } from "../shared.ts";
import { buildProviderApiError, parseResponseBody } from "./shared-oauth.ts";

const STRAVA_API_BASE_URL = "https://www.strava.com/api/v3";
const STRAVA_PUSH_SUBSCRIPTIONS_PATH = "/push_subscriptions";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface StravaWebhookSubscription {
  id: string;
  callbackUrl: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StravaWebhookEnsureResult {
  retained: StravaWebhookSubscription | null;
  created: StravaWebhookSubscription | null;
  deleted: StravaWebhookSubscription[];
}

export interface StravaWebhookSubscriptionClient {
  list(): Promise<StravaWebhookSubscription[]>;
  create(input: {
    callbackUrl: string;
    verifyToken: string;
  }): Promise<StravaWebhookSubscription>;
  delete(id: string): Promise<void>;
  ensure(input: {
    callbackUrl: string;
    verifyToken: string;
  }): Promise<StravaWebhookEnsureResult>;
}

export interface CreateStravaWebhookSubscriptionClientInput {
  clientId: string;
  clientSecret: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function buildStravaWebhookApiError(
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

function normalizeCallbackUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function normalizeCallbackPath(value: string): string {
  const pathname = new URL(value).pathname.replace(/\/+$/u, "");
  return pathname || "/";
}

function parseSubscription(payload: unknown): StravaWebhookSubscription {
  const record = coerceRecord(payload);
  const id = normalizeIdentifier(record.id ?? record.subscription_id ?? record.subscriptionId);
  const callbackUrl = normalizeString(record.callback_url ?? record.callbackUrl ?? record.url);
  const createdAt = normalizeString(record.created_at ?? record.createdAt) ?? null;
  const updatedAt = normalizeString(record.updated_at ?? record.updatedAt) ?? null;

  if (!id || !callbackUrl) {
    throw deviceSyncError({
      code: "STRAVA_WEBHOOK_SUBSCRIPTION_RESPONSE_INVALID",
      message: "Strava webhook subscription response was missing id or callback_url.",
      retryable: false,
      httpStatus: 502,
    });
  }

  return {
    id,
    callbackUrl: normalizeCallbackUrl(callbackUrl),
    createdAt,
    updatedAt,
  };
}

function parseSubscriptionList(payload: unknown): StravaWebhookSubscription[] {
  if (Array.isArray(payload)) {
    return payload.map((entry) => parseSubscription(entry));
  }

  const record = coerceRecord(payload);

  if (Array.isArray(record.data)) {
    return record.data.map((entry) => parseSubscription(entry));
  }

  if (record.id !== undefined || record.callback_url !== undefined || record.callbackUrl !== undefined) {
    return [parseSubscription(record)];
  }

  return [];
}

function sortSubscriptionsForRetention(
  subscriptions: readonly StravaWebhookSubscription[],
  preferredCallbackUrl: string,
): StravaWebhookSubscription[] {
  const normalizedPreferredCallbackUrl = normalizeCallbackUrl(preferredCallbackUrl);

  return [...subscriptions].sort((left, right) => {
    const leftPreferred = left.callbackUrl === normalizedPreferredCallbackUrl;
    const rightPreferred = right.callbackUrl === normalizedPreferredCallbackUrl;

    if (leftPreferred !== rightPreferred) {
      return leftPreferred ? -1 : 1;
    }

    const leftUpdatedAt = left.updatedAt ? Date.parse(left.updatedAt) : Number.NaN;
    const rightUpdatedAt = right.updatedAt ? Date.parse(right.updatedAt) : Number.NaN;

    if (Number.isFinite(leftUpdatedAt) || Number.isFinite(rightUpdatedAt)) {
      if (!Number.isFinite(leftUpdatedAt)) {
        return 1;
      }

      if (!Number.isFinite(rightUpdatedAt)) {
        return -1;
      }

      if (leftUpdatedAt !== rightUpdatedAt) {
        return rightUpdatedAt - leftUpdatedAt;
      }
    }

    return left.id.localeCompare(right.id);
  });
}

function hasManagedCallbackPath(subscription: StravaWebhookSubscription, callbackUrl: string): boolean {
  return normalizeCallbackPath(subscription.callbackUrl) === normalizeCallbackPath(callbackUrl);
}

export function createStravaWebhookSubscriptionClient(
  input: CreateStravaWebhookSubscriptionClientInput,
): StravaWebhookSubscriptionClient {
  const apiBaseUrl = (input.apiBaseUrl ?? STRAVA_API_BASE_URL).replace(/\/+$/u, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  async function request(input: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    query?: URLSearchParams;
    formData?: URLSearchParams;
    optional?: boolean;
  }): Promise<unknown> {
    const url = new URL(`${apiBaseUrl}${input.path}`);

    if (input.query) {
      url.search = input.query.toString();
    }

    const response = await fetchImpl(url.toString(), {
      method: input.method,
      headers: input.formData
        ? {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          }
        : {
            Accept: "application/json",
          },
      body: input.formData?.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.status === 404 && input.optional) {
      return null;
    }

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      throw buildStravaWebhookApiError(
        "STRAVA_WEBHOOK_REQUEST_FAILED",
        `Strava webhook request failed for ${input.method} ${input.path}.`,
        response,
        await parseResponseBody(response),
      );
    }

    return response.json();
  }

  function authQuery(): URLSearchParams {
    return new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
    });
  }

  return {
    async list(): Promise<StravaWebhookSubscription[]> {
      const payload = await request({
        method: "GET",
        path: STRAVA_PUSH_SUBSCRIPTIONS_PATH,
        query: authQuery(),
      });

      return parseSubscriptionList(payload);
    },
    async create(createInput): Promise<StravaWebhookSubscription> {
      const formData = new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        callback_url: normalizeCallbackUrl(createInput.callbackUrl),
        verify_token: createInput.verifyToken,
      });
      const payload = await request({
        method: "POST",
        path: STRAVA_PUSH_SUBSCRIPTIONS_PATH,
        formData,
      });

      return parseSubscription(payload);
    },
    async delete(id: string): Promise<void> {
      await request({
        method: "DELETE",
        path: `${STRAVA_PUSH_SUBSCRIPTIONS_PATH}/${encodeURIComponent(id)}`,
        query: authQuery(),
      });
    },
    async ensure(ensureInput): Promise<StravaWebhookEnsureResult> {
      const desiredCallbackUrl = normalizeCallbackUrl(ensureInput.callbackUrl);
      const current = await this.list();
      const managed = current.filter((subscription) => hasManagedCallbackPath(subscription, desiredCallbackUrl));
      const sorted = sortSubscriptionsForRetention(managed.length > 0 ? managed : current, desiredCallbackUrl);
      const retained = sorted.find((subscription) => subscription.callbackUrl === desiredCallbackUrl) ?? null;
      const deleted: StravaWebhookSubscription[] = [];

      for (const subscription of current) {
        if (retained && subscription.id === retained.id) {
          continue;
        }

        await this.delete(subscription.id);
        deleted.push(subscription);
      }

      if (retained) {
        return {
          retained,
          created: null,
          deleted,
        };
      }

      const created = await this.create({
        callbackUrl: desiredCallbackUrl,
        verifyToken: ensureInput.verifyToken,
      });

      return {
        retained: null,
        created,
        deleted,
      };
    },
  };
}
