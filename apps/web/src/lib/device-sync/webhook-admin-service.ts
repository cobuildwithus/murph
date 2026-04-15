import type { DeviceSyncProvider } from "@murphai/device-syncd/public-ingress";
import {
  normalizeHostedExecutionErrorMessage,
  normalizeHostedExecutionOperatorMessage,
} from "@murphai/hosted-execution";

import type { HostedDeviceSyncControlPlaneContext } from "./control-plane-context";

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
        errorMessage: normalizeHostedExecutionOperatorMessage(
          normalizeHostedExecutionErrorMessage(error),
        ),
        errorType: describeHostedWebhookAdminErrorType(error),
      });
    }
  }
}

function describeHostedWebhookAdminErrorType(error: unknown): string {
  if (error instanceof Error) {
    const constructorName = error.constructor?.name;
    return typeof constructorName === "string" && constructorName.length > 0
      ? constructorName
      : error.name || "Error";
  }

  if (Array.isArray(error)) {
    return "array";
  }

  return error === null ? "null" : typeof error;
}
