import { type readHostedExecutionEnvironment } from "../env.ts";
import { methodNotAllowed, notFound, unauthorized } from "../json.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import {
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  isAllowedHostedRunnerWebControlRequest,
} from "./shared-web-control-policy.ts";
import {
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

type RunnerOutboundUserRunnerStub = Awaited<
  ReturnType<typeof resolveRunnerOutboundUserRunnerStub>
>;

export async function handleRunnerWebControlRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "GET" && input.request.method !== "POST") {
    return methodNotAllowed();
  }

  if (!isAllowedHostedRunnerWebControlRequest({
    method: input.request.method,
    path: input.url.pathname,
  })) {
    return notFound();
  }

  const body = input.request.method === "POST"
    ? await readOptionalHostedRunnerWebControlBody(input.request)
    : undefined;
  const checkpointRequest = input.url.pathname === HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH
    && input.request.method === "POST"
    ? parseHostedWorkspaceCheckpointRequest(JSON.parse(body ?? "{}"))
    : null;
  const checkpointContext = checkpointRequest
    ? {
        request: checkpointRequest,
        stub: await resolveRunnerOutboundUserRunnerStub(input.env, input.userId),
      }
    : null;

  if (checkpointContext) {
    const hasLease = await runnerOwnsActiveInvocationLease({
      attemptId: checkpointContext.request.attemptId,
      leaseGeneration: checkpointContext.request.leaseGeneration,
      stub: checkpointContext.stub,
      userId: input.userId,
      workspaceVersion: checkpointContext.request.expectedWorkspaceVersion,
    });
    if (!hasLease) {
      return unauthorized();
    }
  }

  const response = await fetchHostedExecutionWebControlPlaneResponse({
    baseUrl: input.environment.hostedWebBaseUrl,
    body,
    boundUserId: input.userId,
    callbackSigning: input.environment.webCallbackSigning,
    method: input.request.method,
    path: input.url.pathname,
    search: input.url.search || null,
    timeoutMs: input.environment.webControlTimeoutMs,
  });
  if (checkpointContext && response.ok) {
    const checkpointResponse = parseHostedWorkspaceCheckpointResponse(
      await response.clone().json(),
    );
    if (checkpointResponse.checkpointed) {
      const recorded = await recordRunnerActiveInvocationWorkspaceCheckpoint({
        attemptId: checkpointContext.request.attemptId,
        leaseGeneration: checkpointContext.request.leaseGeneration,
        stub: checkpointContext.stub,
        userId: input.userId,
        workspaceVersion: checkpointResponse.workspace.version,
      });
      if (!recorded) {
        return unauthorized();
      }
    }
  }

  return response;
}

async function runnerOwnsActiveInvocationLease(input: {
  attemptId: string;
  leaseGeneration: string;
  stub: RunnerOutboundUserRunnerStub;
  userId: string;
  workspaceVersion: string;
}): Promise<boolean> {
  const ownsActiveInvocationLease = requireRunnerOutboundUserStubMethod(
    input.stub,
    "ownsActiveInvocationLease",
  );
  return await ownsActiveInvocationLease({
    attemptId: input.attemptId,
    leaseGeneration: input.leaseGeneration,
    userId: input.userId,
    workspaceVersion: input.workspaceVersion,
  });
}

async function recordRunnerActiveInvocationWorkspaceCheckpoint(input: {
  attemptId: string;
  leaseGeneration: string;
  stub: RunnerOutboundUserRunnerStub;
  userId: string;
  workspaceVersion: string;
}): Promise<boolean> {
  const recordActiveInvocationWorkspaceCheckpoint = requireRunnerOutboundUserStubMethod(
    input.stub,
    "recordActiveInvocationWorkspaceCheckpoint",
  );
  const response = await recordActiveInvocationWorkspaceCheckpoint({
    attemptId: input.attemptId,
    leaseGeneration: input.leaseGeneration,
    userId: input.userId,
    workspaceVersion: input.workspaceVersion,
  });
  return response.recorded;
}

async function readOptionalHostedRunnerWebControlBody(request: Request): Promise<string | undefined> {
  const bodyText = await request.text();
  return bodyText.length > 0 ? bodyText : undefined;
}
