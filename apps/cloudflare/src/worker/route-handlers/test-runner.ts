import { commandHostedRuntimeOwner } from "../../runtime-owner-client.ts";
import { readRuntimeTargetAdapter } from "../../runtime-target-adapter.ts";

import {
  json,
  jsonError,
  notFound,
} from "../../json.ts";
import type {
  HostedLocalForegroundPriorityOrderingControlInput,
} from "../../hosted-local-test/foreground-priority-ordering.ts";
import {
  createHostedRunnerContainerNamespaceRouter,
} from "../../standby-runner-contract.ts";
import type {
  WorkerRouteContext
} from "../../worker-routes/shared.ts";
import {
  requireHostedExecutionBoundUserResponse,
} from "../auth.ts";
import type {
  DeclarativeRoute,
} from "../routes.ts";
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

interface HostedLocalTestRunnerContainerStubLike {
  armGeneratedImageProviderBarrierForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  armCanonicalCheckpointLostAckForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  armCanonicalCheckpointPublicationBarrierForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  armIdleSnapshotStartBarrierForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  armSnapshotPublicationCorruptionForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  armShutdownCheckpointPublicationBarrierForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  beginShutdownCheckpointGracefulStopForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  dropActiveOperationForTest?(input: {
    loseCompletedInvocationResult?: boolean;
    userId: string;
  }): Promise<{ ok: true }>;
  expireActivityForTest?(input: { userId: string }): Promise<{ ok: true }>;
  foregroundPriorityOrderingControlForTest?(
    input: HostedLocalForegroundPriorityOrderingControlInput,
  ): Promise<unknown>;
  readShutdownCheckpointPublicationBarrierForTest?(
    input: { userId: string },
  ): Promise<{ state: "armed" | "entered" | "unarmed" }>;
  releaseGeneratedImageProviderBarrierForTest?(
    input: { userId: string },
  ): Promise<{ ok: true }>;
  releaseShutdownCheckpointPublicationBarrierForTest?(
    input: { userId: string },
  ): Promise<{ ok: true; released: boolean }>;
}

function hasHostedLocalTestRunnerContainerForegroundPriorityOrderingControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & {
  foregroundPriorityOrderingControlForTest(
    input: HostedLocalForegroundPriorityOrderingControlInput,
  ): Promise<unknown>;
} {
  return "foregroundPriorityOrderingControlForTest" in stub
    && typeof stub.foregroundPriorityOrderingControlForTest === "function";
}

function hasHostedLocalTestRunnerContainerGeneratedImageProviderBarrierControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & Required<Pick<
  HostedLocalTestRunnerContainerStubLike,
  "armGeneratedImageProviderBarrierForTest" | "releaseGeneratedImageProviderBarrierForTest"
>> {
  return "armGeneratedImageProviderBarrierForTest" in stub
    && typeof stub.armGeneratedImageProviderBarrierForTest === "function"
    && "releaseGeneratedImageProviderBarrierForTest" in stub
    && typeof stub.releaseGeneratedImageProviderBarrierForTest === "function";
}

function hasHostedLocalTestRunnerContainerCanonicalCheckpointLostAckControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & {
  armCanonicalCheckpointLostAckForTest(input: { userId: string }): Promise<{ ok: true }>;
} {
  return "armCanonicalCheckpointLostAckForTest" in stub
    && typeof stub.armCanonicalCheckpointLostAckForTest === "function";
}

function hasHostedLocalTestRunnerContainerSnapshotPublicationCorruptionControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & {
  armSnapshotPublicationCorruptionForTest(input: { userId: string }): Promise<{ ok: true }>;
} {
  return "armSnapshotPublicationCorruptionForTest" in stub
    && typeof stub.armSnapshotPublicationCorruptionForTest === "function";
}

function hasHostedLocalTestRunnerContainerShutdownCheckpointPublicationBarrierControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & Required<Pick<
  HostedLocalTestRunnerContainerStubLike,
  | "armCanonicalCheckpointPublicationBarrierForTest"
  | "armIdleSnapshotStartBarrierForTest"
  | "armShutdownCheckpointPublicationBarrierForTest"
  | "beginShutdownCheckpointGracefulStopForTest"
  | "readShutdownCheckpointPublicationBarrierForTest"
  | "releaseShutdownCheckpointPublicationBarrierForTest"
>> {
  return "armCanonicalCheckpointPublicationBarrierForTest" in stub
    && typeof stub.armCanonicalCheckpointPublicationBarrierForTest === "function"
    && "armIdleSnapshotStartBarrierForTest" in stub
    && typeof stub.armIdleSnapshotStartBarrierForTest === "function"
    && "armShutdownCheckpointPublicationBarrierForTest" in stub
    && typeof stub.armShutdownCheckpointPublicationBarrierForTest === "function"
    && "beginShutdownCheckpointGracefulStopForTest" in stub
    && typeof stub.beginShutdownCheckpointGracefulStopForTest === "function"
    && "readShutdownCheckpointPublicationBarrierForTest" in stub
    && typeof stub.readShutdownCheckpointPublicationBarrierForTest === "function"
    && "releaseShutdownCheckpointPublicationBarrierForTest" in stub
    && typeof stub.releaseShutdownCheckpointPublicationBarrierForTest === "function";
}

function hasHostedLocalTestRunnerContainerGracefulStopControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & Required<Pick<
  HostedLocalTestRunnerContainerStubLike,
  "beginShutdownCheckpointGracefulStopForTest"
>> {
  return "beginShutdownCheckpointGracefulStopForTest" in stub
    && typeof stub.beginShutdownCheckpointGracefulStopForTest === "function";
}

async function beginActiveHostedLocalTestRunnerGracefulStop(input: {
  context: WorkerRouteContext;
  fallbackRunnerContainerName: string;
  userId: string;
}): Promise<{ ok: true }> {
  const runnerContainerNamespace = createHostedRunnerContainerNamespaceRouter({
    exactUser: input.context.env.RUNNER_CONTAINER,
    next: input.context.env.NEXT_RUNNER_CONTAINER,
    standby: input.context.env.STANDBY_RUNNER_CONTAINER ?? null,
  });
  if (!runnerContainerNamespace) {
    throw new Error("Hosted runner container binding is unavailable.");
  }
  const activeStub = runnerContainerNamespace.getByName(
    input.fallbackRunnerContainerName,
  );
  if (!hasHostedLocalTestRunnerContainerGracefulStopControl(activeStub)) {
    throw new Error(
      "Hosted runner container graceful shutdown test RPC is unavailable.",
    );
  }
  return await activeStub.beginShutdownCheckpointGracefulStopForTest({
    userId: input.userId,
  });
}

function hasHostedLocalTestRunnerContainerActiveOperationControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & {
  dropActiveOperationForTest(input: {
    loseCompletedInvocationResult?: boolean;
    userId: string;
  }): Promise<{ ok: true }>;
} {
  return "dropActiveOperationForTest" in stub
    && typeof stub.dropActiveOperationForTest === "function";
}

function hasHostedLocalTestRunnerContainerActivityControl(
  stub: object,
): stub is HostedLocalTestRunnerContainerStubLike & {
  expireActivityForTest(input: { userId: string }): Promise<{ ok: true }>;
} {
  return "expireActivityForTest" in stub
    && typeof stub.expireActivityForTest === "function";
}

export const testRunnerRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestCanonicalCheckpointLostAckRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute(
      "/__test/users/",
      "/canonical-checkpoint-lost-ack",
    ),
    methods: ["POST"],
    name: "test-canonical-checkpoint-lost-ack",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestForegroundPriorityOrderingRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute(
      "/__test/users/",
      "/foreground-priority-ordering",
    ),
    methods: ["POST"],
    name: "test-foreground-priority-ordering",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestGeneratedImageProviderBarrierRoute(
        context,
        params.userId,
        "arm",
      );
    },
    match: matchHostedLocalTestUserRoute(
      "/__test/users/",
      "/generated-image-provider-barrier/arm",
    ),
    methods: ["POST"],
    name: "test-arm-generated-image-provider-barrier",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestGeneratedImageProviderBarrierRoute(
        context,
        params.userId,
        "release",
      );
    },
    match: matchHostedLocalTestUserRoute(
      "/__test/users/",
      "/generated-image-provider-barrier/release",
    ),
    methods: ["POST"],
    name: "test-release-generated-image-provider-barrier",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestSnapshotPublicationCorruptionRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute(
      "/__test/users/",
      "/snapshot-publication-corruption",
    ),
    methods: ["POST"],
    name: "test-snapshot-publication-corruption",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestShutdownCheckpointPublicationBarrierRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute(
      "/__test/users/",
      "/shutdown-checkpoint-publication-barrier",
    ),
    methods: ["POST"],
    name: "test-shutdown-checkpoint-publication-barrier",
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
    match: matchHostedLocalTestUserRoute("/__test/users/", "/container-activity-expired"),
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
      return handleTestContainerActiveOperationDropRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute("/__test/users/", "/container-active-operation-drop"),
    methods: ["POST"],
    name: "test-container-active-operation-drop",
    wrongMethodResponse: "not-found",
  },
  {
    authorization: "vercel-oidc",
    beforeMethod(context) {
      return requireHostedWorkerTestEnvironment(context);
    },
    async handle(context, params) {
      return handleTestReadActiveRuntimeFenceRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute("/__test/users/", "/active-runtime-fence"),
    methods: ["POST"],
    name: "test-read-active-runtime-fence",
    wrongMethodResponse: "not-found",
  },
];

export async function handleTestReadActiveRuntimeFenceRoute(
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
    "test-read-active-runtime-fence",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const { owner, cutover } = await commandHostedRuntimeOwner({ source: context.env, userId, command: { operation: "reconcile" } });
  if (cutover !== "postgres") throw new Error("Local runtime test control requires Postgres ownership.");
  return json(owner?.attemptId ? { attemptId: owner.attemptId, processingMode: owner.processingMode, runnerContainerName: owner.runnerContainerName } : null);
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

  const runnerContainerName = await readLocalRuntimeTarget(context, userId);
  const namespace = createHostedRunnerContainerNamespaceRouter({
    exactUser: context.env.RUNNER_CONTAINER,
    next: context.env.NEXT_RUNNER_CONTAINER,
    small: context.env.SMALL_RUNNER_CONTAINER,
    standby: context.env.STANDBY_RUNNER_CONTAINER ?? null,
  });
  if (!namespace) throw new Error("Hosted runner container binding is unavailable.");
  const stub = namespace.getByName(runnerContainerName);
  if (!hasHostedLocalTestRunnerContainerActivityControl(stub)) {
    throw new Error("Hosted runner container test activity-expiry RPC is unavailable.");
  }
  return json(await stub.expireActivityForTest({ userId }));
}

export async function handleTestCanonicalCheckpointLostAckRoute(
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
    "test-canonical-checkpoint-lost-ack",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.RUNNER_CONTAINER.getByName(userId);
  if (!hasHostedLocalTestRunnerContainerCanonicalCheckpointLostAckControl(stub)) {
    throw new Error(
      "Hosted runner container canonical checkpoint lost-ack test RPC is unavailable.",
    );
  }
  return json(await stub.armCanonicalCheckpointLostAckForTest({ userId }));
}

export async function handleTestForegroundPriorityOrderingRoute(
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
    "test-foreground-priority-ordering",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const actions = context.url.searchParams.getAll("action");
  const action = actions.length === 1 ? actions[0] : null;
  if (
    context.url.searchParams.size !== 1
    || (
      action !== "arm-canonical"
      && action !== "arm-empty-probe"
      && action !== "clear"
      && action !== "provider-start"
      && action !== "release"
      && action !== "status"
    )
  ) {
    return jsonError(
      "Foreground-priority ordering action must be arm-canonical, arm-empty-probe, clear, provider-start, release, or status.",
      400,
    );
  }

  const stub = context.env.RUNNER_CONTAINER.getByName(userId);
  if (!hasHostedLocalTestRunnerContainerForegroundPriorityOrderingControl(stub)) {
    throw new Error(
      "Hosted runner container foreground-priority ordering test RPC is unavailable.",
    );
  }

  if (action === "arm-canonical" || action === "arm-empty-probe") {
    return json(await stub.foregroundPriorityOrderingControlForTest({
      action: "arm",
      barrierTarget: action === "arm-canonical"
        ? "canonical_post_commit"
        : "empty_conversation_probe",
      userId,
    }));
  }

  return json(await stub.foregroundPriorityOrderingControlForTest({
    action: action === "provider-start" ? "record-provider-start" : action,
    userId,
  }));
}

async function handleTestGeneratedImageProviderBarrierRoute(
  context: WorkerRouteContext,
  encodedUserId: string,
  action: "arm" | "release",
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
    `test-${action}-generated-image-provider-barrier`,
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.RUNNER_CONTAINER.getByName(userId);
  if (!hasHostedLocalTestRunnerContainerGeneratedImageProviderBarrierControl(stub)) {
    throw new Error(
      "Hosted runner container generated-image provider barrier test RPC is unavailable.",
    );
  }
  const result = action === "arm"
    ? await stub.armGeneratedImageProviderBarrierForTest({ userId })
    : await stub.releaseGeneratedImageProviderBarrierForTest({ userId });
  return json(result);
}

export async function handleTestSnapshotPublicationCorruptionRoute(
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
    "test-snapshot-publication-corruption",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const stub = context.env.RUNNER_CONTAINER.getByName(userId);
  if (!hasHostedLocalTestRunnerContainerSnapshotPublicationCorruptionControl(stub)) {
    throw new Error(
      "Hosted runner container snapshot publication corruption test RPC is unavailable.",
    );
  }
  return json(await stub.armSnapshotPublicationCorruptionForTest({ userId }));
}

export async function handleTestShutdownCheckpointPublicationBarrierRoute(
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
    "test-shutdown-checkpoint-publication-barrier",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const actions = context.url.searchParams.getAll("action");
  const action = actions.length === 1 ? actions[0] : null;
  if (
    context.url.searchParams.size !== 1
    || (
      action !== "arm"
      && action !== "arm-canonical"
      && action !== "arm-snapshot-start"
      && action !== "shutdown"
      && action !== "status"
      && action !== "release"
    )
  ) {
    return jsonError(
      "Checkpoint publication barrier action must be arm, arm-canonical, arm-snapshot-start, shutdown, status, or release.",
      400,
    );
  }

  if (action === "shutdown") {
    const runnerContainerName = await readLocalRuntimeTarget(context, userId);
    return json(await beginActiveHostedLocalTestRunnerGracefulStop({
      context,
      fallbackRunnerContainerName: runnerContainerName,
      userId,
    }));
  }
  // Barrier state is test-isolate memory keyed by member, independent of
  // allocation. Only shutdown above must address the selected physical target.
  const stub = context.env.RUNNER_CONTAINER.getByName(userId);
  if (!hasHostedLocalTestRunnerContainerShutdownCheckpointPublicationBarrierControl(stub)) {
    throw new Error(
      "Hosted runner container shutdown checkpoint publication barrier test RPC is unavailable.",
    );
  }

  switch (action) {
    case "arm-canonical":
      return json(await stub.armCanonicalCheckpointPublicationBarrierForTest({ userId }));
    case "arm-snapshot-start":
      return json(await stub.armIdleSnapshotStartBarrierForTest({ userId }));
    case "arm":
      return json(await stub.armShutdownCheckpointPublicationBarrierForTest({ userId }));
    case "status":
      return json(await stub.readShutdownCheckpointPublicationBarrierForTest({ userId }));
    case "release":
      return json(await stub.releaseShutdownCheckpointPublicationBarrierForTest({ userId }));
  }
}

export async function handleTestContainerActiveOperationDropRoute(
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
    "test-container-active-operation-drop",
  );
  if (boundUserResponse) {
    return boundUserResponse;
  }

  const runnerContainerName = await readLocalRuntimeTarget(context, userId);
  const stub = requireLocalRuntimeTargetAdapter(context, runnerContainerName);
  if (!hasHostedLocalTestRunnerContainerActiveOperationControl(stub)) {
    throw new Error("Hosted runner container test active-operation drop RPC is unavailable.");
  }
  return json(await stub.dropActiveOperationForTest({
    ...(context.url.searchParams.get("loseCompletedInvocationResult") === "1"
      ? { loseCompletedInvocationResult: true }
      : {}),
    userId,
  }));
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

async function readLocalRuntimeTarget(context: WorkerRouteContext, userId: string): Promise<string> {
  const state = await commandHostedRuntimeOwner({ source: context.env, userId, command: { operation: "reconcile" } });
  if (state.cutover !== "postgres" || !state.owner?.runnerContainerName) throw new Error("Local runtime test control requires a selected Postgres target.");
  return state.owner.runnerContainerName;
}

function requireLocalRuntimeTargetAdapter(context: WorkerRouteContext, target: string) {
  const adapter = readRuntimeTargetAdapter(context.env, target);
  if (!adapter) throw new Error("Local runtime test target binding is unavailable.");
  return adapter;
}
