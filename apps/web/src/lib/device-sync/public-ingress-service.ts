import {
  createDeviceSyncPublicIngress,
  resolveDeviceSyncWebhookPreflightResponse,
} from "@murphai/device-syncd/public-ingress";
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
  type DeviceSyncRegistry,
} from "@murphai/device-syncd/types";
import type { CompanionHrvRmssdObservation } from "@murphai/contracts";

import type { HostedDeviceSyncControlPlaneContext } from "./control-plane-context";
import { createHostedDeviceSyncControlPlaneContext } from "./control-plane-context";
import {
  assertCompanionHrvRmssdObservationFresh,
  resolveCompanionHrvRmssdConnection,
  type CompanionConnectionIntent,
} from "./companion";
import {
  toHostedBrowserDeviceSyncConnectionSource,
  type HostedBrowserDeviceSyncConnectionSource,
} from "./browser-connection-source";
import {
  createHostedBrowserConnectionId,
  toHostedBrowserDeviceSyncConnection,
  type HostedBrowserDeviceSyncConnection,
} from "./public-connection";
import {
  acceptHostedCompanionHrvRmssdObservation,
  buildHostedCompanionHrvRmssdDirtyResource,
  disconnectHostedDeviceSyncConnection,
  handleHostedDeviceSyncConnectionEstablished,
  handleHostedDeviceSyncUnknownWebhook,
  handleHostedDeviceSyncWebhookAccepted,
} from "./wake-service";
import { readRawBodyBuffer } from "./http";
import { HostedDeviceSyncWebhookAdminService } from "./webhook-admin-service";
import { createHostedDeviceSyncRegistry } from "./providers";

export class HostedDeviceSyncPublicIngressService {
  private readonly ingress;

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
          now,
          provider,
          sourceProviderSlug,
        }) => {
          await handleHostedDeviceSyncConnectionEstablished({
            account,
            connection,
            now,
            sourceProviderSlug: sourceProviderSlug ?? null,
            store: this.context.store,
          });

          await this.webhookAdmin.ensureHostedWebhookAdminUpkeepForConnectionEstablished(provider);
        },
        onLevelDirtyWebhookAlreadySatisfied: async ({ account }) => {
          const pending = await this.context.store.hasPendingDirtyConnection(account.id);
          return pending ? { accepted: true } : null;
        },
        onWebhookAccepted: async ({ account, claimToken, traceId, webhook, now }) => {
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

  async listConnections(userId: string): Promise<{
    providers: PublicProviderDescriptor[];
    connections: HostedBrowserDeviceSyncConnection[];
    connectionSources: HostedBrowserDeviceSyncConnectionSource[];
  }> {
    const connections = await this.context.store.listConnectionsForUser(userId);
    const connectionEntries = await Promise.all(
      connections.map(async (connection) => {
        const browserConnection = this.toBrowserConnection(connection);
        const sources = await this.context.store.listConnectionSources(connection.id);
        return {
          browserConnection,
          sources,
        };
      }),
    );

    return {
      providers: this.describeProviders(),
      connections: connectionEntries.map((entry) => entry.browserConnection),
      connectionSources: connectionEntries.flatMap((entry) =>
        entry.sources.map((source) => toHostedBrowserDeviceSyncConnectionSource(
          source,
          entry.browserConnection.id,
        ))
      ),
    };
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
    return this.ingress.startConnection({
      provider,
      returnTo,
      ownerId: userId,
      sourceProviderSlug: options.sourceProviderSlug ?? null,
      connectSourceId: options.connectSourceId ?? null,
      connectTarget: options.connectTarget ?? null,
    });
  }

  async handleOAuthCallback(
    provider: string,
    options: { expectedOwnerId?: string | null } = {},
  ): Promise<CompleteConnectionResult> {
    return this.handleConnectionCallback(provider, options);
  }

  /** Companion SDK sign-in. Only an explicit connect may change lifecycle state. */
  async createSdkSignInSession(
    userId: string,
    provider: string,
    connectionIntent: CompanionConnectionIntent | null,
  ): Promise<SdkSignInSessionResult> {
    if (connectionIntent === "connect") {
      return this.ingress.createSdkSignInSession({
        provider,
        ownerId: userId,
      });
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
    if (connectionIntent === null && providerConnections.length === 0) {
      return this.ingress.createSdkSignInSession({
        provider,
        ownerId: userId,
      });
    }

    throw deviceSyncError({
      code: "SDK_SIGN_IN_RECONNECT_REQUIRED",
      message: "Reconnect the device-sync provider before resuming SDK sign-in.",
      retryable: false,
      httpStatus: 409,
    });
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
    options: { expectedOwnerId?: string | null } = {},
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
      expectedOwnerId: options.expectedOwnerId ?? null,
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
    return this.ingress.handleWebhook(provider, this.context.request.headers, resolvedRawBody);
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

  toBrowserConnection(account: PublicDeviceSyncAccount): HostedBrowserDeviceSyncConnection {
    return toHostedBrowserDeviceSyncConnection(account, this.context.env.routingIndexKey);
  }

  createBrowserConnectionId(connectionId: string): string {
    return createHostedBrowserConnectionId(this.context.env.routingIndexKey, connectionId);
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

export function createHostedDeviceSyncPublicIngressService(
  request: Request,
): HostedDeviceSyncPublicIngressService {
  const context = createHostedDeviceSyncControlPlaneContext(request);
  const webhookAdmin = new HostedDeviceSyncWebhookAdminService(context);
  const registry = createHostedDeviceSyncRegistry(process.env);

  return new HostedDeviceSyncPublicIngressService(context, webhookAdmin, registry);
}
