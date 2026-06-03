import {
  json,
  jsonError,
  notFound,
  readOptionalJsonObject,
} from "../../json.ts";
import type {
  WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  requireHostedExecutionBoundUserResponse,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  matchTestUserRoute,
} from "../routes.ts";
import {
  INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
  normalizeNonEmptyString,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";
import {
  isHostedWorkerTestEnvironment,
  requireHostedWorkerTestEnvironment,
} from "../route-utils/test-env.ts";
import {
  resolveDeployContainerSmokeObjectName,
} from "./deploy-smoke.ts";
import {
  parseTestPositiveIntegerValue,
} from "./test-runner.ts";

export const testDirectR2Routes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestDirectR2PresignedPutRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/direct-r2-presigned-put"),
    methods: ["POST"],
    name: "test-direct-r2-presigned-put",
    wrongMethodResponse: "not-found",
  },
];

export async function handleTestDirectR2PresignedPutRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
): Promise<Response> {
  if (!isHostedWorkerTestEnvironment(context.env)) {
    return notFound();
  }

  const userId = decodeRouteParam(encodedUserId);
  const boundUserResponse = requireHostedExecutionBoundUserResponse(
    context.request,
    userId,
    "Hosted execution bound user does not match the test runner user.",
    "test-runner-bound-user-mismatch",
    "test-direct-r2-presigned-put",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  let body: Record<string, unknown>;
  try {
    body = await readOptionalJsonObject(context.request, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Request body too large.", 413);
    }
    throw error;
  }

  const presignedPutUrl = normalizeNonEmptyString(body.presignedPutUrl);
  if (!presignedPutUrl) {
    return json({ error: "presignedPutUrl is required." }, 400);
  }

  const byteLength = parseTestPositiveIntegerValue(body.byteLength);
  if (byteLength === "invalid") {
    return json({ error: "Unsupported test direct R2 byte length." }, 400);
  }
  const tlsCaCertificatePem = normalizeNonEmptyString(body.tlsCaCertificatePem);

  const container = context.env.RUNNER_CONTAINER_SMOKE
    .getByName(resolveDeployContainerSmokeObjectName(context.env));
  const result = await container.smokeHealth({
    directR2PresignedPut: {
      ...(byteLength === null ? {} : { byteLength }),
      presignedPutUrl,
      ...(tlsCaCertificatePem ? { tlsCaCertificatePem } : {}),
    },
  });

  return json({
    directR2PresignedPut: result.directR2PresignedPut ?? null,
    ok: result.directR2PresignedPut?.ok === true,
    runnerContainer: result,
    service: "cloudflare-hosted-runner",
  });
}
