import type {
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  json,
  jsonError,
  notFound,
} from "../../json.ts";
import {
  resolveHostedExecutionRunnerContainerName,
} from "../../runner-container.ts";
import type {
  HostedRunnerStuckInvocationTestResult,
} from "../../user-runner/hosted-user-runner-test.ts";
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
  decodeRouteParam,
} from "../route-utils/route-params.ts";
import {
  isHostedWorkerTestEnvironment,
  requireHostedWorkerTestEnvironment,
} from "../route-utils/test-env.ts";
import {
  matchHostedLocalTestUserRoute,
} from "../route-utils/test-routes.ts";

interface HostedLocalTestUserRunnerStubLike extends UserRunnerDurableObjectStubLike {
  runAlarmForTest(input: { userId: string }): Promise<{ ok: true }>;
  runUntilIdleForTest(input: {
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult>;
  startStuckInvocationForTest(input: {
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult>;
}

interface HostedLocalTestRunnerContainerStubLike {
  expireActivityForTest?(input: { userId: string }): Promise<{ ok: true }>;
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
      return handleTestRunUntilIdleRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute("/__test/users/", "/run-until-idle"),
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
    match: matchHostedLocalTestUserRoute("/__test/users/", "/alarm"),
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
      return handleTestStartStuckInvocationRoute(context, params.userId);
    },
    match: matchHostedLocalTestUserRoute("/__test/users/", "/stuck-invocation"),
    methods: ["POST"],
    name: "test-start-stuck-invocation",
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
  if (context.url.searchParams.has("reason")) {
    return json({ error: "Test run-until-idle reason is no longer supported." }, 400);
  }

  const stub = context.env.USER_RUNNER.getByName(userId) as HostedLocalTestUserRunnerStubLike;
  return json(await stub.runUntilIdleForTest({
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

  const stub = context.env.USER_RUNNER.getByName(userId) as HostedLocalTestUserRunnerStubLike;
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
  const stub = context.env.RUNNER_CONTAINER.getByName(
    runnerContainerName,
  );
  if (!hasHostedLocalTestRunnerContainerActivityControl(stub)) {
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

  const stub = context.env.USER_RUNNER.getByName(userId) as HostedLocalTestUserRunnerStubLike;
  const startedAgoMs = parseTestPositiveInteger(
    context.url.searchParams.get("startedAgoMs"),
  );
  if (startedAgoMs === "invalid") {
    return json({ error: "Unsupported test stuck invocation age." }, 400);
  }
  return json(await stub.startStuckInvocationForTest({
    ...(startedAgoMs === null ? {} : { startedAgoMs }),
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
