import {
  createDeviceSyncPublicIngress,
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  type BeginConnectionResult,
  type CompleteConnectionResult,
  type HandleWebhookResult,
  type PublicDeviceSyncAccount,
  type PublicProviderDescriptor,
} from "@murphai/device-syncd/public-ingress";

import type { HostedDeviceSyncControlPlaneContext } from "./control-plane-context";
import { buildHostedDeviceSyncRuntimeSeedFromPublicAccount } from "./internal-runtime";
import {
  createHostedBrowserConnectionId,
  toHostedBrowserDeviceSyncConnection,
  type HostedBrowserDeviceSyncConnection,
} from "./public-connection";
import {
  disconnectHostedDeviceSyncConnection,
  handleHostedDeviceSyncConnectionEstablished,
  handleHostedDeviceSyncWebhookAccepted,
} from "./wake-service";
import { HostedDeviceSyncWebhookAdminService } from "./webhook-admin-service";
import { requireHostedExecutionControlClient } from "../hosted-execution/control";

export class HostedDeviceSyncPublicIngressService {
  private readonly ingress;

  constructor(
    private readonly context: HostedDeviceSyncControlPlaneContext,
    private readonly webhookAdmin: HostedDeviceSyncWebhookAdminService,
  ) {
    this.ingress = createDeviceSyncPublicIngress({
      publicBaseUrl: this.context.publicIngressBaseUrl,
      allowedReturnOrigins: this.context.allowedReturnOrigins,
      registry: this.context.registry,
      store: this.context.store,
      hooks: {
        onConnectionEstablished: async ({ account, connection, now, provider }) => {
          const userId = await this.requireHostedConnectionOwnerId(account.id);
          const controlClient = requireHostedExecutionControlClient();
          const metadata = sanitizeStoredDeviceSyncMetadata(connection.metadata ?? {});
          const tokenBundle = {
            accessToken: connection.tokens.accessToken,
            accessTokenExpiresAt: connection.tokens.accessTokenExpiresAt ?? null,
            keyVersion: this.context.env.encryptionKeyVersion,
            refreshToken: connection.tokens.refreshToken ?? null,
            tokenVersion: 1,
          } as const;

          await controlClient.applyDeviceSyncRuntimeUpdates(userId, {
            occurredAt: now,
            updates: [
              {
                connectionId: account.id,
                connection: {
                  displayName: account.displayName,
                  metadata,
                  scopes: account.scopes,
                  status: account.status,
                },
                localState: {
                  lastErrorCode: account.lastErrorCode,
                  lastErrorMessage: account.lastErrorMessage,
                  lastSyncCompletedAt: account.lastSyncCompletedAt,
                  lastSyncErrorAt: account.lastSyncErrorAt,
                  lastSyncStartedAt: account.lastSyncStartedAt,
                  lastWebhookAt: account.lastWebhookAt,
                  nextReconcileAt: account.nextReconcileAt,
                },
                seed: buildHostedDeviceSyncRuntimeSeedFromPublicAccount({
                  account: {
                    ...account,
                    accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt,
                    metadata,
                  },
                  externalAccountId: connection.externalAccountId,
                  tokenBundle,
                }),
                tokenBundle,
              },
            ],
          });
          await this.context.store.syncDurableConnectionState({
            ...account,
            accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt,
            metadata,
          });

          await handleHostedDeviceSyncConnectionEstablished({
            account,
            connection,
            now,
            store: this.context.store,
          });

          await this.webhookAdmin.ensureHostedWebhookAdminUpkeepForConnectionEstablished(provider);
        },
        onWebhookAccepted: async ({ account, webhook, now }) => {
          await handleHostedDeviceSyncWebhookAccepted({
            account,
            now,
            store: this.context.store,
            webhook,
          });
        },
      },
    });
  }

  describeProviders(): PublicProviderDescriptor[] {
    return this.ingress.describeProviders();
  }

  async listConnections(userId: string): Promise<{
    providers: PublicProviderDescriptor[];
    connections: HostedBrowserDeviceSyncConnection[];
  }> {
    const connections = await this.context.store.listConnectionsForUser(userId);

    return {
      providers: this.describeProviders(),
      connections: connections.map((connection) => this.toBrowserConnection(connection)),
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
  ): Promise<BeginConnectionResult> {
    return this.ingress.startConnection({
      provider,
      returnTo,
      ownerId: userId,
    });
  }

  async handleOAuthCallback(provider: string): Promise<CompleteConnectionResult> {
    const url = new URL(this.context.request.url);

    return this.ingress.handleOAuthCallback({
      provider,
      code: url.searchParams.get("code"),
      state: url.searchParams.get("state"),
      scope: url.searchParams.get("scope"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description"),
    });
  }

  async handleWebhook(provider: string): Promise<HandleWebhookResult> {
    const rawBody = Buffer.from(await this.context.request.arrayBuffer());
    return this.ingress.handleWebhook(provider, this.context.request.headers, rawBody);
  }

  async disconnectConnection(userId: string, connectionId: string): Promise<{
    connection: HostedBrowserDeviceSyncConnection;
    warning?: { code: string; message: string };
  }> {
    const connection = await this.requireOwnedBrowserConnection(userId, connectionId);
    const disconnected = await disconnectHostedDeviceSyncConnection({
      connectionId: connection.id,
      registry: this.context.registry,
      store: this.context.store,
      userId,
    });

    return {
      ...disconnected,
      connection: this.toBrowserConnection(disconnected.connection),
    };
  }

  toBrowserConnection(account: PublicDeviceSyncAccount): HostedBrowserDeviceSyncConnection {
    return toHostedBrowserDeviceSyncConnection(account, this.context.env.encryptionKey);
  }

  createBrowserConnectionId(connectionId: string): string {
    return createHostedBrowserConnectionId(this.context.env.encryptionKey, connectionId);
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

  private async requireHostedConnectionOwnerId(connectionId: string): Promise<string> {
    const ownerId = await this.context.store.getConnectionOwnerId(connectionId);

    if (ownerId) {
      return ownerId;
    }

    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
      httpStatus: 404,
    });
  }
}
