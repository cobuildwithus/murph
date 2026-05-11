import {
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

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
  const validateRuntimeWriteFence = stub.validateRuntimeWriteFence
    ?? ((legacyInput: {
      attemptId: string;
      generation: string;
      userId: string;
    }) => {
      const legacy = requireRunnerOutboundUserStubMethod(
        stub,
        "ownsActiveInvocationLease",
      );
      return legacy({
        attemptId: legacyInput.attemptId,
        leaseGeneration: legacyInput.generation,
        userId: legacyInput.userId,
      });
    });
  // Workspace version is enforced by the checkpoint route, not by invocation-local side effects.
  const ownsWriteFence = await validateRuntimeWriteFence({
    attemptId: headers.attemptId,
    generation: headers.generation,
    userId: input.userId,
  });
  if (!ownsWriteFence) {
    throw new RunnerRuntimeWriteFenceError();
  }

  return headers;
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

export type RunnerActiveInvocationLeaseHeaders = RunnerRuntimeWriteFenceHeaders & {
  leaseGeneration: string;
};
export type RunnerActiveInvocationLeaseWriteHeaders =
  RunnerRuntimeWriteFenceWriteHeaders & { leaseGeneration: string };
export const RunnerActiveInvocationLeaseError = RunnerRuntimeWriteFenceError;

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

export function requireRunnerActiveInvocationLeaseHeaders(
  request: Request,
): RunnerActiveInvocationLeaseHeaders {
  const headers = requireRunnerRuntimeWriteFenceHeaders(request);
  return {
    ...headers,
    leaseGeneration: headers.generation,
  };
}

export function requireRunnerActiveInvocationLeaseWriteHeaders(
  request: Request,
): RunnerActiveInvocationLeaseWriteHeaders {
  const headers = requireRunnerRuntimeWriteFenceWriteHeaders(request);
  return {
    ...headers,
    leaseGeneration: headers.generation,
  };
}

export function writeRunnerActiveInvocationLeaseHeaders(
  headers: Headers,
  token: RunnerRuntimeWriteFenceWriteHeaders | RunnerRuntimeWriteFenceLegacyWriteHeaders,
): void {
  writeRunnerRuntimeWriteFenceHeaders(headers, token);
}
