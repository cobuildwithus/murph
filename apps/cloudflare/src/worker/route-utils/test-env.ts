import {
  asWorkerStringEnvironment,
} from "../../worker-contracts.ts";
import {
  notFound,
} from "../../json.ts";
import type {
  WorkerRouteContext,
  WorkerEnvironmentSource,
} from "../../worker-routes/shared.ts";

export function isHostedWorkerTestEnvironment(env: WorkerEnvironmentSource): boolean {
  const stringEnv = asWorkerStringEnvironment(env);
  return stringEnv.NODE_ENV === "test"
    && stringEnv.MURPH_HOSTED_LOCAL_TEST_ROUTES === "1";
}

export function requireHostedWorkerTestEnvironment(
  context: Pick<WorkerRouteContext, "env">,
): Response | null {
  return isHostedWorkerTestEnvironment(context.env) ? null : notFound();
}
