import {
  handleHostedEmailIngress,
} from "../hosted-email/worker-ingress.ts";
import type {
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

export default {
  async fetch(
    request: Request,
    env: WorkerEnvironmentSource,
  ): Promise<Response> {
    try {
      return await handleWorkerFetch(request, env);
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
};
