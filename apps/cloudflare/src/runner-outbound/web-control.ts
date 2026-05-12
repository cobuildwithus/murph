import { type readHostedExecutionEnvironment } from "../env.ts";
import {
  jsonError,
  methodNotAllowed,
  notFound,
  readRequestBodyText,
  unauthorized,
} from "../json.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";
import {
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH,
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
} from "../runtime-mailbox-payload-decode-contract.ts";
import {
  requireRunnerRuntimeWriteFenceWrite,
  requireRunnerRuntimeWriteFenceWriteHeaders,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";
import {
  handleRunnerMailboxPayloadDecodeRequest,
} from "./mailbox-payload-decode.ts";
import {
  isAllowedHostedRunnerWebControlRequest,
} from "./shared-web-control-policy.ts";
import {
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const HOSTED_RUNNER_WEB_CONTROL_BODY_LIMIT_BYTES = 256 * 1024;

interface RunnerOutboundProxyContext {
  proxyScope?: "browser_vault_background" | "runtime";
}

export async function handleRunnerWebControlRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  environment: ReturnType<typeof readHostedExecutionEnvironment>;
  proxyContext?: RunnerOutboundProxyContext;
  request: Request;
  url: URL;
  userId: string;
}): Promise<Response> {
  if (input.request.method !== "GET" && input.request.method !== "POST") {
    return methodNotAllowed();
  }

  const isBrowserVaultBackgroundPublish =
    input.proxyContext?.proxyScope === "browser_vault_background"
    && input.request.method === "POST"
    && input.url.pathname === HOSTED_RUNTIME_BROWSER_VAULT_REPLICA_PUBLISH_PATH;
  if (input.proxyContext?.proxyScope === "browser_vault_background"
    && !isBrowserVaultBackgroundPublish) {
    return notFound();
  }

  if (input.url.pathname === HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH) {
    return await handleRunnerMailboxPayloadDecodeRequest({
      env: input.env,
      environment: input.environment,
      request: input.request,
      userId: input.userId,
    });
  }

  if (!isBrowserVaultBackgroundPublish && !isAllowedHostedRunnerWebControlRequest({
    method: input.request.method,
    path: input.url.pathname,
  })) {
    return notFound();
  }

  const isCheckpointRequest = input.url.pathname === HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH
    && input.request.method === "POST";
  let checkpointHeaders: ReturnType<typeof requireRunnerRuntimeWriteFenceWriteHeaders> | null =
    null;
  if (isCheckpointRequest) {
    try {
      checkpointHeaders = await requireRunnerRuntimeWriteFenceWrite({
        env: input.env,
        request: input.request,
        userId: input.userId,
      });
    } catch (error) {
      if (error instanceof RunnerRuntimeWriteFenceError) {
        return unauthorized();
      }
      throw error;
    }
  }

  let body: string | undefined;
  try {
    body = input.request.method === "POST"
      ? await readOptionalHostedRunnerWebControlBody(input.request)
      : undefined;
  } catch (error) {
    if (error instanceof RangeError) {
      return jsonError("Request body too large.", 413);
    }
    throw error;
  }
  const checkpointRequest = isCheckpointRequest
    ? parseHostedWorkspaceCheckpointRequest(JSON.parse(body ?? "{}"))
    : null;
  if (
    checkpointHeaders
    && checkpointRequest
    && (
      checkpointHeaders.attemptId !== checkpointRequest.attemptId
      || checkpointHeaders.generation !== checkpointRequest.leaseGeneration
      || checkpointHeaders.workspaceVersion !== checkpointRequest.expectedWorkspaceVersion
    )
  ) {
    return unauthorized();
  }

  const response = await fetchHostedExecutionWebControlPlaneResponse({
    ...(input.environment.hostedWebAllowHttpHosts
      ? { allowHttpHosts: input.environment.hostedWebAllowHttpHosts }
      : {}),
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
  const bodyText = await readRequestBodyText(request, {
    limitBytes: HOSTED_RUNNER_WEB_CONTROL_BODY_LIMIT_BYTES,
  });
  return bodyText.length > 0 ? bodyText : undefined;
}
