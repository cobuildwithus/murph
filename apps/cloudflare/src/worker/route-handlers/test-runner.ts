import type {
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_WORKSPACE_INVOCATION_REASONS,
} from "@murphai/hosted-execution/runtime-control";
import {
  parseHostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";

import {
  json,
  jsonError,
  notFound,
  readOptionalJsonObject,
} from "../../json.ts";
import {
  resolveHostedExecutionRunnerContainerName,
} from "../../runner-container.ts";
import {
  handleRunnerOutboundRequest,
} from "../../runner-outbound.ts";
import {
  writeRunnerRuntimeWriteFenceHeaders,
} from "../../runner-outbound/write-fence.ts";
import type {
  HostedRunnerStuckInvocationTestResult,
} from "../../user-runner.ts";
import type {
  UserRunnerDurableObjectStubLike,
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
  DIRECT_R2_PRESIGNED_PUT_TEST_BODY_LIMIT_BYTES,
  normalizeNonEmptyString,
} from "../route-utils/json-body.ts";
import {
  decodeRouteParam,
} from "../route-utils/route-params.ts";
import {
  isHostedWorkerTestEnvironment,
  requireHostedWorkerTestEnvironment,
} from "../route-utils/test-env.ts";

export const testRunnerRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestRunUntilIdleRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/run-until-idle"),
    methods: ["POST"],
    name: "test-run-until-idle",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestRunAlarmRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/alarm"),
    methods: ["POST"],
    name: "test-run-alarm",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestContainerActivityExpiredRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/container-activity-expired"),
    methods: ["POST"],
    name: "test-container-activity-expired",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestStartStuckInvocationRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/stuck-invocation"),
    methods: ["POST"],
    name: "test-start-stuck-invocation",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestCheckpointArtifactWriteFenceRoute(context, params.userId);
    },
    match: matchTestUserRoute("/__test/users/", "/checkpoint-artifact-write-fence"),
    methods: ["POST"],
    name: "test-checkpoint-artifact-write-fence",
    wrongMethodResponse: "not-found",
  },
];

export async function handleTestRunUntilIdleRoute(
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
    "test-run-until-idle",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.USER_RUNNER.getByName(userId) as UserRunnerDurableObjectStubLike & {
    runUntilIdleForTest(input: {
      reason: HostedWorkspaceInvocationReason;
      userId: string;
    }): Promise<HostedWorkspaceInvocationResult>;
  };
  const reason = parseTestWorkspaceInvocationReason(context.url.searchParams.get("reason"));
  if (reason === "invalid") {
    return json({ error: "Unsupported test workspace invocation reason." }, 400);
  }
  return json(await stub.runUntilIdleForTest({
    reason: reason ?? "manual",
    userId,
  }));
}

export async function handleTestRunAlarmRoute(
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
    "test-run-alarm",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.USER_RUNNER.getByName(userId);
  return json(await stub.runAlarmForTest({ userId }));
}

export async function handleTestContainerActivityExpiredRoute(
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
    "test-container-activity-expired",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const runnerContainerName = resolveHostedExecutionRunnerContainerName({
    source: context.env,
    userId,
  });
  const stub = context.env.RUNNER_CONTAINER.getByName(runnerContainerName);
  if (typeof stub.expireActivityForTest !== "function") {
    throw new Error("Hosted runner container test activity-expiry RPC is unavailable.");
  }
  return json(await stub.expireActivityForTest({ userId }));
}

export async function handleTestStartStuckInvocationRoute(
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
    "test-start-stuck-invocation",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.USER_RUNNER.getByName(userId) as UserRunnerDurableObjectStubLike & {
    startStuckInvocationForTest(input: {
      expiresInMs?: number;
      reason?: HostedWorkspaceInvocationReason;
      startedAgoMs?: number;
      userId: string;
    }): Promise<HostedRunnerStuckInvocationTestResult>;
  };
  const reason = parseTestWorkspaceInvocationReason(context.url.searchParams.get("reason"));
  if (reason === "invalid") {
    return json({ error: "Unsupported test stuck invocation reason." }, 400);
  }
  const expiresInMs = parseTestPositiveInteger(
    context.url.searchParams.get("expiresInMs"),
  );
  if (expiresInMs === "invalid") {
    return json({ error: "Unsupported test stuck invocation expiry." }, 400);
  }
  const startedAgoMs = parseTestPositiveInteger(
    context.url.searchParams.get("startedAgoMs"),
  );
  if (startedAgoMs === "invalid") {
    return json({ error: "Unsupported test stuck invocation age." }, 400);
  }
  return json(await stub.startStuckInvocationForTest({
    ...(expiresInMs === null ? {} : { expiresInMs }),
    ...(reason ? { reason } : {}),
    ...(startedAgoMs === null ? {} : { startedAgoMs }),
    userId,
  }));
}

export async function handleTestCheckpointArtifactWriteFenceRoute(
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
    "test-checkpoint-artifact-write-fence",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  let body: Record<string, unknown>;
  try {
    body = await readOptionalJsonObject(context.request, {
      limitBytes: DIRECT_R2_PRESIGNED_PUT_TEST_BODY_LIMIT_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Request body too large.", 413);
    }
    throw error;
  }

  const expectedWorkspaceVersion = normalizeNonEmptyString(body.expectedWorkspaceVersion);
  if (!expectedWorkspaceVersion) {
    return json({ error: "expectedWorkspaceVersion is required." }, 400);
  }

  const artifactText = normalizeNonEmptyString(body.artifactText)
    ?? "hosted checkpoint write-fence artifact";
  const artifactBytes = new TextEncoder().encode(artifactText);
  const artifactSha256 = await sha256Hex(artifactBytes);
  const snapshotRef = Object.hasOwn(body, "snapshotRef") ? body.snapshotRef : null;

  const stub = context.env.USER_RUNNER.getByName(userId);
  if (
    typeof stub.beginRuntimeWriteFenceForSmoke !== "function"
    || typeof stub.finishRuntimeWriteFenceForSmoke !== "function"
  ) {
    throw new TypeError("Hosted user runner does not support checkpoint artifact write-fence tests.");
  }

  const lease = await stub.beginRuntimeWriteFenceForSmoke({
    userId,
    workspaceVersion: expectedWorkspaceVersion,
  });
  if (!lease) {
    return json({ error: "Hosted runner write fence is already active." }, 409);
  }

  try {
    const checkpointHeaders = createTestRuntimeWriteFenceHeaders({
      attemptId: lease.attemptId,
      generation: lease.generation,
      workspaceVersion: lease.workspaceVersion ?? expectedWorkspaceVersion,
    });
    const checkpointResponse = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH}`, {
        body: JSON.stringify({
          attemptId: lease.attemptId,
          expectedWorkspaceVersion,
          leaseGeneration: lease.generation,
          reason: "idle_shutdown",
          snapshotRef,
        }),
        headers: checkpointHeaders,
        method: "POST",
      }),
      context.env,
      userId,
    );
    if (!checkpointResponse.ok) {
      return json({
        checkpointStatus: checkpointResponse.status,
        error: "Hosted checkpoint write-fence test checkpoint failed.",
        ok: false,
        stage: "checkpoint",
      }, 502);
    }

    const checkpoint = parseHostedWorkspaceCheckpointResponse(await checkpointResponse.clone().json());
    if (!checkpoint.checkpointed) {
      return json({
        checkpointStatus: checkpointResponse.status,
        error: "Hosted checkpoint write-fence test did not update the workspace.",
        ok: false,
        stage: "checkpoint",
        workspaceVersion: checkpoint.workspace.version,
      }, 409);
    }

    const artifactHeaders = createTestRuntimeWriteFenceHeaders({
      attemptId: lease.attemptId,
      generation: lease.generation,
      workspaceVersion: checkpoint.workspace.version,
    });
    const artifactResponse = await handleRunnerOutboundRequest(
      new Request(`http://artifacts.worker/objects/${artifactSha256}`, {
        body: artifactBytes,
        headers: artifactHeaders,
        method: "PUT",
      }),
      context.env,
      userId,
    );
    if (!artifactResponse.ok) {
      return json({
        artifactStatus: artifactResponse.status,
        checkpointedWorkspaceVersion: checkpoint.workspace.version,
        error: "Hosted checkpoint write-fence test artifact upload failed.",
        ok: false,
        stage: "artifact",
      }, 502);
    }

    return json({
      artifact: {
        sha256: artifactSha256,
        size: artifactBytes.byteLength,
        status: artifactResponse.status,
      },
      checkpoint: {
        checkpointed: true,
        previousWorkspaceVersion: expectedWorkspaceVersion,
        status: checkpointResponse.status,
        workspaceVersion: checkpoint.workspace.version,
      },
      ok: true,
    });
  } finally {
    await stub.finishRuntimeWriteFenceForSmoke({
      attemptId: lease.attemptId,
      generation: lease.generation,
      userId,
    });
  }
}

export function parseTestWorkspaceInvocationReason(
  value: string | null,
): HostedWorkspaceInvocationReason | "invalid" | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  if (HOSTED_WORKSPACE_INVOCATION_REASONS.includes(value as HostedWorkspaceInvocationReason)) {
    return value as HostedWorkspaceInvocationReason;
  }
  return "invalid";
}

export function parseTestPositiveInteger(value: string | null): number | "invalid" | null {
  if (value === null) {
    return null;
  }
  return parseTestPositiveIntegerString(value);
}

export function parseTestPositiveIntegerValue(value: unknown): number | "invalid" | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return parseTestPositiveIntegerString(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return "invalid";
  }
  return value;
}

function parseTestPositiveIntegerString(value: string): number | "invalid" {
  if (!/^[0-9]+$/u.test(value)) {
    return "invalid";
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

export function createTestRuntimeWriteFenceHeaders(input: {
  attemptId: string;
  generation: string;
  workspaceVersion: string;
}): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  writeRunnerRuntimeWriteFenceHeaders(headers, input);
  return headers;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
