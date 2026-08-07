import { deviceSyncError } from "../errors.ts";
import { sanitizeHostedRuntimeDiagnosticText } from "../hosted-runtime.ts";
import { addMilliseconds, computeRetryDelayMs, normalizeString, sha256Text, splitScopeList, subtractDays } from "../shared.ts";
import { getDeviceSyncAccountOAuthTokens } from "../types.ts";
import {
  buildProviderResponseDiagnostics,
  inspectProviderErrorBody,
} from "./provider-diagnostics.ts";
import {
  createProviderRequestAbortSignal,
  isProviderParentAbortError,
  normalizeProviderAbortError,
  throwIfProviderRequestAborted,
  waitForProviderRetryDelay,
} from "./request-abort.ts";

import type { DeviceSyncErrorOptions } from "../errors.ts";
import type {
  DeviceConnectionHandler,
  DeviceJobExecutor,
  DeviceSyncAccount,
  DeviceSyncOAuthAdapter,
  DeviceSyncOAuthProvider,
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
} from "../types.ts";

type ProviderApiErrorDiagnosticValue = boolean | number | string | null | undefined;

const oauthTokenRequestProtocolOwnedFields = [
  "client_id",
  "client_secret",
  "code",
  "grant_type",
  "redirect_uri",
  "refresh_token",
] as const;
const oauthTokenRequestProtocolOwnedFieldSet: ReadonlySet<string> = new Set(
  oauthTokenRequestProtocolOwnedFields,
);
type OAuthTokenRequestExtraParameters = Readonly<Record<string, string>> &
  Partial<Record<(typeof oauthTokenRequestProtocolOwnedFields)[number], never>>;

type OAuthAuthorizationExtraSearchParameters = Readonly<
  Record<string, string | null | undefined>
> & {
  client_id?: never;
  redirect_uri?: never;
  response_type?: never;
  scope?: never;
  state?: never;
};

interface DeviceSyncOAuthProviderDefinition
  extends Omit<DeviceSyncProvider, "connectionHandler" | "webhookHandler" | "jobExecutor"> {
  buildConnectUrl(input: Parameters<DeviceSyncOAuthAdapter["buildConnectUrl"]>[0]): string;
  exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult>;
  refreshTokens: DeviceSyncOAuthAdapter["refreshTokens"];
  revokeAccess?(account: DeviceSyncAccount): Promise<void>;
  createScheduledJobs?(account: StoredDeviceSyncAccount, now: string): ProviderScheduleResult;
  verifyAndParseWebhook?(context: ProviderWebhookContext): Promise<ProviderWebhookResult>;
  executeJob(context: ProviderJobContext, job: Parameters<DeviceJobExecutor["executeJob"]>[1]): Promise<ProviderJobResult>;
}

export async function parseResponseBody(response: Response, signal?: AbortSignal | null): Promise<string> {
  try {
    const body = await response.text();
    throwIfProviderRequestAborted(signal);
    return body;
  } catch (error) {
    if (isProviderParentAbortError(error, signal)) {
      throw normalizeProviderAbortError(error, signal);
    }

    throwIfProviderRequestAborted(signal);
    return "";
  }
}

export function buildProviderApiError(
  code: string,
  message: string,
  response: Response,
  _body: string,
  options: {
    retryable?: boolean;
    accountStatus?: DeviceSyncErrorOptions["accountStatus"];
    diagnostics?: Record<string, ProviderApiErrorDiagnosticValue>;
    httpStatus?: number;
  } = {},
) {
  const retryable = options.retryable ?? (response.status === 429 || response.status >= 500);
  const accountStatus = options.accountStatus ?? null;
  const responseDiagnostics = buildProviderResponseDiagnostics(inspectProviderErrorBody(_body));

  return deviceSyncError({
    code,
    message,
    retryable,
    httpStatus: options.httpStatus ?? response.status,
    accountStatus,
    details: sanitizeProviderApiErrorDiagnostics({
      status: response.status,
      httpStatusText: response.statusText,
      retryable,
      accountStatus,
      ...responseDiagnostics,
      ...options.diagnostics,
    }),
  });
}

function sanitizeProviderApiErrorDiagnostics(
  input: Record<string, ProviderApiErrorDiagnosticValue>,
): Record<string, boolean | number | string | null> {
  const output: Record<string, boolean | number | string | null> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,80}$/u.test(key) || value === undefined) {
      continue;
    }

    if (typeof value === "string") {
      const token = value.trim();
      if (/^[A-Za-z0-9_.:-]{1,128}$/u.test(token)) {
        output[key] = token;
      } else if (isProviderApiErrorReasonKey(key)) {
        const reason = sanitizeProviderApiErrorReasonText(token);
        if (reason) {
          output[key] = reason;
        }
      }
      continue;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        output[key] = value;
      }
      continue;
    }

    output[key] = value;
  }

  return output;
}

function isProviderApiErrorReasonKey(key: string): boolean {
  return key.endsWith("Description") || key.endsWith("Reason") || key.endsWith("StatusText");
}

function sanitizeProviderApiErrorReasonText(value: string): string | null {
  return sanitizeHostedRuntimeDiagnosticText(value);
}

export function extractRetryMetadata(error: unknown): {
  retryable: boolean;
  httpStatus?: number;
} {
  const retryable =
    typeof error === "object" && error !== null && "retryable" in error && Boolean((error as { retryable?: boolean }).retryable);
  const httpStatus =
    typeof error === "object" && error !== null && "httpStatus" in error
      ? Number((error as { httpStatus?: number }).httpStatus)
      : undefined;

  return {
    retryable,
    httpStatus,
  };
}

export async function requestWithRefreshAndRetry<T>(input: {
  shouldRefresh: () => boolean;
  refresh: () => Promise<unknown>;
  request: () => Promise<T>;
  maxRetries?: number;
  signal?: AbortSignal | null;
}): Promise<T> {
  const maxRetries = input.maxRetries ?? 3;
  let attempt = 0;

  while (true) {
    throwIfProviderRequestAborted(input.signal);

    if (input.shouldRefresh()) {
      await input.refresh();
    }

    try {
      throwIfProviderRequestAborted(input.signal);
      return await input.request();
    } catch (error) {
      const { retryable, httpStatus } = extractRetryMetadata(error);

      if (httpStatus === 401 && attempt === 0) {
        await input.refresh();
        attempt += 1;
        continue;
      }

      if (retryable && attempt < maxRetries) {
        attempt += 1;
        await waitForProviderRetryDelay(computeRetryDelayMs(attempt), input.signal);
        continue;
      }

      throw error;
    }
  }
}

export async function postOAuthTokenRequest<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  parameters: Record<string, string>;
  signal?: AbortSignal | null;
  buildError: (response: Response, body: string) => Error;
}): Promise<T> {
  const requestAbort = createProviderRequestAbortSignal({
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
  });
  try {
    const response = await input.fetchImpl(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(input.parameters),
      signal: requestAbort.signal,
    });

    if (!response.ok) {
      throw input.buildError(response, await parseResponseBody(response, requestAbort.signal));
    }

    return (await response.json()) as T;
  } catch (error) {
    if (isProviderParentAbortError(error, requestAbort.signal)) {
      throw normalizeProviderAbortError(error, requestAbort.signal);
    }

    if (
      !requestAbort.signal.aborted
      && input.signal
      && isProviderParentAbortError(error, input.signal)
    ) {
      throw normalizeProviderAbortError(error, input.signal);
    }

    throw error;
  } finally {
    requestAbort.cleanup();
  }
}

export function isoFromExpiresIn(expiresIn: unknown, now = new Date().toISOString()): string | undefined {
  const numeric = typeof expiresIn === "number" ? expiresIn : Number(expiresIn);
  return Number.isFinite(numeric) ? addMilliseconds(now, numeric * 1000) : undefined;
}

export function splitScopes(value: unknown): string[] {
  return splitScopeList(value);
}

export function isTokenNearExpiry(
  account: Pick<DeviceSyncAccount, "accessTokenExpiresAt">,
  skewMs = 60_000,
): boolean {
  if (!account.accessTokenExpiresAt) {
    return false;
  }

  return Date.parse(account.accessTokenExpiresAt) - Date.now() <= skewMs;
}

export function tokenResponseToAuthTokens<T extends {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}>(payload: T, buildMissingAccessTokenError: () => Error): ProviderAuthTokens {
  const accessToken =
    typeof payload.access_token === "string" ? payload.access_token.trim() : String(payload.access_token ?? "").trim();

  if (!accessToken) {
    throw buildMissingAccessTokenError();
  }

  const refreshToken =
    typeof payload.refresh_token === "string"
      ? payload.refresh_token.trim() || null
      : payload.refresh_token == null
        ? null
        : String(payload.refresh_token).trim() || null;

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: isoFromExpiresIn(payload.expires_in),
  };
}

export function requireRefreshToken(refreshToken: unknown, buildMissingRefreshTokenError: () => Error): string {
  const normalized = normalizeString(refreshToken);

  if (!normalized) {
    throw buildMissingRefreshTokenError();
  }

  return normalized;
}

function createOAuthConnectionHandler(adapterInput: {
  oauthAdapter: DeviceSyncOAuthAdapter;
  revokeAccess?: DeviceConnectionHandler["revokeAccess"];
}): DeviceConnectionHandler & {
  refreshTokens: NonNullable<DeviceConnectionHandler["refreshTokens"]>;
} {
  return {
    beginConnection: async (input) => ({
      authorizationUrl: adapterInput.oauthAdapter.buildConnectUrl({
        state: input.state,
        callbackUrl: input.callbackUrl,
        scopes: input.scopes,
        now: input.now,
      }),
    }),
    completeConnection: async (input) => {
      const callbackError = normalizeString(input.query.get("error"));

      if (callbackError) {
        throw deviceSyncError({
          code: "OAUTH_CALLBACK_REJECTED",
          message: "OAuth authorization was denied or canceled.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const code = normalizeString(input.query.get("code"));

      if (!code) {
        throw deviceSyncError({
          code: "OAUTH_CODE_MISSING",
          message: "OAuth callback is missing the authorization code.",
          retryable: false,
          httpStatus: 400,
        });
      }

      return adapterInput.oauthAdapter.exchangeAuthorizationCode(
        {
          callbackUrl: input.callbackUrl,
          state: input.state,
          now: input.now,
          grantedScopes: input.grantedScopes,
        },
        code,
      );
    },
    refreshTokens: adapterInput.oauthAdapter.refreshTokens,
    ...(adapterInput.revokeAccess ? { revokeAccess: adapterInput.revokeAccess } : {}),
  };
}

export function adaptDeviceSyncOAuthProvider(
  input: DeviceSyncOAuthProviderDefinition,
): DeviceSyncOAuthProvider {
  const {
    buildConnectUrl,
    exchangeAuthorizationCode,
    refreshTokens,
    revokeAccess,
    createScheduledJobs,
    verifyAndParseWebhook,
    executeJob,
    ...provider
  } = input;
  const oauthAdapter: DeviceSyncOAuthAdapter = {
    buildConnectUrl,
    exchangeAuthorizationCode,
    refreshTokens,
  };
  const connectionHandler = createOAuthConnectionHandler({
    oauthAdapter,
    revokeAccess,
  });
  const webhookHandler = verifyAndParseWebhook ? { verifyAndParseWebhook } : undefined;
  const jobExecutor: DeviceJobExecutor = {
    ...(createScheduledJobs ? { createScheduledJobs } : {}),
    executeJob,
  };

  return {
    ...provider,
    connectionHandler,
    ...(webhookHandler ? { webhookHandler } : {}),
    jobExecutor,
    oauthAdapter,
  };
}

export async function exchangeOAuthAuthorizationCode<T extends {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}>(input: {
  postTokenRequest: (parameters: Record<string, string>) => Promise<T>;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  code: string;
  tokenResponseToAuthTokens: (payload: T) => ProviderAuthTokens;
  buildMissingRefreshTokenError: () => Error;
  extraParameters?: OAuthTokenRequestExtraParameters;
}): Promise<{
  tokenPayload: T;
  tokens: ProviderAuthTokens;
}> {
  const parameters = appendOAuthTokenRequestExtraParameters({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.callbackUrl,
    code: input.code,
  }, input.extraParameters);
  const tokenPayload = await input.postTokenRequest(parameters);
  const tokens = input.tokenResponseToAuthTokens(tokenPayload);
  tokens.refreshToken = requireRefreshToken(tokens.refreshToken, input.buildMissingRefreshTokenError);

  return {
    tokenPayload,
    tokens,
  };
}

export async function refreshOAuthTokens<T extends {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
}>(input: {
  postTokenRequest: (parameters: Record<string, string>) => Promise<T>;
  account: Pick<DeviceSyncAccount, "credential">;
  clientId: string;
  clientSecret: string;
  tokenResponseToAuthTokens: (payload: T) => ProviderAuthTokens;
  buildMissingRefreshTokenError: () => Error;
  resolveRefreshToken?: (input: {
    currentRefreshToken: string;
    responseRefreshToken: string | null;
  }) => string;
  extraParameters?: OAuthTokenRequestExtraParameters;
}): Promise<ProviderAuthTokens> {
  const currentRefreshToken = requireRefreshToken(
    getDeviceSyncAccountOAuthTokens(input.account)?.refreshToken,
    input.buildMissingRefreshTokenError,
  );
  const parameters = appendOAuthTokenRequestExtraParameters({
    grant_type: "refresh_token",
    refresh_token: currentRefreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  }, input.extraParameters);
  const tokenPayload = await input.postTokenRequest(parameters);
  const tokens = input.tokenResponseToAuthTokens(tokenPayload);

  if (input.resolveRefreshToken) {
    tokens.refreshToken = input.resolveRefreshToken({
      currentRefreshToken,
      responseRefreshToken: tokens.refreshToken ?? null,
    });
  }

  return tokens;
}

function appendOAuthTokenRequestExtraParameters(
  parameters: Record<string, string>,
  extraParameters: OAuthTokenRequestExtraParameters | undefined,
): Record<string, string> {
  for (const [key, value] of Object.entries(extraParameters ?? {})) {
    if (oauthTokenRequestProtocolOwnedFieldSet.has(key)) {
      throw new TypeError(
        `OAuth token request extra parameters must not override protocol-owned field ${key}.`,
      );
    }
    Object.defineProperty(parameters, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return parameters;
}

export function createRefreshingApiSession(input: {
  context: Pick<ProviderJobContext, "account" | "refreshAccountTokens" | "signal">;
  requestJsonWithAccessToken: <T>(
    accessToken: string,
    path: string,
    options: {
      optional?: boolean;
    },
  ) => Promise<T | null>;
  shouldRefresh?: (account: DeviceSyncAccount) => boolean;
}) {
  let currentAccount = input.context.account;

  async function refresh(): Promise<DeviceSyncAccount> {
    currentAccount = await input.context.refreshAccountTokens();
    return currentAccount;
  }

  async function requestJson<T>(path: string, options: { optional?: boolean } = {}): Promise<T | null> {
    return requestWithRefreshAndRetry({
      shouldRefresh: () => (input.shouldRefresh ?? isTokenNearExpiry)(currentAccount),
      refresh,
      signal: input.context.signal ?? null,
      request: () => {
        const tokens = getDeviceSyncAccountOAuthTokens(currentAccount);
        if (!tokens?.accessToken) {
          throw deviceSyncError({
            code: "DEVICE_SYNC_OAUTH_TOKENS_REQUIRED",
            message: "Device sync OAuth account is missing access token credentials.",
            retryable: false,
            accountStatus: "reauthorization_required",
          });
        }

        return input.requestJsonWithAccessToken<T>(tokens.accessToken, path, options);
      },
    });
  }

  return {
    get account() {
      return currentAccount;
    },
    requestJson,
  };
}

export async function fetchBearerJson<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  accessToken: string;
  timeoutMs: number;
  signal?: AbortSignal | null;
  optional?: boolean;
  buildError: (response: Response, body: string) => Error;
}): Promise<T | null> {
  const requestAbort = createProviderRequestAbortSignal({
    signal: input.signal ?? null,
    timeoutMs: input.timeoutMs,
  });
  try {
    const response = await input.fetchImpl(input.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
      },
      signal: requestAbort.signal,
    });

    if (response.status === 404 && input.optional) {
      return null;
    }

    if (!response.ok) {
      throw input.buildError(response, await parseResponseBody(response, requestAbort.signal));
    }

    return (await response.json()) as T;
  } catch (error) {
    if (isProviderParentAbortError(error, requestAbort.signal)) {
      throw normalizeProviderAbortError(error, requestAbort.signal);
    }

    if (
      !requestAbort.signal.aborted
      && input.signal
      && isProviderParentAbortError(error, input.signal)
    ) {
      throw normalizeProviderAbortError(error, input.signal);
    }

    throw error;
  } finally {
    requestAbort.cleanup();
  }
}

export function buildOAuthConnectUrl(input: {
  baseUrl: string;
  authorizePath: string;
  clientId: string;
  callbackUrl: string;
  scopes: string[];
  state: string;
  scopeDelimiter?: string;
  extraSearchParams?: OAuthAuthorizationExtraSearchParameters;
}): string {
  const search = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    redirect_uri: input.callbackUrl,
    scope: input.scopes.join(input.scopeDelimiter ?? " "),
    state: input.state,
  });

  for (const [key, rawValue] of Object.entries(input.extraSearchParams ?? {})) {
    if (search.has(key)) {
      throw new TypeError(
        `OAuth authorization extra parameters must not override protocol-owned field ${key}.`,
      );
    }
    const value = normalizeString(rawValue ?? undefined);

    if (value) {
      search.set(key, value);
    }
  }

  return `${input.baseUrl}${input.authorizePath}?${search.toString()}`;
}

export function buildScheduledReconcileJobs(input: {
  accountId: string;
  nextReconcileAt: string | null;
  now: string;
  reconcileDays: number;
  reconcileIntervalMs: number;
  payload: Record<string, unknown>;
}): ProviderScheduleResult {
  const dedupeKey = `reconcile:${sha256Text(`${input.accountId}:${input.nextReconcileAt ?? input.now}`)}`;

  return {
    jobs: [
      {
        kind: "reconcile",
        dedupeKey,
        priority: 25,
        payload: {
          windowStart: subtractDays(input.now, input.reconcileDays),
          windowEnd: input.now,
          ...input.payload,
        },
      },
    ],
    nextReconcileAt: addMilliseconds(input.now, input.reconcileIntervalMs),
  };
}
