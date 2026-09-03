import {
  HOSTED_STANDBY_LOCATION_HINT,
  HOSTED_STANDBY_REGION,
  readHostedStandbyMode,
  readHostedStandbyReleaseId,
  resolveHostedStandbyCoordinatorName,
  type HostedStandbyCoordinatorState,
} from "../../standby-runner-contract.ts";
import {
  json,
  notFound,
} from "../../json.ts";
import type {
  WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  matchExactPath,
} from "../routes.ts";
import {
  isHostedWorkerTestEnvironment,
  requireHostedWorkerTestEnvironment,
} from "../route-utils/test-env.ts";

export const testStandbyRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context) {
      return await handleTestEnsureStandbyReadyRoute(context);
    },
    match: matchExactPath("/__test/standby/ensure-ready"),
    methods: ["POST"],
    name: "test-ensure-standby-ready",
    wrongMethodResponse: "not-found",
  },
];

export async function handleTestEnsureStandbyReadyRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }
  if (readHostedStandbyMode(context.env) !== "allocate") {
    return json({ error: "Hosted standby allocation is not enabled." }, 409);
  }

  const releaseId = readHostedStandbyReleaseId(context.env);
  const namespace = context.env.STANDBY_COORDINATOR;
  if (!releaseId || !namespace) {
    return json({ error: "Hosted standby coordination is unavailable." }, 503);
  }

  const coordinator = namespace.getByName(
    resolveHostedStandbyCoordinatorName({
      releaseId,
      region: HOSTED_STANDBY_REGION,
    }),
    { locationHint: HOSTED_STANDBY_LOCATION_HINT },
  );
  if (!coordinator.readStandbyCoordinatorState) {
    return json({ error: "Hosted standby state inspection is unavailable." }, 503);
  }

  let state: HostedStandbyCoordinatorState =
    await coordinator.readStandbyCoordinatorState();
  if (!state.readySlotName && !state.provisioningSlotName) {
    await coordinator.ensureReadyStandby({
      releaseId,
      region: HOSTED_STANDBY_REGION,
    });
    state = await coordinator.readStandbyCoordinatorState();
  }
  return json(state);
}
