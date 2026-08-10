import {
  createDeviceSyncPublicIngress,
  resolveDeviceSyncWebhookPreflightResponse,
} from "@murphai/device-syncd/public-ingress";
import {
  normalizeJunctionProviderSlug,
  type DeviceSyncConnectTarget,
} from "@murphai/device-syncd/connect-config";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE,
  isEstablishedDeviceSyncConnection,
} from "@murphai/device-syncd/public-account";
import {
  DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES,
  DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED,
  type BeginConnectionResult,
  type CompleteConnectionResult,
  type HandleWebhookResult,
  type DeviceSyncWebhookPreflightResponse,
  type PublicDeviceSyncAccount,
  type PublicProviderDescriptor,
  type SdkSignInSessionResult,
  type StartConnectionSourceLifecycleProof,
  type DeviceSyncRegistry,
} from "@murphai/device-syncd/types";
import type { CompanionHrvRmssdObservation } from "@murphai/contracts";

import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { formatHostedExecutionSafeLogErrorDetails } from "../hosted-execution/logging";
import { readHostedHealthDataConsentState } from "../legal/consent";
import type { HostedDeviceSyncControlPlaneContext } from "./control-plane-context";
import { createHostedDeviceSyncControlPlaneContext } from "./control-plane-context";
import {
  assertCompanionHrvRmssdObservationFresh,
  COMPANION_APPLE_HEALTH_SOURCE_PROVIDER,
  resolveCompanionHrvRmssdConnection,
  type CompanionConnectionIntent,
} from "./companion";
import {
  createHostedBrowserConnectionId,
  toHostedBrowserDeviceSyncConnection,
  type HostedBrowserDeviceSyncConnection,
} from "./public-connection";
import {
  acceptHostedCompanionHrvRmssdObservation,
  beginHostedDeviceSyncConnectionSourceReconnect,
  buildHostedCompanionHrvRmssdDirtyResource,
  captureHostedDeviceSyncConnectionSourceReconnect,
  cleanupRejectedHostedDeviceSyncConnectionSource,
  disconnectHostedDeviceSyncConnection,
  disconnectHostedDeviceSyncConnectionSource,
  handleHostedDeviceSyncConnectionEstablished,
  handleHostedDeviceSyncUnknownWebhook,
  handleHostedDeviceSyncWebhookAccepted,
  prepareHostedDeviceSyncConnectionSourceStart,
  reconcileHostedDeviceSyncConnectionSourceRegistration,
} from "./wake-service";
import { readRawBodyBuffer } from "./http";
import { HostedDeviceSyncWebhookAdminService } from "./webhook-admin-service";
import { createHostedDeviceSyncRegistry } from "./providers";

export class HostedDeviceSyncPublicIngressService {
  private readonly ingress;
  private readonly preparedSourceLifecycles = new Map<
    string,
    StartConnectionSourceLifecycleProof
  >();

  constructor(
    private readonly context: HostedDeviceSyncControlPlaneContext,
    private readonly webhookAdmin: HostedDeviceSyncWebhookAdminService,
    private readonly registry: DeviceSyncRegistry,
  ) {
    this.ingress = createDeviceSyncPublicIngress({
      publicBaseUrl: this.context.publicIngressBaseUrl,
      allowedReturnOrigins: this.context.allowedReturnOrigins,
      registry: this.registry,
      store: this.context.store,
      hooks: {
        onConnectionEstablished: async ({
          account,
          connection,
          connectionStartedAt,
          now,
          provider,
          sourceProviderSlug,
        }) => {
          if (await this.hasWithdrawnHealthDataConsent(account.id)) {
            throw deviceSyncError({
              code: "HEALTH_DATA_CONSENT_REQUIRED",
              httpStatus: 403,
              message: "Use Murph again before connecting a health source.",
              retryable: false,
            });
          }

          await handleHostedDeviceSyncConnectionEstablished({
            account,
            connection,
            connectionStartedAt: connectionStartedAt ?? null,
            now,
            sourceProviderSlug: sourceProviderSlug ?? null,
            store: this.context.store,
          });

          await this.webhookAdmin.ensureHostedWebhookAdminUpkeepForConnectionEstablished(provider);
          return {
            sourceAdmissionCommitted: true,
          };
        },
        onConnectionSourceAdmissionRejected: async ({
          account,
          connectionStartedAt,
          sourceProviderSlug,
        }) => {
          await cleanupRejectedHostedDeviceSyncConnectionSource({
            account,
            connectionStartedAt,
            registry: this.registry,
            sourceProviderSlug,
            store: this.context.store,
          });
        },
        onConnectionSourceObserved: async ({
          account,
          eventType,
          sourceProviderSlug,
        }) => {
          if (
            normalizeJunctionProviderSlug(sourceProviderSlug)
              !== COMPANION_APPLE_HEALTH_SOURCE_PROVIDER
          ) {
            return;
          }
          if (
            eventType === "provider.connection.created"
            || eventType === "provider.connection.updated"
          ) {
            const reconciliation = await reconcileHostedDeviceSyncConnectionSourceRegistration({
              account,
              registry: this.registry,
              sourceProviderSlug,
              store: this.context.store,
            });
            if (reconciliation === "admitted") {
              return { sourceAdmissionCommitted: true };
            }
            return reconciliation === "removed"
              ? { sourceRegistrationRemoved: true }
              : undefined;
          }
          return;
        },
        onLevelDirtyWebhookAlreadySatisfied: async ({ account }) => {
          const pending = await this.context.store.hasPendingDirtyConnection(account.id);
          return pending ? { accepted: true } : null;
        },
        onWebhookAccepted: async ({
          account,
          claimToken,
          traceId,
          webhook,
          provider,
          now,
        }) => {
          if (await this.hasWithdrawnHealthDataConsent(account.id)) {
            const completed = await this.context.store.completeWebhookTrace(
              provider.provider,
              traceId,
              claimToken,
            );
            if (!completed) {
              throw deviceSyncError({
                code: "WEBHOOK_TRACE_CLAIM_LOST",
                message: "Webhook trace claim was lost before durable acceptance completed.",
                retryable: true,
                httpStatus: 503,
              });
            }
            return DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED;
          }

          await handleHostedDeviceSyncWebhookAccepted({
            account,
            claimToken,
            now,
            store: this.context.store,
            traceId,
            webhook,
          });
          return DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED;
        },
        onUnknownWebhook: handleHostedDeviceSyncUnknownWebhook,
      },
    });
  }

  describeProviders(): PublicProviderDescriptor[] {
    return this.ingress.describeProviders();
  }

  async getConnectionStatus(
    userId: string,
    publicConnectionId: string,
  ): Promise<{ connection: HostedBrowserDeviceSyncConnection }> {
    const connection = await this.requireOwnedBrowserConnection(userId, publicConnectionId);

    return {
      connection: this.toBrowserConnection(connection),
    };
  }

  async startConnection(
    userId: string,
    provider: string,
    returnTo: string | null,
    options: {
      sourceProviderSlug?: string | null;
      connectSourceId?: string | null;
      connectTarget?: string | null;
    } = {},
  ): Promise<BeginConnectionResult> {
    const sourceLifecycleKey = buildPreparedSourceLifecycleKey(
      userId,
      provider,
      options.sourceProviderSlug ?? null,
    );
    const sourceLifecycleProof = sourceLifecycleKey
      ? this.preparedSourceLifecycles.get(sourceLifecycleKey) ?? null
      : null;
    if (sourceLifecycleKey) {
      this.preparedSourceLifecycles.delete(sourceLifecycleKey);
    }
    return this.ingress.startConnection({
      provider,
      returnTo,
      ownerId: userId,
      sourceProviderSlug: options.sourceProviderSlug ?? null,
      sourceLifecycleProof,
      connectSourceId: options.connectSourceId ?? null,
      connectTarget: options.connectTarget ?? null,
    });
  }

  async prepareConnectionStart(
    userId: string,
    target: DeviceSyncConnectTarget,
  ): Promise<void> {
    if (target.provider !== "junction" || !target.sourceProviderSlug) {
      return;
    }

    const connections = (await this.context.store.listConnectionsForUser(userId))
      .filter((connection) =>
        connection.provider === target.provider
        && connection.status !== "disconnected"
      );

    let sourceLifecycleProof: StartConnectionSourceLifecycleProof | null = null;
    for (const connection of connections) {
      sourceLifecycleProof = await prepareHostedDeviceSyncConnectionSourceStart({
        connectionId: connection.id,
        registry: this.registry,
        sourceProviderSlug: target.sourceProviderSlug,
        store: this.context.store,
        userId,
      });
    }
    const sourceLifecycleKey = buildPreparedSourceLifecycleKey(
      userId,
      target.provider,
      target.sourceProviderSlug,
    );
    if (sourceLifecycleKey && sourceLifecycleProof) {
      this.preparedSourceLifecycles.set(sourceLifecycleKey, sourceLifecycleProof);
    }
  }

  async handleOAuthCallback(
    provider: string,
    options: { expectedOwnerId: string },
  ): Promise<CompleteConnectionResult> {
    return this.handleConnectionCallback(provider, options);
  }

  /** Companion SDK sign-in. Only an explicit connect may change lifecycle state. */
  async createSdkSignInSession(
    userId: string,
    provider: string,
    connectionIntent: CompanionConnectionIntent | null,
    options: { allowConnectionMutation?: boolean } = {},
  ): Promise<SdkSignInSessionResult> {
    if (connectionIntent === "connect") {
      if (options.allowConnectionMutation === false) {
        throw companionSdkReconnectRequiredError();
      }
      const providerConnections = (await this.context.store.listConnectionsForUser(userId))
        .filter((connection) =>
          connection.provider === provider
          && isEstablishedDeviceSyncConnection(connection)
        );
      if (providerConnections.length > 1) {
        throw deviceSyncError({
          code: "SDK_SIGN_IN_CONNECTION_AMBIGUOUS",
          message: "The companion could not identify one active device-sync connection.",
          retryable: false,
          httpStatus: 409,
        });
      }
      const establishedConnection = providerConnections[0] ?? null;
      const capturedReconnectProof = establishedConnection
        ? await captureHostedDeviceSyncConnectionSourceReconnect({
            connectionId: establishedConnection.id,
            sourceProviderSlug: COMPANION_APPLE_HEALTH_SOURCE_PROVIDER,
            store: this.context.store,
            userId,
          })
        : null;
      const session = await this.ingress.createSdkSignInSession({
        provider,
        ownerId: userId,
      });
      if (
        capturedReconnectProof
        && session.account.id !== capturedReconnectProof.connection.id
      ) {
        throw deviceSyncError({
          code: "SDK_SIGN_IN_CONNECTION_CHANGED",
          message: "The companion connection changed while sign-in was starting. Retry.",
          retryable: true,
          httpStatus: 409,
        });
      }
      const reconnectProof = capturedReconnectProof
        ?? await captureHostedDeviceSyncConnectionSourceReconnect({
          connectionId: session.account.id,
          sourceProviderSlug: COMPANION_APPLE_HEALTH_SOURCE_PROVIDER,
          store: this.context.store,
          userId,
        });
      await beginHostedDeviceSyncConnectionSourceReconnect({
        proof: reconnectProof,
        store: this.context.store,
        userId,
      });
      return session;
    }

    const providerConnections = (await this.context.store.listConnectionsForUser(userId))
      .filter((connection) => connection.provider === provider);
    const establishedConnections = providerConnections.filter(
      isEstablishedDeviceSyncConnection,
    );

    if (establishedConnections.length > 1) {
      throw deviceSyncError({
        code: "SDK_SIGN_IN_CONNECTION_AMBIGUOUS",
        message: "The companion could not identify one active device-sync connection.",
        retryable: false,
        httpStatus: 409,
      });
    }

    const establishedConnection = establishedConnections[0] ?? null;
    if (establishedConnection) {
      return this.ingress.resumeSdkSignInSession({
        accountId: establishedConnection.id,
        provider,
        ownerId: userId,
      });
    }

    // Older clients did not send an intent. Preserve their first connection,
    // but never interpret missing local state as authority to clear a durable
    // disconnect or other terminal server state.
    if (
      connectionIntent === null
      && providerConnections.length === 0
      && options.allowConnectionMutation !== false
    ) {
      return this.ingress.createSdkSignInSession({
        provider,
        ownerId: userId,
      });
    }

    throw companionSdkReconnectRequiredError();
  }

  async discardConnectionCallback(provider: string): Promise<void> {
    const url = new URL(this.context.request.url);
    const state = url.searchParams.get("murph_state") ?? url.searchParams.get("state");
    if (!state) {
      return;
    }

    await this.context.store.consumeOAuthState(
      state,
      new Date().toISOString(),
      provider,
    );
  }

  async acceptCompanionHrvRmssdObservation(input: {
    acceptedAt: string;
    observation: CompanionHrvRmssdObservation;
    userId: string;
  }): Promise<void> {
    const resource = buildHostedCompanionHrvRmssdDirtyResource(input.observation);
    const connections = await this.context.store.listConnectionsForUser(input.userId);
    const receipt = await this.context.store.inspectCompanionHrvNightReceipt({
      connectionIds: connections
        .filter((connection) => connection.provider === "junction")
        .map((connection) => connection.id),
      nightDate: input.observation.nightDate,
      now: input.acceptedAt,
      resource,
      userId: input.userId,
    });
    if (receipt === "exact") {
      return;
    }
    if (receipt === "conflict") {
      throw deviceSyncError({
        code: "COMPANION_HRV_NIGHT_CONFLICT",
        message: "A different overnight HRV summary was already accepted for this night.",
        retryable: false,
        httpStatus: 409,
      });
    }

    assertCompanionHrvRmssdObservationFresh(input.observation, {
      now: new Date(input.acceptedAt),
    });
    // Data ingress must never establish or reactivate a connection. The
    // explicit sign-in-token flow owns that lifecycle transition; queued
    // observations after disconnect fail closed here.
    const account = await resolveCompanionHrvRmssdConnection({
      connections,
      memberId: input.userId,
      store: this.context.store,
    });

    await acceptHostedCompanionHrvRmssdObservation({
      acceptedAt: input.acceptedAt,
      account,
      resource,
      store: this.context.store,
      userId: input.userId,
    });
  }

  async handleConnectionCallback(
    provider: string,
    options: { expectedOwnerId: string },
  ): Promise<CompleteConnectionResult> {
    const url = new URL(this.context.request.url);
    const handleConnectionCallback =
      typeof Reflect.get(this.ingress, "handleConnectionCallback") === "function"
        ? this.ingress.handleConnectionCallback.bind(this.ingress)
        : this.ingress.handleOAuthCallback.bind(this.ingress);

    return handleConnectionCallback({
      provider,
      query: url.searchParams,
      code: url.searchParams.get("code"),
      expectedOwnerId: options.expectedOwnerId,
      state: url.searchParams.get("murph_state") ?? url.searchParams.get("state"),
      scope: url.searchParams.get("scope"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description"),
    });
  }

  async readWebhookRawBody(): Promise<Buffer> {
    try {
      return await readRawBodyBuffer(this.context.request, {
        limitBytes: DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES,
      });
    } catch (error) {
      if (error instanceof RangeError) {
        throw deviceSyncError({
          code: "PAYLOAD_TOO_LARGE",
          message: error.message,
          retryable: false,
          httpStatus: 413,
        });
      }

      throw error;
    }
  }

  async handleWebhook(provider: string, rawBody?: Buffer): Promise<HandleWebhookResult> {
    const resolvedRawBody = rawBody ?? (await this.readWebhookRawBody());
    // One webhook request opens and seals several secure-box fields under the
    // member's device domain roots. Scope the unwrap memo to the request so
    // each distinct root key costs at most one KMS round trip per request
    // instead of one per field: the concrete root is unwrapped by the account
    // lookup before the admission transaction, while the @active root used for
    // sealing payloads is a separate cache key whose first unwrap still runs
    // inside the transaction. Hosted-onboarding webhooks use the same seam.
    return runWithHostedDomainRootUnwrapCache(() =>
      this.ingress.handleWebhook(provider, this.context.request.headers, resolvedRawBody),
    );
  }

  async resolveWebhookPreflight(
    provider: string,
    rawBody: Buffer,
  ): Promise<DeviceSyncWebhookPreflightResponse | null> {
    return resolveDeviceSyncWebhookPreflightResponse({
      provider,
      registry: this.registry,
      method: this.context.request.method,
      url: new URL(this.context.request.url),
      headers: this.context.request.headers,
      rawBody,
    });
  }

  async disconnectConnection(userId: string, connectionId: string): Promise<{
    connection: HostedBrowserDeviceSyncConnection;
    warning?: { code: string; historicalResetIncomplete?: true; message: string };
  }> {
    const connection = await this.requireOwnedBrowserConnection(userId, connectionId);
    const disconnected = await disconnectHostedDeviceSyncConnection({
      connectionId: connection.id,
      registry: this.registry,
      store: this.context.store,
      userId,
    });

    return {
      connection: this.toBrowserConnection(disconnected.connection),
      // The browser chooses the manual-removal-before-reconnect guidance from this
      // semantic flag instead of matching internal warning codes.
      ...(disconnected.warning
        ? {
            warning: {
              ...disconnected.warning,
              ...(disconnected.warning.code === DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE
                ? { historicalResetIncomplete: true as const }
                : {}),
            },
          }
        : {}),
    };
  }

  async disconnectConnectionSource(
    userId: string,
    connectionId: string,
    sourceProviderSlug: string,
  ): Promise<{ sourceProviderSlug: string; status: "disconnected" }> {
    const connection = await this.requireOwnedBrowserConnection(userId, connectionId);

    return disconnectHostedDeviceSyncConnectionSource({
      connectionId: connection.id,
      registry: this.registry,
      sourceProviderSlug,
      store: this.context.store,
      userId,
    });
  }

  async disconnectAllConnections(userId: string): Promise<{
    attemptedCount: number;
    disconnectedCount: number;
    failedCount: number;
  }> {
    const connections = (await this.context.store.listConnectionsForUser(userId))
      .filter((connection) => connection.status !== "disconnected");
    let attemptedCount = 0;
    let disconnectedCount = 0;
    let failedCount = 0;

    for (const connection of connections) {
      if (await readHostedHealthDataConsentState({
        memberId: userId,
        prisma: this.context.store.prisma,
      }) !== "revoked") {
        break;
      }
      attemptedCount += 1;
      try {
        await disconnectHostedDeviceSyncConnection({
          connectionId: connection.id,
          registry: this.registry,
          store: this.context.store,
          userId,
        });
        disconnectedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.error("Health-data consent withdrawal could not disconnect a source.", {
          ...formatHostedExecutionSafeLogErrorDetails(error, {
            code: "HEALTH_DATA_CONSENT_SOURCE_DISCONNECT_FAILED",
          }),
          provider: connection.provider,
        });
      }
    }

    return {
      attemptedCount,
      disconnectedCount,
      failedCount,
    };
  }

  toBrowserConnection(account: PublicDeviceSyncAccount): HostedBrowserDeviceSyncConnection {
    return toHostedBrowserDeviceSyncConnection(account, this.context.env.routingIndexKey);
  }

  createBrowserConnectionId(connectionId: string): string {
    return createHostedBrowserConnectionId(this.context.env.routingIndexKey, connectionId);
  }

  private async hasWithdrawnHealthDataConsent(connectionId: string): Promise<boolean> {
    const memberId = await this.context.store.getConnectionOwnerId(connectionId);
    if (!memberId) {
      return false;
    }

    return await readHostedHealthDataConsentState({
      memberId,
      prisma: this.context.store.prisma,
    }) === "revoked";
  }

  private async requireOwnedBrowserConnection(
    userId: string,
    publicConnectionId: string,
  ): Promise<PublicDeviceSyncAccount> {
    const connections = await this.context.store.listConnectionsForUser(userId);
    const connection = connections.find(
      (candidate) => this.createBrowserConnectionId(candidate.id) === publicConnectionId,
    ) ?? null;

    if (connection) {
      return connection;
    }

    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
      httpStatus: 404,
    });
  }

}

function companionSdkReconnectRequiredError(): Error {
  return deviceSyncError({
    code: "SDK_SIGN_IN_RECONNECT_REQUIRED",
    message: "Reconnect the device-sync provider before resuming SDK sign-in.",
    retryable: false,
    httpStatus: 409,
  });
}

function buildPreparedSourceLifecycleKey(
  userId: string,
  provider: string,
  sourceProviderSlug: string | null,
): string | null {
  const normalizedSourceProviderSlug = normalizeJunctionProviderSlug(sourceProviderSlug);
  return provider === "junction" && normalizedSourceProviderSlug
    ? `${userId}\u0000${normalizedSourceProviderSlug}`
    : null;
}

export function createHostedDeviceSyncPublicIngressService(
  request: Request,
): HostedDeviceSyncPublicIngressService {
  const context = createHostedDeviceSyncControlPlaneContext(request);
  const webhookAdmin = new HostedDeviceSyncWebhookAdminService(context);
  const registry = createHostedDeviceSyncRegistry(process.env);

  return new HostedDeviceSyncPublicIngressService(context, webhookAdmin, registry);
}

export async function disconnectAllHostedDeviceSyncConnectionsForUser(input: {
  request: Request;
  userId: string;
}) {
  return createHostedDeviceSyncPublicIngressService(input.request)
    .disconnectAllConnections(input.userId);
}
