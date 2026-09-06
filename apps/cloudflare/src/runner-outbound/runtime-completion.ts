import {
  parseHostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/parsers";

import {
  json,
  jsonError,
  readJsonObject,
  unauthorized,
} from "../json.ts";
import type {
  RunnerOutboundEnvironmentSource,
} from "./shared.ts";
import {
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
} from "./shared.ts";
import {
  requireRunnerRuntimeWriteFenceHeaders,
  RunnerRuntimeWriteFenceError,
} from "./write-fence.ts";

const HOSTED_RUNTIME_COMPLETION_BODY_LIMIT_BYTES = 256 * 1024;

export async function handleRunnerRuntimeCompletionRequest(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<Response> {
  let authority;
  try {
    authority = requireRunnerRuntimeWriteFenceHeaders(input.request);
  } catch (error) {
    if (error instanceof RunnerRuntimeWriteFenceError) {
      return unauthorized();
    }
    throw error;
  }

  let result;
  try {
    const body = await readJsonObject(input.request, {
      limitBytes: HOSTED_RUNTIME_COMPLETION_BODY_LIMIT_BYTES,
    });
    result = parseHostedWorkspaceInvocationResult(body.result);
  } catch (error) {
    return error instanceof RangeError
      ? jsonError("Request body too large.", 413)
      : jsonError("Invalid request.", 400);
  }

  const userRunner = await resolveRunnerOutboundUserRunnerStub(
    input.env,
    input.userId,
  );
  requireRunnerOutboundUserStubMethod(
    userRunner,
    "recordRuntimeCompletionFromContainer",
  );
  return json(await userRunner.recordRuntimeCompletionFromContainer({
    attemptId: authority.attemptId,
    generation: authority.generation,
    result,
    userId: input.userId,
  }));
}
