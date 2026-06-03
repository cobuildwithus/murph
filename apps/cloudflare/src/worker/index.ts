import {
  readHostedExecutionEnvironment,
} from "../env.ts";
import {
  handleHostedEmailIngress,
} from "../hosted-email/worker-ingress.ts";
import {
  notFound,
} from "../json.ts";
import {
  asWorkerStringEnvironment,
} from "../worker-contracts.ts";
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
  handleDeclarativeRoute,
} from "./routes.ts";

export async function handleWorkerFetch(
  request: Request,
  env: WorkerEnvironmentSource,
): Promise<Response> {
  const url = new URL(request.url);
  const publicResponse = await handleDeclarativeRoute(workerPublicRoutes, { env, request, url });
  if (publicResponse) {
    return publicResponse;
  }

  const stringEnv = asWorkerStringEnvironment(env);
  const environment = readHostedExecutionEnvironment(stringEnv);
  return (
    await handleDeclarativeRoute(workerInternalRoutes, {
      env,
      environment,
      request,
      url,
    })
  ) ?? notFound();
}

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
