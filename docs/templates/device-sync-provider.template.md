# `device-syncd` provider template

Before using this template:
1. add `ACME_DEVICE_PROVIDER_DESCRIPTOR` to `packages/importers/src/device-providers/provider-descriptors.ts`
2. export it through `packages/importers/src/device-providers/defaults.ts`
3. decide whether the provider really needs webhook support or whether polling-first is enough for the first slice

Copy the fenced code below into `packages/device-syncd/src/providers/<provider>.ts` and replace the placeholder `Acme` and `acme` names.

Use this together with the importer adapter template so transport and normalization land as one coherent provider.

```ts
import {
  ACME_DEVICE_PROVIDER_DESCRIPTOR,
  requireDeviceProviderOAuthDescriptor,
  requireDeviceProviderSyncDescriptor,
} from "@murphai/importers/device-providers/provider-descriptors";

import { deviceSyncError } from "../errors.ts";
import {
  normalizeIdentifier,
  normalizeString,
} from "../shared.ts";
import {
  buildOAuthConnectUrl,
  buildProviderApiError,
  buildScheduledReconcileJobs,
  exchangeOAuthAuthorizationCode,
  parseResponseBody,
  postOAuthTokenRequest,
  refreshOAuthTokens,
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
  ProviderWebhookContext,
  ProviderWebhookResult,
  StoredDeviceSyncAccount,
} from "../types.ts";

const ACME_DESCRIPTOR = ACME_DEVICE_PROVIDER_DESCRIPTOR;
const ACME_OAUTH = requireDeviceProviderOAuthDescriptor(ACME_DESCRIPTOR);
const ACME_SYNC = requireDeviceProviderSyncDescriptor(ACME_DESCRIPTOR);

const DEFAULT_ACME_BASE_URL = "https://api.acme.example";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BACKFILL_DAYS = ACME_SYNC.windows.backfillDays;
const DEFAULT_RECONCILE_DAYS = ACME_SYNC.windows.reconcileDays;
const DEFAULT_RECONCILE_INTERVAL_MS = ACME_SYNC.windows.reconcileIntervalMs;

interface AcmeTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
}

export interface AcmeDeviceSyncProviderConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  scopes?: string[];
  backfillDays?: number;
  reconcileDays?: number;
  reconcileIntervalMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function tokenResponseToAuthTokens(payload: AcmeTokenResponse): ProviderAuthTokens {
  return sharedTokenResponseToAuthTokens(payload, () =>
    deviceSyncError({
      code: "ACME_TOKEN_RESPONSE_INVALID",
      message: "Acme token response did not include an access token.",
      retryable: false,
      httpStatus: 502,
    }),
  );
}

function buildAcmeApiError(
  code: string,
  message: string,
  response: Response,
  body: string,
  retryable = response.status === 429 || response.status >= 500,
) {
  return buildProviderApiError(code, message, response, body, { retryable });
}

function normalizeAcmeExternalAccountId(value: unknown): string | null {
  return normalizeIdentifier(value) ?? normalizeString(value) ?? null;
}

export function createAcmeDeviceSyncProvider(
  config: AcmeDeviceSyncProviderConfig,
): DeviceSyncProvider {
  const descriptor = ACME_DESCRIPTOR;
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = (config.baseUrl ?? DEFAULT_ACME_BASE_URL).replace(/\/+$/u, "");
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backfillDays = config.backfillDays ?? DEFAULT_BACKFILL_DAYS;
  const reconcileDays = config.reconcileDays ?? DEFAULT_RECONCILE_DAYS;
  const reconcileIntervalMs = config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
  const defaultScopes = [...(config.scopes ?? descriptor.oauth?.defaultScopes ?? [])];

  async function postTokenRequest(parameters: Record<string, string>) {
    return postOAuthTokenRequest<AcmeTokenResponse>({
      fetchImpl,
      url: `${baseUrl}/oauth/token`,
      timeoutMs,
      parameters,
      buildError: (response, body) =>
        buildAcmeApiError(
          "ACME_TOKEN_REQUEST_FAILED",
          "Acme token request failed.",
          response,
          body,
        ),
    });
  }

  async function fetchProfile(accessToken: string): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${baseUrl}/v1/profile`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw buildAcmeApiError(
        "ACME_PROFILE_REQUEST_FAILED",
        "Acme profile request failed.",
        response,
        await parseResponseBody(response),
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  return {
    ...descriptor,
    callbackPath: descriptor.oauth?.callbackPath ?? ACME_OAUTH.callbackPath,
    webhookPath: descriptor.webhook?.path,
    defaultScopes,
    buildConnectUrl({ state, callbackUrl, scopes }) {
      return buildOAuthConnectUrl({
        baseUrl,
        authorizePath: "/oauth/authorize",
        clientId: config.clientId,
        callbackUrl,
        scopes,
        state,
      });
    },
    async exchangeAuthorizationCode(context: ProviderCallbackContext, code: string): Promise<ProviderConnectionResult> {
      const { tokens } = await exchangeOAuthAuthorizationCode({
        postTokenRequest,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        callbackUrl: context.callbackUrl,
        code,
        tokenResponseToAuthTokens,
        buildMissingRefreshTokenError: () =>
          deviceSyncError({
            code: "ACME_REFRESH_TOKEN_MISSING",
            message: "Acme did not return a refresh token.",
            retryable: false,
            accountStatus: "reauthorization_required",
          }),
      });

      const profile = await fetchProfile(tokens.accessToken);
      const externalAccountId = normalizeAcmeExternalAccountId(
        profile.userId ?? profile.user_id ?? profile.id,
      );

      if (!externalAccountId) {
        throw deviceSyncError({
          code: "ACME_ACCOUNT_ID_MISSING",
          message: "Acme profile response did not include a stable account id.",
          retryable: false,
          httpStatus: 502,
        });
      }

      return {
        externalAccountId,
        displayName: normalizeString(profile.displayName ?? profile.name) ?? null,
        scopes: context.grantedScopes.length > 0 ? context.grantedScopes : defaultScopes,
        metadata: {
          profileId: externalAccountId,
          syncMode: descriptor.transportModes.includes("webhook_push") ? "polling-plus-webhook" : "polling",
        },
        tokens,
        initialJobs: [
          {
            kind: "backfill",
            priority: 100,
            payload: {
              reason: "initial-connect",
              backfillDays,
            },
          },
        ],
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
            code: "ACME_REFRESH_TOKEN_REQUIRED",
            message: "Acme account is missing a refresh token.",
            retryable: false,
            accountStatus: "reauthorization_required",
          }),
      });
    },
    createScheduledJobs(account: StoredDeviceSyncAccount, now: string) {
      return buildScheduledReconcileJobs({
        accountId: account.id,
        nextReconcileAt: account.nextReconcileAt,
        now,
        reconcileDays,
        reconcileIntervalMs,
        payload: {
          reason: "scheduled-reconcile",
        },
      });
    },
    async verifyAndParseWebhook(context: ProviderWebhookContext): Promise<ProviderWebhookResult> {
      // Remove this entirely if the provider is polling-only.
      const payload = JSON.parse(context.rawBody.toString("utf8")) as Record<string, unknown>;
      const externalAccountId = normalizeAcmeExternalAccountId(
        payload.userId ?? payload.user_id,
      );

      if (!externalAccountId) {
        throw deviceSyncError({
          code: "ACME_WEBHOOK_ACCOUNT_ID_MISSING",
          message: "Acme webhook did not include a stable account id.",
          retryable: false,
          httpStatus: 400,
        });
      }

      return {
        externalAccountId,
        eventType: normalizeString(payload.type) ?? "unknown",
        traceId: normalizeString(payload.id) ?? `${externalAccountId}:${context.now}`,
        payload,
        jobs: [
          {
            kind: "reconcile",
            priority: 200,
            payload: {
              reason: "webhook",
            },
          },
        ],
      };
    },
    async executeJob(context: ProviderJobContext, job: DeviceSyncJobRecord): Promise<ProviderJobResult> {
      switch (job.kind) {
        case "backfill":
        case "reconcile": {
          const snapshot = {
            accountId: context.account.externalAccountId,
            importedAt: context.now,
            profile: {
              id: context.account.externalAccountId,
            },
            dailySummaries: [],
            sleeps: [],
            activities: [],
          };

          await context.importSnapshot(snapshot);

          return {
            nextReconcileAt: new Date(
              Date.parse(context.now) + reconcileIntervalMs,
            ).toISOString(),
          };
        }
        default:
          throw deviceSyncError({
            code: "ACME_JOB_KIND_UNSUPPORTED",
            message: `Unsupported Acme job kind: ${job.kind}`,
            retryable: false,
          });
      }
    },
  };
}
```

## After copying the template

Do not stop at the provider file. Wire the provider into:
- `packages/device-syncd/src/config.ts`
- `packages/device-syncd/src/index.ts`
- `packages/device-syncd/src/public-ingress.ts` when shared callback or webhook exports should expose it
- `packages/device-syncd/package.json` provider subpath exports when you want `@murphai/device-syncd/providers/<provider>`
- the importer adapter and the shared descriptor tests

Keep the implementation descriptor-first:
- add or update shared metadata in `provider-descriptors.ts`
- derive callback path, scopes, webhook path, and sync defaults from that descriptor
- avoid duplicating provider metadata in local constants unless it is truly transport-only
