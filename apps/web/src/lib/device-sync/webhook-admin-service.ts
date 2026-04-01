import type { DeviceSyncProvider, PublicDeviceSyncAccount } from "@murphai/device-syncd";

import type { HostedDeviceSyncControlPlaneContext } from "./control-plane-context";

export class HostedDeviceSyncWebhookAdminService {
  constructor(private readonly context: HostedDeviceSyncControlPlaneContext) {}

  async ensureHostedWebhookAdminUpkeepForRuntimeSnapshot(input: {
    userId: string;
    provider?: string | null;
    connectionId?: string | null;
  }): Promise<void> {
    const providers = await this.resolveHostedWebhookAdminProvidersForRuntimeSnapshot(
      input.userId,
      input,
    );

    for (const provider of providers) {
      await this.runHostedWebhookAdminUpkeep({
        bestEffort: false,
        provider,
        reason: "runtime-snapshot",
      });
    }
  }

  async ensureHostedWebhookAdminUpkeepForConnectionEstablished(
    provider: DeviceSyncProvider,
  ): Promise<void> {
    await this.runHostedWebhookAdminUpkeep({
      bestEffort: true,
      provider,
      reason: "connection-established",
    });
  }

  private async runHostedWebhookAdminUpkeep(input: {
    bestEffort: boolean;
    provider: DeviceSyncProvider;
    reason: "connection-established" | "runtime-snapshot";
  }): Promise<void> {
    const ensureSubscriptions = input.provider.webhookAdmin?.ensureSubscriptions;

    if (!ensureSubscriptions) {
      return;
    }

    if (!input.bestEffort) {
      await ensureSubscriptions({
        publicBaseUrl: this.context.webhookAdminCallbackBaseUrl,
        verificationToken: this.context.env.ouraWebhookVerificationToken,
      });
      return;
    }

    try {
      await ensureSubscriptions({
        publicBaseUrl: this.context.webhookAdminCallbackBaseUrl,
        verificationToken: this.context.env.ouraWebhookVerificationToken,
      });
    } catch (error) {
      console.error("Failed to ensure hosted webhook admin upkeep.", {
        provider: input.provider.provider,
        reason: input.reason,
        callbackBaseUrlSource: this.context.webhookAdminCallbackBaseUrlSource,
        error,
      });
    }
  }

  private async resolveHostedWebhookAdminProvidersForRuntimeSnapshot(
    userId: string,
    input: {
      provider?: string | null;
      connectionId?: string | null;
    },
  ): Promise<DeviceSyncProvider[]> {
    const connections = input.connectionId
      ? [await this.context.store.getConnectionForUser(userId, input.connectionId)].filter(
          (connection): connection is PublicDeviceSyncAccount => connection !== null,
        )
      : await this.context.store.listConnectionsForUser(userId);
    const providerNames = selectHostedWebhookAdminProviderNames({
      connections,
      provider: input.provider ?? null,
      registry: this.context.registry,
    });

    return [...providerNames]
      .map((providerName) => this.context.registry.get(providerName))
      .filter((provider): provider is DeviceSyncProvider => Boolean(provider));
  }
}

function selectHostedWebhookAdminProviderNames(input: {
  connections: readonly PublicDeviceSyncAccount[];
  provider: string | null;
  registry: {
    get(provider: string): DeviceSyncProvider | undefined;
  };
}): Set<string> {
  const providerNames = new Set<string>();

  for (const connection of input.connections) {
    if (connection.status === "disconnected") {
      continue;
    }

    if (input.provider && connection.provider !== input.provider) {
      continue;
    }

    if (input.registry.get(connection.provider)?.webhookAdmin?.ensureSubscriptions) {
      providerNames.add(connection.provider);
    }
  }

  return providerNames;
}
