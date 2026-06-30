import {
  DEFAULT_DEVICE_SYNC_HTTP_BODY_LIMIT_BYTES,
  DEVICE_SYNC_WEBHOOK_TRACE_COMPLETED,
  createDeviceSyncPublicIngress,
  deviceSyncError,
  type BeginConnectionResult,
  type CompleteConnectionResult,
  type HandleWebhookResult,
  type PublicDeviceSyncAccount,
  type PublicProviderDescriptor,
  type SdkSignInSessionResult,
} from "@murphai/device-syncd/public-ingress";
import type { DeviceSyncRegistry } from "@murphai/device-syncd/types";

import type { HostedDeviceSyncControlPlaneContext } from "./control-plane-context";
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
  disconnectHostedDeviceSyncConnection,
  handleHostedDeviceSyncConnectionEstablished,
  handleHostedDeviceSyncUnknownWebhook,
  handleHostedDeviceSyncWebhookAccepted,
} from "./wake-service";
import { readRawBodyBuffer } from "./http";
import { HostedDeviceSyncWebhookAdminService } from "./webhook-admin-service";

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

  /**
   * Companion (mobile SDK) sign-in: ensures the established device-sync
   * account through the same shared ingress core the Link callback uses,
   * then mints the provider's short-lived SDK sign-in token. The token must
   * never be logged or persisted.
   */
  async createSdkSignInSession(
    userId: string,
    provider: string,
  ): Promise<SdkSignInSessionResult> {
    return this.ingress.createSdkSignInSession({
      provider,
      ownerId: userId,
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

  async disconnectConnection(userId: string, connectionId: string): Promise<{
    connection: HostedBrowserDeviceSyncConnection;
    warning?: { code: string; message: string };
  }> {
    const connection = await this.requireOwnedBrowserConnection(userId, connectionId);
    const disconnected = await disconnectHostedDeviceSyncConnection({
      connectionId: connection.id,
      registry: this.registry,
      store: this.context.store,
      userId,
    });

    return {
      ...disconnected,
      connection: this.toBrowserConnection(disconnected.connection),
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
