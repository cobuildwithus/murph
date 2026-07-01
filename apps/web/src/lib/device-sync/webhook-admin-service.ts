import type { DeviceSyncProvider } from "@murphai/device-syncd/types";

import type { HostedDeviceSyncControlPlaneContext } from "./control-plane-context";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";

export class HostedDeviceSyncWebhookAdminService {
  constructor(private readonly context: HostedDeviceSyncControlPlaneContext) {}

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
    reason: "connection-established";
  }): Promise<void> {
    const ensureSubscriptions = input.provider.webhookAdmin?.ensureSubscriptions;

    if (!ensureSubscriptions) {
      return;
    }

    if (!input.bestEffort) {
      await ensureSubscriptions({
        publicBaseUrl: this.context.publicIngressBaseUrl,
      });
      return;
    }

    try {
      await ensureSubscriptions({
        publicBaseUrl: this.context.publicIngressBaseUrl,
      });
    } catch (error) {
      console.error("Failed to ensure hosted webhook admin upkeep.", {
        ...formatHostedExecutionSafeLogErrorDetails(error, {
          code: "HOSTED_WEBHOOK_ADMIN_UPKEEP_FAILED",
        }),
        provider: input.provider.provider,
        reason: input.reason,
        publicIngressBaseUrlSource: this.context.publicIngressBaseUrlSource,
      });
    }
  }
}
