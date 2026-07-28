import {
  handleHostedEmailIngress,
} from "../hosted-email/worker-ingress.ts";
import type {
  WorkerExecutionContext,
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";
import {
  resolveHostedR2CutoverContext,
  withHostedR2CutoverBucket,
} from "../r2-cutover.ts";
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
    ctx?: WorkerExecutionContext,
  ): Promise<Response> {
    try {
      const cutoverContext = resolveHostedR2CutoverContext(env);
      return await handleWorkerFetch(
        request,
        withHostedR2CutoverBucket(env, cutoverContext),
        ctx,
      );
    } catch (error) {
      return mapWorkerRouteError(request, error);
    }
  },
  async email(
    message: ForwardableEmailMessage,
    env: WorkerEnvironmentSource,
    ctx?: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    const cutoverContext = resolveHostedR2CutoverContext(env);
    await handleHostedEmailIngress(
      message,
      withHostedR2CutoverBucket(env, cutoverContext),
      ctx,
    );
  },
};
