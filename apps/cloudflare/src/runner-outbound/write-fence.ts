import { commandHostedRuntimeOwner } from "../runtime-owner-client.ts";

import {
  type RunnerOutboundEnvironmentSource
} from "./shared.ts";
import {
  RunnerRuntimeWriteFenceError,
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "./headers.ts";

export interface RunnerRuntimeWriteFenceHeaders {
  attemptId: string;
  generation: string;
  workspaceVersion: string | null;
}

export interface RunnerRuntimeWriteFenceWorkspaceAuthority
  extends RunnerRuntimeWriteFenceHeaders {
  workspaceVersion: string;
}

export function readRunnerRuntimeWriteFenceHeaders(
  request: Request,
): RunnerRuntimeWriteFenceHeaders | null {
  const attemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  const generation = request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER);
  const workspaceVersion = request.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);

  if (!attemptId || !generation) {
    return null;
  }

  return {
    attemptId,
    generation,
    workspaceVersion,
  };
}

export async function requireRunnerRuntimeWriteFence(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<RunnerRuntimeWriteFenceHeaders> {
  const headers = requireRunnerRuntimeWriteFenceHeaders(input.request);
  const result = await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: {
    operation: "authorize_effect", attemptId: headers.attemptId, generation: headers.generation, runnerContainerName: null, managedAi: false,
  } });
  if (result.cutover !== "postgres" || result.status !== "authorized") throw new RunnerRuntimeWriteFenceError();
  return headers;
}

export async function requireRunnerRuntimeWriteFenceWorkspaceWrite(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<RunnerRuntimeWriteFenceWorkspaceAuthority> {
  const headers = requireRunnerRuntimeWriteFenceHeaders(input.request);
  const workspaceVersion = readValidWorkspaceVersionOrNull(headers.workspaceVersion);
  if (!workspaceVersion) throw new RunnerRuntimeWriteFenceError();
  await requireRunnerRuntimeWriteFence(input);

  return {
    ...headers,
    workspaceVersion,
  };
}

function readValidWorkspaceVersionOrNull(value: string | null): string | null {
  if (!value || !/^[0-9]+$/u.test(value)) {
    return null;
  }
  return value;
}

export function requireRunnerRuntimeWriteFenceHeaders(
  request: Request,
): RunnerRuntimeWriteFenceHeaders {
  const headers = readRunnerRuntimeWriteFenceHeaders(request);
  if (!headers) {
    throw new RunnerRuntimeWriteFenceError();
  }

  return headers;
}

export { RunnerRuntimeWriteFenceError, writeRunnerRuntimeWriteFenceHeaders, type RunnerRuntimeWriteFenceToken } from "./headers.ts";
