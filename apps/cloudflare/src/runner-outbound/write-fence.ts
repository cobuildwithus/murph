import {
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";
import {
  LEGACY_ACTIVE_INVOCATION_COMPATIBILITY_DELETE_AFTER,
} from "../worker-contracts.ts";

const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
const HOSTED_RUNTIME_LEASE_GENERATION_HEADER = "x-hosted-runtime-lease-generation";
const HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER = "x-hosted-runtime-workspace-version";

export interface RunnerRuntimeWriteFenceHeaders {
  attemptId: string;
  generation: string;
  workspaceVersion: string | null;
}

export interface RunnerRuntimeWriteFenceWriteHeaders
  extends RunnerRuntimeWriteFenceHeaders {
  workspaceVersion: string;
}

export interface RunnerRuntimeWriteFenceLegacyWriteHeaders {
  attemptId: string;
  leaseGeneration: string;
  workspaceVersion: string;
}

export class RunnerRuntimeWriteFenceError extends Error {
  constructor(message = "Hosted runner runtime write fence is not valid.") {
    super(message);
    this.name = "RunnerRuntimeWriteFenceError";
  }
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
  const headers = readRunnerRuntimeWriteFenceHeaders(input.request);
  if (!headers) {
    throw new RunnerRuntimeWriteFenceError();
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const ownsWriteFence = await validateRunnerRuntimeWriteFenceWithDeployFallback(stub, {
    attemptId: headers.attemptId,
    generation: headers.generation,
    userId: input.userId,
  });
  if (!ownsWriteFence) {
    throw new RunnerRuntimeWriteFenceError();
  }

  return headers;
}

export async function requireRunnerRuntimeWriteFenceWrite(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<RunnerRuntimeWriteFenceWriteHeaders> {
  const headers = requireRunnerRuntimeWriteFenceWriteHeaders(input.request);
  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const ownsWriteFence = await validateRunnerRuntimeWriteFenceWithDeployFallback(stub, {
    attemptId: headers.attemptId,
    generation: headers.generation,
    userId: input.userId,
    workspaceVersion: headers.workspaceVersion,
  });
  if (!ownsWriteFence) {
    throw new RunnerRuntimeWriteFenceError();
  }

  return headers;
}

async function validateRunnerRuntimeWriteFenceWithDeployFallback(
  stub: Awaited<ReturnType<typeof resolveRunnerOutboundUserRunnerStub>>,
  input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  },
): Promise<boolean> {
  try {
    const validateRuntimeWriteFence = stub.validateRuntimeWriteFence;
    if (typeof validateRuntimeWriteFence === "function") {
      return await validateRuntimeWriteFence(input);
    }
  } catch (error) {
    if (!isMissingRuntimeWriteFenceRpcMethod(error)) {
      throw error;
    }
  }

  // Legacy deployed-caller fallback. Delete after 2026-05-25.
  const legacy = requireRunnerOutboundUserStubMethod(
    stub,
    "ownsActiveInvocationLease",
  );
  return await legacy({
    attemptId: input.attemptId,
    leaseGeneration: input.generation,
    userId: input.userId,
    workspaceVersion: input.workspaceVersion,
  });
}

function isMissingRuntimeWriteFenceRpcMethod(error: unknown): boolean {
  return error instanceof TypeError
    && error.message.includes("validateRuntimeWriteFence")
    && error.message.includes("does not implement");
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

export function requireRunnerRuntimeWriteFenceWriteHeaders(
  request: Request,
): RunnerRuntimeWriteFenceWriteHeaders {
  const headers = requireRunnerRuntimeWriteFenceHeaders(request);
  if (!headers.workspaceVersion) {
    throw new RunnerRuntimeWriteFenceError();
  }

  return {
    ...headers,
    workspaceVersion: headers.workspaceVersion,
  };
}

export function writeRunnerRuntimeWriteFenceHeaders(
  headers: Headers,
  token: RunnerRuntimeWriteFenceWriteHeaders | RunnerRuntimeWriteFenceLegacyWriteHeaders,
): void {
  const generation = "generation" in token ? token.generation : token.leaseGeneration;
  headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, token.attemptId);
  headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, generation);
  headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, token.workspaceVersion);
}

export { LEGACY_ACTIVE_INVOCATION_COMPATIBILITY_DELETE_AFTER };

/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `RunnerRuntimeWriteFenceHeaders`.
 */
export type RunnerActiveInvocationLeaseHeaders = RunnerRuntimeWriteFenceHeaders & {
  leaseGeneration: string;
};
/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `RunnerRuntimeWriteFenceWriteHeaders`.
 */
export type RunnerActiveInvocationLeaseWriteHeaders =
  RunnerRuntimeWriteFenceWriteHeaders & { leaseGeneration: string };
/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `RunnerRuntimeWriteFenceError`.
 */
export const RunnerActiveInvocationLeaseError = RunnerRuntimeWriteFenceError;

/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `readRunnerRuntimeWriteFenceHeaders`.
 */
export function readRunnerActiveInvocationLeaseHeaders(
  request: Request,
): RunnerActiveInvocationLeaseHeaders | null {
  const headers = readRunnerRuntimeWriteFenceHeaders(request);
  return headers
    ? {
        ...headers,
        leaseGeneration: headers.generation,
      }
    : null;
}

/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `requireRunnerRuntimeWriteFence`.
 */
export async function requireRunnerActiveInvocationLease(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<RunnerActiveInvocationLeaseHeaders> {
  const headers = await requireRunnerRuntimeWriteFence(input);
  return {
    ...headers,
    leaseGeneration: headers.generation,
  };
}

/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `requireRunnerRuntimeWriteFenceHeaders`.
 */
export function requireRunnerActiveInvocationLeaseHeaders(
  request: Request,
): RunnerActiveInvocationLeaseHeaders {
  const headers = requireRunnerRuntimeWriteFenceHeaders(request);
  return {
    ...headers,
    leaseGeneration: headers.generation,
  };
}

/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `requireRunnerRuntimeWriteFenceWriteHeaders`.
 */
export function requireRunnerActiveInvocationLeaseWriteHeaders(
  request: Request,
): RunnerActiveInvocationLeaseWriteHeaders {
  const headers = requireRunnerRuntimeWriteFenceWriteHeaders(request);
  return {
    ...headers,
    leaseGeneration: headers.generation,
  };
}

/**
 * Legacy active-invocation compatibility around the write fence.
 * Delete after 2026-05-25. Current runtime code should use
 * `writeRunnerRuntimeWriteFenceHeaders`.
 */
export function writeRunnerActiveInvocationLeaseHeaders(
  headers: Headers,
  token: RunnerRuntimeWriteFenceWriteHeaders | RunnerRuntimeWriteFenceLegacyWriteHeaders,
): void {
  writeRunnerRuntimeWriteFenceHeaders(headers, token);
}
