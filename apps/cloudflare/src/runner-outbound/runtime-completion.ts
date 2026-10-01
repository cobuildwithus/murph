import { commandHostedRuntimeOwner } from "../runtime-owner-client.ts";
import { readRuntimeTargetAdapter } from "../runtime-target-adapter.ts";
import type {
  HostedRuntimeCompletionReceipt,
  HostedRuntimeCompletionReceiptReason,
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
    result = parseHostedWorkspaceInvocationResult(body.result);
  } catch (error) {
    return error instanceof RangeError
      ? jsonError("Request body too large.", 413)
      : jsonError("Invalid request.", 400);
  }

  const state = await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: { operation: "reconcile" } });
  const owner = state.owner;
  if (state.cutover !== "postgres" || owner?.attemptId !== authority.attemptId || owner.generation !== authority.generation || !owner.runnerContainerName) {
    let reason: HostedRuntimeCompletionReceiptReason = "owner_unconfirmed";
    if (state.cutover === "postgres" && owner) {
      // Release clears the attempt, but warm reuse can retain the target.
      // Idle alone is not completion evidence; a newer generation proves only
      // supersession, never completion or delivery of this result.
      if (owner.generation === authority.generation && owner.phase === "idle"
        && owner.attemptId === null && owner.completedAt) {
        reason = "already_completed";
      } else if (/^[0-9]{1,19}$/u.test(authority.generation)
        && BigInt(owner.generation) > BigInt(authority.generation)) {
        // Headers have only presence validation here. Keep malformed values
        // on the existing false path rather than throwing during diagnostics.
        reason = "superseded";
      }
    }
    return json({ completed: false, reason } satisfies HostedRuntimeCompletionReceipt);
  }
  const container = readRuntimeTargetAdapter(input.env, owner.runnerContainerName);
  if (!container?.recordSupervisedRuntimeCompletion) throw new Error("Native runtime completion receipt is unavailable.");
  return json(await container.recordSupervisedRuntimeCompletion({ userId: input.userId, attemptId: authority.attemptId, generation: authority.generation, result }));
}
