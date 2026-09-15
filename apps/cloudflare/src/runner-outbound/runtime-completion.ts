import { usesPostgresRuntimeOwner } from "../runtime-cutover.ts";
import { commandHostedRuntimeOwner } from "../runtime-owner-client.ts";
import { readRuntimeTargetAdapter } from "../runtime-target-adapter.ts";
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

  if (usesPostgresRuntimeOwner(input.env)) {
    const state = await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: { operation: "reconcile" } });
    const owner = state.owner;
    if (state.cutover !== "postgres" || owner?.attemptId !== authority.attemptId || owner.generation !== authority.generation || !owner.runnerContainerName) return json({ completed: false });
    const container = readRuntimeTargetAdapter(input.env, owner.runnerContainerName);
    if (!container?.recordSupervisedRuntimeCompletion) throw new Error("Native runtime completion receipt is unavailable.");
    return json(await container.recordSupervisedRuntimeCompletion({ userId: input.userId, attemptId: authority.attemptId, generation: authority.generation, result }));
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
