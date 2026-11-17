import { parseInput, RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import { commandHostedRuntimeOwner } from "../runtime-owner-client.ts";
import { createHostedRunnerContainerNamespaceRouter } from "../standby-runner-contract.ts";
import {
  obsoleteRuntimeCompletionReason,
  type HostedRuntimeCompletionReceipt,
} from "../runtime-completion-receipt.ts";
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
    result = parseInput(body.result, parseHostedWorkspaceInvocationResult);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return jsonError("Request body too large.", 413);
    if (error instanceof RequestInputError) return jsonError("Invalid request.", 400);
    throw error;
  }

  const state = await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: { operation: "reconcile" } });
  const owner = state.owner;
  if (owner?.attemptId !== authority.attemptId || owner.generation !== authority.generation || !owner.runnerContainerName) {
    const reason = obsoleteRuntimeCompletionReason(owner, authority.generation) ?? "owner_unconfirmed";
    return json({ completed: false, reason } satisfies HostedRuntimeCompletionReceipt);
  }
  const container = createHostedRunnerContainerNamespaceRouter(input.env)?.getByName(owner.runnerContainerName);
  if (!container?.recordSupervisedRuntimeCompletion) throw new Error("Native runtime completion receipt is unavailable.");
  return json(await container.recordSupervisedRuntimeCompletion({ userId: input.userId, attemptId: authority.attemptId, generation: authority.generation, result }));
}
