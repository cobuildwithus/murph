import { usesPostgresRuntimeOwner } from "../runtime-cutover.ts";
import { commandHostedRuntimeOwner } from "../runtime-owner-client.ts";
import type {
  HostedRuntimeUsageRecordResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
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
  if (usesPostgresRuntimeOwner(input.env)) {
    const result = await commandHostedRuntimeOwner({ source: input.env, userId: input.userId, command: {
      operation: "authorize_effect", attemptId: headers.attemptId, generation: headers.generation, runnerContainerName: null, managedAi: false,
    } });
    if (result.cutover !== "postgres" || result.status !== "authorized") throw new RunnerRuntimeWriteFenceError();
    return headers;
  }
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const ownsWriteFence = await validateRunnerRuntimeWriteFence(stub, {
    attemptId: headers.attemptId,
    generation: headers.generation,
    userId: input.userId,
  });
  if (!ownsWriteFence) {
    throw new RunnerRuntimeWriteFenceError();
  }

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

export async function applyRunnerRuntimeUsageSettlement(input: {
  env: RunnerOutboundEnvironmentSource;
  settlement: HostedRuntimeUsageRecordResponse | null;
  userId: string;
  writeAuthority: RunnerRuntimeWriteFenceHeaders;
}): Promise<void> {
  if (input.settlement?.platformAiUsageAllowedAfter === true) {
    return;
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  requireRunnerOutboundUserStubMethod(stub, "revokeActiveRuntimePlatformAiUsage");
  await stub.revokeActiveRuntimePlatformAiUsage({
    attemptId: input.writeAuthority.attemptId,
    generation: input.writeAuthority.generation,
    userId: input.userId,
  });
}

function readValidWorkspaceVersionOrNull(value: string | null): string | null {
  if (!value || !/^[0-9]+$/u.test(value)) {
    return null;
  }
  return value;
}

async function validateRunnerRuntimeWriteFence(
  stub: Awaited<ReturnType<typeof resolveRunnerOutboundUserRunnerStub>>,
  input: {
    attemptId: string;
    generation: string;
    userId: string;
  },
): Promise<boolean> {
  if (typeof stub.validateRuntimeWriteFence !== "function") {
    throw new TypeError("Hosted user runner does not implement validateRuntimeWriteFence.");
  }
  return await stub.validateRuntimeWriteFence(input);
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
