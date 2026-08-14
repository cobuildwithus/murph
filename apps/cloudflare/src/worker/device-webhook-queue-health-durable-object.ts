import { DurableObject } from "cloudflare:workers";

import {
  DeviceWebhookQueueHealthMonitor,
  type DeviceWebhookQueueAlertSender,
  type DeviceWebhookQueueHealthMonitorResult,
} from "../device-webhook-queue-health/monitor.js";
import type {
  DeviceWebhookQueueHealthObservation,
  DeviceWebhookQueueHealthState,
} from "../device-webhook-queue-health/store.js";
import { sendOperatorLinqAlert } from "../operator-alert/linq.js";
import type { DurableObjectStateLike } from "../user-runner/types.js";

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";

export interface DeviceWebhookQueueHealthDurableObjectEnvironment {
  DEVICE_WEBHOOK_DLQ?: Pick<Queue<unknown>, "metrics">;
  DEVICE_WEBHOOK_QUEUE?: Pick<Queue<unknown>, "metrics">;
  HOSTED_DATABASE_ALERT_LINQ_CHAT_ID?: string;
  HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID?: string;
  LINQ_API_BASE_URL?: string;
  LINQ_API_TOKEN?: string;
}

export class DeviceWebhookQueueHealthDurableObject extends DurableObject {
  private readonly monitor: DeviceWebhookQueueHealthMonitor;

  constructor(
    state: DurableObjectStateLike,
    environment: DeviceWebhookQueueHealthDurableObjectEnvironment,
    alertSender: DeviceWebhookQueueAlertSender =
      createOperatorAlertSender(environment),
  ) {
    super(state as never, environment as never);
    if (!environment.DEVICE_WEBHOOK_QUEUE || !environment.DEVICE_WEBHOOK_DLQ) {
      throw new Error(
        "Device webhook Queue health monitor requires main and dead-letter Queue bindings.",
      );
    }
    this.monitor = new DeviceWebhookQueueHealthMonitor(
      state.storage,
      {
        deadLetterQueue: environment.DEVICE_WEBHOOK_DLQ,
        mainQueue: environment.DEVICE_WEBHOOK_QUEUE,
      },
      alertSender,
    );
  }

  async runScheduledCheck(_input?: {
    scheduledAtMs?: number;
  }): Promise<DeviceWebhookQueueHealthMonitorResult> {
    return await this.monitor.runScheduledCheck();
  }

  readLatestObservation(): DeviceWebhookQueueHealthObservation | null {
    return this.monitor.readLatestObservation();
  }

  readState(): DeviceWebhookQueueHealthState {
    return this.monitor.readState();
  }
}

function createOperatorAlertSender(
  environment: DeviceWebhookQueueHealthDurableObjectEnvironment,
): DeviceWebhookQueueAlertSender {
  const apiBaseUrl = environment.LINQ_API_BASE_URL?.trim()
    || DEFAULT_LINQ_API_BASE_URL;
  const apiToken = readRequiredEnvironmentValue(
    environment.LINQ_API_TOKEN,
    "LINQ_API_TOKEN",
  );
  const chatIds: readonly [primary: string, secondary: string] = [
    readRequiredEnvironmentValue(
      environment.HOSTED_DATABASE_ALERT_LINQ_CHAT_ID,
      "HOSTED_DATABASE_ALERT_LINQ_CHAT_ID",
    ),
    readRequiredEnvironmentValue(
      environment.HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID,
      "HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID",
    ),
  ];
  return {
    async send(input): Promise<void> {
      await sendOperatorLinqAlert({
        apiBaseUrl,
        apiToken,
        chatIds,
        idempotencyKey: input.idempotencyKey,
        message: input.message,
      });
    },
  };
}

function readRequiredEnvironmentValue(
  value: string | undefined,
  name: string,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required for device webhook Queue alerts.`);
  }
  return normalized;
}
