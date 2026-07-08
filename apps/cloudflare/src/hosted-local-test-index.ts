export { ContainerProxy } from "@cloudflare/containers";
export {
  DeploySmokeRunnerContainer,
} from "./runner-container.ts";
export {
  RunnerContainer,
} from "./hosted-local-test/runner-container.ts";
export {
  HostedLocalTestUserRunnerDurableObject as UserRunnerDurableObject,
} from "./worker/hosted-local-test-user-runner-durable-object.ts";

import {
  handleHostedEmailIngress,
} from "./hosted-email/worker-ingress.ts";
import type {
  WorkerExecutionContext,
  WorkerEnvironmentSource,
} from "./worker-routes/shared.ts";
import {
  mapWorkerRouteError,
} from "./worker/errors.ts";
import {
  createWorkerFetchHandler,
} from "./worker/fetch-handler.ts";
import {
  hostedLocalTestInternalRoutes,
} from "./worker/hosted-local-test-routes.ts";
import {
  workerPublicRoutes,
} from "./worker/public-routes.ts";

export const handleHostedLocalTestWorkerFetch = createWorkerFetchHandler({
  internalRoutes: hostedLocalTestInternalRoutes,
  publicRoutes: workerPublicRoutes,
});

export default {
  async fetch(
    request: Request,
    env: WorkerEnvironmentSource,
    ctx?: WorkerExecutionContext,
  ): Promise<Response> {
    try {
      return await handleHostedLocalTestWorkerFetch(request, env, ctx);
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
