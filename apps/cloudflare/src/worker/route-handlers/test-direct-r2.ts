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
  matchHostedLocalTestUserRoute,
} from "../route-utils/test-routes.ts";
import {
  resolveDeployContainerSmokeObjectName,
} from "./deploy-smoke.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "../../storage-paths.ts";
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
    match: matchHostedLocalTestUserRoute("/__test/users/", "/direct-r2-presigned-put"),
    methods: ["POST"],
    name: "test-direct-r2-presigned-put",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestDirectR2LocatorMarkerRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute("/__test/users/", "/direct-r2-locator-marker"),
    methods: ["POST"],
    name: "test-direct-r2-locator-marker",
    wrongMethodResponse: "not-found",
  },
];

export async function handleTestDirectR2LocatorMarkerRoute(
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
    "Hosted execution bound user does not match the direct R2 locator marker user.",
    "test-direct-r2-locator-marker-bound-user-mismatch",
    "test-direct-r2-locator-marker",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const body = await readTestDirectR2Body(context.request);
  if (body instanceof Response) {
    return body;
  }
  const snapshotId = normalizeNonEmptyString(body.snapshotId);
  const objectKey = normalizeNonEmptyString(body.objectKey);
  if (!snapshotId || !objectKey) {
    return json({ error: "snapshotId and objectKey are required." }, 400);
  }

  let expectedObjectKey: string;
  try {
    expectedObjectKey = await hostedWorkspaceSnapshotObjectKey({
      snapshotId,
      userId,
    });
  } catch {
    return json({ error: "snapshotId is invalid." }, 400);
  }
  if (objectKey !== expectedObjectKey) {
    return json({ error: "objectKey does not match the bound snapshot." }, 400);
  }

  // Hosted-local direct uploads live in MinIO while Wrangler's R2 bindings
  // emulate the production object-existence lookup. A zero-byte marker makes
  // that lookup truthful without copying the encrypted snapshot into a second
  // local object store; the returned presigned URL still reads from MinIO.
  await context.env.BUNDLES.put(objectKey, new Uint8Array());
  return json({ ok: true });
}

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

  const body = await readTestDirectR2Body(context.request);
  if (body instanceof Response) {
    return body;
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

async function readTestDirectR2Body(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return await readOptionalJsonObject(request, {
      limitBytes: INTERNAL_CONTROL_JSON_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Request body too large.", 413);
    }
    throw error;
  }
}
