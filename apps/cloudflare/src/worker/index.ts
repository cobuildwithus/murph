import {
  handleHostedEmailIngress,
} from "../hosted-email/worker-ingress.ts";
import type {
  WorkerExecutionContext,
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";
import {
  mapWorkerRouteError,
} from "./errors.ts";
import {
  workerInternalRoutes,
} from "./internal-routes.ts";
import {
  workerPublicRoutes,
} from "./public-routes.ts";
import {
  createWorkerFetchHandler,
} from "./fetch-handler.ts";
import { handleHostedDeviceWebhookQueueBatch } from "../device-webhook-queue.ts";
import type { DeviceWebhookQueueEnvelopeV1 } from "@murphai/cloudflare-hosted-control/device-webhook-queue";

export const handleWorkerFetch = createWorkerFetchHandler({
  internalRoutes: workerInternalRoutes,
  publicRoutes: workerPublicRoutes,
});

const DATABASE_HEALTH_SINGLETON_NAME = "production";
const DEVICE_WEBHOOK_QUEUE_HEALTH_SINGLETON_NAME = "production";

export function handleDatabaseHealthScheduled(
  controller: ScheduledController,
  env: WorkerEnvironmentSource,
  ctx: WorkerExecutionContext,
): void {
  if (env.HOSTED_DATABASE_ALERT_ENABLED !== "1") {
    return;
  }
  const namespace = env.DATABASE_HEALTH_MONITOR;
  if (!namespace) {
    throw new Error("DATABASE_HEALTH_MONITOR binding is required.");
  }
  ctx.waitUntil(
    namespace.getByName(DATABASE_HEALTH_SINGLETON_NAME).runScheduledCheck({
      scheduledAtMs: controller.scheduledTime,
    }),
  );
}

export function handleDeviceWebhookQueueHealthScheduled(
  controller: ScheduledController,
  env: WorkerEnvironmentSource,
  ctx: WorkerExecutionContext,
): void {
  if (env.HOSTED_DATABASE_ALERT_ENABLED !== "1") {
    return;
  }
  const namespace = env.DEVICE_WEBHOOK_QUEUE_MONITOR;
  if (!namespace) {
    throw new Error("DEVICE_WEBHOOK_QUEUE_MONITOR binding is required.");
  }
  ctx.waitUntil(
    namespace.getByName(DEVICE_WEBHOOK_QUEUE_HEALTH_SINGLETON_NAME)
      .runScheduledCheck({
        scheduledAtMs: controller.scheduledTime,
      }),
  );
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnvironmentSource,
    ctx?: WorkerExecutionContext,
  ): Promise<Response> {
    try {
      return await handleWorkerFetch(request, env, ctx);
    } catch (error) {
      return mapWorkerRouteError(request, error);
    }
  },
  async email(
    message: ForwardableEmailMessage,
    env: WorkerEnvironmentSource,
    ctx?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    await handleHostedEmailIngress(message, env, ctx);
  },
  async queue(
    batch: MessageBatch<DeviceWebhookQueueEnvelopeV1>,
    env: WorkerEnvironmentSource,
  ): Promise<void> {
    await handleHostedDeviceWebhookQueueBatch(batch, env);
  },
  scheduled(
    controller: ScheduledController,
    env: WorkerEnvironmentSource,
    ctx: WorkerExecutionContext,
  ): void {
    handleDatabaseHealthScheduled(controller, env, ctx);
    handleDeviceWebhookQueueHealthScheduled(controller, env, ctx);
  },
};
