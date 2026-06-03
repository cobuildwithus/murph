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
  readCachedRequestText,
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
  normalizeNonEmptyString,
  parseJsonValue,
  requireJsonRecord,
} from "../route-utils/json-body.ts";
import {
  readWorkerVersionId,
} from "../public-routes.ts";

const DEPLOY_OPENAI_INTERCEPT_SMOKE_WORKSPACE_VERSION = "0";
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
  const openAiIntercept = context.url.searchParams.get("openAiIntercept") === "1";
  const directR2PresignedPut = context.url.searchParams.get("directR2PresignedPut") === "1";
  const container = context.env.RUNNER_CONTAINER_SMOKE
    .getByName(resolveDeployContainerSmokeObjectName(context.env));
  const directR2Smoke = directR2PresignedPut
    ? await createDeployContainerDirectR2PresignedPutSmoke(context)
    : null;
  let result: Awaited<ReturnType<typeof container.smokeHealth>>;
  let primaryError: unknown = null;

  try {
    result = openAiIntercept
      ? await runDeployContainerOpenAiInterceptSmokeWithFence(
          context,
          container,
          directR2Smoke?.containerInput,
        )
      : await container.smokeHealth({
          ...(directR2Smoke ? { directR2PresignedPut: directR2Smoke.containerInput } : {}),
          openAiIntercept,
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
    throw error;
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

export async function runDeployContainerOpenAiInterceptSmokeWithFence(
  context: WorkerRouteContext,
  container: ReturnType<WorkerEnvironmentSource["RUNNER_CONTAINER_SMOKE"]["getByName"]>,
  directR2PresignedPut?: {
    byteLength: number;
    presignedPutUrl: string;
  },
): Promise<Awaited<ReturnType<typeof container.smokeHealth>>> {
  const userId = await readDeployContainerOpenAiInterceptSmokeUserId(context);
  if (!userId) {
    throw new TypeError("OpenAI intercept deploy smoke requires openAiInterceptUserId.");
  }

  const userRunner = context.env.USER_RUNNER.getByName(userId);
  if (
    typeof userRunner.beginRuntimeWriteFenceForSmoke !== "function"
    || typeof userRunner.finishRuntimeWriteFenceForSmoke !== "function"
  ) {
    throw new TypeError("Hosted user runner does not support deploy-smoke write fences.");
  }

  const lease = await userRunner.beginRuntimeWriteFenceForSmoke({
    userId,
    workspaceVersion: DEPLOY_OPENAI_INTERCEPT_SMOKE_WORKSPACE_VERSION,
  });
  if (!lease) {
    throw new Error("OpenAI intercept deploy smoke could not acquire a hosted runner write fence.");
  }
  try {
    return await container.smokeHealth({
      ...(directR2PresignedPut ? { directR2PresignedPut } : {}),
      openAiIntercept: true,
      openAiInterceptAuthority: {
        attemptId: lease.attemptId,
        leaseGeneration: lease.generation,
        userId,
        workspaceVersion:
          lease.workspaceVersion ?? DEPLOY_OPENAI_INTERCEPT_SMOKE_WORKSPACE_VERSION,
      },
    });
  } finally {
    await userRunner.finishRuntimeWriteFenceForSmoke({
      attemptId: lease.attemptId,
      generation: lease.generation,
      userId,
    });
  }
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

export async function readDeployContainerOpenAiInterceptSmokeUserId(
  context: WorkerRouteContext,
): Promise<string | null> {
  const payloadText = await readCachedRequestText(context);
  if (!payloadText.trim()) {
    return null;
  }
  const payload = requireJsonRecord(
    parseJsonValue(payloadText),
    "Deploy container smoke request",
  );
  return normalizeNonEmptyString(payload.openAiInterceptUserId);
}

export function resolveDeployContainerSmokeObjectName(
  env: Pick<WorkerEnvironmentSource, "CF_VERSION_METADATA">,
): string {
  const workerVersionId = readWorkerVersionId(env);
  return workerVersionId
    ? `__deploy-smoke-${workerVersionId}`
    : "__deploy-smoke";
}
