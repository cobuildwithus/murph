import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
} from "@murphai/hosted-execution";

import {
  json,
} from "../../json.ts";
import {
  createHostedR2PresignedPutUrl,
  readHostedR2PresignEnvironment,
} from "../../r2-presigned-url.ts";
import {
  asWorkerStringEnvironment,
} from "../../worker-contracts.ts";
import {
  type WorkerEnvironmentSource,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import {
  HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
} from "../../workspace-snapshot-store.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
import {
  matchExactPath,
} from "../routes.ts";
import {
  DEPLOY_CONTAINER_SMOKE_BODY_LIMIT_BYTES,
} from "../route-utils/json-body.ts";
import {
  readWorkerVersionId,
} from "../public-routes.ts";

const DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_BYTES = 160 * 1024 * 1024;
const DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_KEY_PREFIX =
  "deploy-smoke/direct-r2-presigned-put";

export const deploySmokeRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "web-callback-signature",
    async handle(context) {
      return handleDeployContainerSmokeRoute(context);
    },
    match: matchExactPath("/internal/deploy/container-smoke"),
    methods: ["POST"],
    name: "deploy-container-smoke",
    signatureBodyLimitBytes: DEPLOY_CONTAINER_SMOKE_BODY_LIMIT_BYTES,
    wrongMethodResponse: "method-not-allowed",
  },
];

export async function handleDeployContainerSmokeRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  const directR2PresignedPut = context.url.searchParams.get("directR2PresignedPut") === "1";
  const container = context.env.RUNNER_CONTAINER_SMOKE
    .getByName(resolveDeployContainerSmokeObjectName(context.env));
  const directR2Smoke = directR2PresignedPut
    ? await createDeployContainerDirectR2PresignedPutSmoke(context)
    : null;
  let result: Awaited<ReturnType<typeof container.smokeHealth>>;
  let primaryError: unknown = null;

  try {
    result = await container.smokeHealth({
      ...(directR2Smoke ? { directR2PresignedPut: directR2Smoke.containerInput } : {}),
    });

    if (directR2Smoke) {
      await assertDeployContainerDirectR2PresignedPutSmokeObject(context, {
        expectedByteLength: directR2Smoke.containerInput.byteLength,
        objectKey: directR2Smoke.objectKey,
        result: result.directR2PresignedPut ?? null,
      });
    }
  } catch (error) {
    primaryError = error;
    emitHostedExecutionStructuredLog({
      component: "cloudflare.worker",
      details: {
        errorCode: deriveHostedExecutionErrorCode(error),
        errorName: readHostedExecutionSafeErrorName(error),
      },
      error,
      level: "error",
      message: "Deploy container smoke failed.",
      phase: "failed",
    });
    // This internal deploy-only route carries content-free smoke diagnostics
    // in the error message; return them instead of the redacted generic 500
    // so CI smoke logs name the real failure.
    return json({
      detail: error instanceof Error ? error.message : String(error),
      error: "Deploy container smoke failed.",
      ok: false,
    }, 500);
  } finally {
    if (directR2Smoke) {
      await deleteDeployContainerDirectR2PresignedPutSmokeObject(context, directR2Smoke.objectKey)
        .catch((cleanupError: unknown) => {
          if (!primaryError) {
            throw cleanupError;
          }
          emitHostedExecutionStructuredLog({
            component: "cloudflare.worker",
            details: {
              errorCode: deriveHostedExecutionErrorCode(cleanupError),
              errorName: readHostedExecutionSafeErrorName(cleanupError),
            },
            level: "warn",
            message: "Deploy direct R2 presigned PUT smoke cleanup failed.",
            phase: "failed",
          });
        });
    }
  }

  return json({
    ok: result.ok === true,
    runnerContainer: result,
    service: "cloudflare-hosted-runner",
  });
}

export async function createDeployContainerDirectR2PresignedPutSmoke(
  context: WorkerRouteContext,
): Promise<{
  containerInput: {
    byteLength: number;
    presignedPutUrl: string;
  };
  objectKey: string;
}> {
  const objectKey = [
    DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_KEY_PREFIX,
    `${crypto.randomUUID()}.bin`,
  ].join("/");
  const { url } = await createHostedR2PresignedPutUrl({
    contentType: HOSTED_WORKSPACE_SNAPSHOT_CONTENT_TYPE,
    environment: readHostedR2PresignEnvironment(asWorkerStringEnvironment(context.env)),
    key: objectKey,
  });

  return {
    containerInput: {
      byteLength: DEPLOY_DIRECT_R2_PRESIGNED_PUT_SMOKE_BYTES,
      presignedPutUrl: url,
    },
    objectKey,
  };
}

export async function assertDeployContainerDirectR2PresignedPutSmokeObject(
  context: WorkerRouteContext,
  input: {
    expectedByteLength: number;
    objectKey: string;
    result: {
      byteLength?: number | null;
      ok?: boolean;
      payloadSha256?: string | null;
      status?: number | null;
    } | null;
  },
): Promise<void> {
  if (input.result?.ok !== true || input.result.status !== 200) {
    throw new Error("Deploy direct R2 presigned PUT smoke did not complete successfully.");
  }
  if (input.result.byteLength !== input.expectedByteLength) {
    throw new Error("Deploy direct R2 presigned PUT smoke reported an unexpected byte count.");
  }
  if (
    typeof input.result.payloadSha256 !== "string"
    || !/^[0-9a-f]{64}$/u.test(input.result.payloadSha256)
  ) {
    throw new Error("Deploy direct R2 presigned PUT smoke did not report a payload hash.");
  }

  const bucket = context.env.BUNDLES;
  if (typeof bucket.head !== "function") {
    throw new Error("Deploy direct R2 presigned PUT smoke requires R2 HEAD support.");
  }
  const object = await bucket.head(input.objectKey);
  if (!object) {
    throw new Error("Deploy direct R2 presigned PUT smoke object was not found in R2.");
  }
  if (object.size !== input.expectedByteLength) {
    throw new Error("Deploy direct R2 presigned PUT smoke object had an unexpected byte count.");
  }
}

export async function deleteDeployContainerDirectR2PresignedPutSmokeObject(
  context: WorkerRouteContext,
  objectKey: string,
): Promise<void> {
  if (typeof context.env.BUNDLES.delete !== "function") {
    throw new Error("Deploy direct R2 presigned PUT smoke requires R2 delete support.");
  }
  await context.env.BUNDLES.delete(objectKey);
}

export function resolveDeployContainerSmokeObjectName(
  env: Pick<
    WorkerEnvironmentSource,
    | "CF_VERSION_METADATA"
    | "MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID"
    | "MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID"
  >,
): string {
  const hostedLocalObjectIdentity = shouldUseHostedLocalDeploySmokeBuildId(env)
    ? readHostedLocalRunnerBuildIdSegment(env)
    : null;
  const objectIdentity = hostedLocalObjectIdentity
    ?? readWorkerVersionId(env);
  return objectIdentity
    ? `__deploy-smoke-${objectIdentity}`
    : "__deploy-smoke";
}

function shouldUseHostedLocalDeploySmokeBuildId(
  env: Pick<
    WorkerEnvironmentSource,
    "MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID"
  >,
): boolean {
  return env.MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID === "1";
}

function readHostedLocalRunnerBuildIdSegment(
  env: Pick<WorkerEnvironmentSource, "MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID">,
): string | null {
  const raw = env.MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID;
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized.length > 0 ? normalized : null;
}
