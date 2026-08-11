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

export const handleWorkerFetch = createWorkerFetchHandler({
  internalRoutes: workerInternalRoutes,
  publicRoutes: workerPublicRoutes,
});

const DATABASE_HEALTH_SINGLETON_NAME = "production";

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
  scheduled(
    controller: ScheduledController,
    env: WorkerEnvironmentSource,
    ctx: WorkerExecutionContext,
  ): void {
    handleDatabaseHealthScheduled(controller, env, ctx);
  },
};
