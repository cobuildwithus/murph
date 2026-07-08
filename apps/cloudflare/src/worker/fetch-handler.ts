import {
  readHostedExecutionEnvironment,
} from "../env.ts";
import {
  notFound,
} from "../json.ts";
import {
  asWorkerStringEnvironment,
} from "../worker-contracts.ts";
import type {
  WorkerRouteContext,
  WorkerExecutionContext,
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";
import type {
  DeclarativeRoute,
} from "./routes.ts";
import {
  handleDeclarativeRoute,
} from "./routes.ts";

export function createWorkerFetchHandler(input: {
  internalRoutes: readonly DeclarativeRoute<WorkerRouteContext>[];
  publicRoutes: readonly DeclarativeRoute<{
    env: WorkerEnvironmentSource;
    request: Request;
    url: URL;
  }>[];
}) {
  return async function handleWorkerFetch(
    request: Request,
    env: WorkerEnvironmentSource,
    executionCtx?: WorkerExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const publicResponse = await handleDeclarativeRoute(input.publicRoutes, { env, request, url });
    if (publicResponse) {
      return publicResponse;
    }

    const stringEnv = asWorkerStringEnvironment(env);
    const environment = readHostedExecutionEnvironment(stringEnv);
    return (
      await handleDeclarativeRoute(input.internalRoutes, {
        env,
        environment,
        ...(executionCtx ? { executionCtx } : {}),
        request,
        url,
      })
    ) ?? notFound();
  };
}
