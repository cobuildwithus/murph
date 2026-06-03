import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";

import {
  json,
  readOptionalJsonObject,
} from "../../json.ts";
import type {
  WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireBoundInternalRouteUser,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  buildWorkerRouteLogDetails,
} from "../route-utils/log-details.ts";
import {
  INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";

export const userDataDeleteRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    beforeMethod(context, params) {
      return requireBoundInternalRouteUser(context, params, "user-data-delete");
    },
    async handle(context, params) {
      return handleUserDataDeleteRoute(context, params.userId);
    },
    match: (pathname) => matchCloudflareHostedControlUserRoutePath("userDataDelete", pathname),
    methods: [CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.userDataDelete.method],
    name: "user-data-delete",
    wrongMethodResponse: "method-not-allowed",
  },
];

export async function handleUserDataDeleteRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  const userId = decodeRouteParam(encodedUserId);
  try {
    await readOptionalJsonObject(context.request, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "worker",
      details: buildWorkerRouteLogDetails({
        reason: "user-data-delete-request-body-invalid",
        routeName: "user-data-delete",
      }, context.request, userId),
      error,
      level: "warn",
      message: "Hosted worker user-data deletion route rejected an invalid request body.",
      phase: "failed",
      userId,
    });
    throw error;
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  return json(await stub.deleteHostedUserData(userId));
}
