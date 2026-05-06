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
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../runtime-mailbox-payload-decode-contract.ts";
import {
  requireRunnerActiveInvocationLeaseWriteHeaders,
  RunnerActiveInvocationLeaseError,
} from "./active-lease.ts";
import {
  handleRunnerMailboxPayloadDecodeRequest,
} from "./mailbox-payload-decode.ts";
import {
  isAllowedHostedRunnerWebControlRequest,
} from "./shared-web-control-policy.ts";
import {
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

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

  if (input.url.pathname === HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH) {
    return await handleRunnerMailboxPayloadDecodeRequest({
      env: input.env,
      environment: input.environment,
      request: input.request,
      userId: input.userId,
    });
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

  if (checkpointRequest) {
    try {
      const headers = requireRunnerActiveInvocationLeaseWriteHeaders(input.request);
      if (
        headers.attemptId !== checkpointRequest.attemptId
        || headers.leaseGeneration !== checkpointRequest.leaseGeneration
        || headers.workspaceVersion !== checkpointRequest.expectedWorkspaceVersion
      ) {
        return unauthorized();
      }
    } catch (error) {
      if (error instanceof RunnerActiveInvocationLeaseError) {
        return unauthorized();
      }
      throw error;
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
  if (checkpointRequest && response.ok) {
    try {
      parseHostedWorkspaceCheckpointResponse(await response.clone().json());
    } catch {
      return unauthorized();
    }
  }

  return response;
}

async function readOptionalHostedRunnerWebControlBody(request: Request): Promise<string | undefined> {
  const bodyText = await request.text();
  return bodyText.length > 0 ? bodyText : undefined;
}
