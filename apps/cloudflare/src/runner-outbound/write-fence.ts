import {
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "./headers.ts";

export interface RunnerRuntimeWriteFenceHeaders {
  attemptId: string;
  generation: string;
  workspaceVersion: string | null;
}

export interface RunnerRuntimeWriteFenceWriteAuthority
  extends RunnerRuntimeWriteFenceHeaders {}

export interface RunnerRuntimeWriteFenceWorkspaceAuthority
  extends RunnerRuntimeWriteFenceHeaders {
  workspaceVersion: string;
}

export interface RunnerRuntimeWriteFenceToken {
  attemptId: string;
  generation?: string;
  leaseGeneration?: string;
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

export async function requireRunnerRuntimeWriteFenceWrite(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<RunnerRuntimeWriteFenceWriteAuthority> {
  const headers = requireRunnerRuntimeWriteFenceHeaders(input.request);
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
  if (!workspaceVersion) {
    throw new RunnerRuntimeWriteFenceError();
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

async function validateRunnerRuntimeWriteFence(
  stub: Awaited<ReturnType<typeof resolveRunnerOutboundUserRunnerStub>>,
  input: {
    attemptId: string;
    generation: string;
    userId: string;
  },
): Promise<boolean> {
  const validateRuntimeWriteFence = stub.validateRuntimeWriteFence;
  if (typeof validateRuntimeWriteFence !== "function") {
    throw new TypeError("Hosted user runner does not implement validateRuntimeWriteFence.");
  }
  return await validateRuntimeWriteFence(input);
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

export function writeRunnerRuntimeWriteFenceHeaders(
  headers: Headers,
  token: RunnerRuntimeWriteFenceToken,
): void {
  const generation = token.generation ?? token.leaseGeneration;
  if (!generation) {
    throw new RunnerRuntimeWriteFenceError("Hosted runner runtime write fence generation is missing.");
  }
  headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, token.attemptId);
  headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, generation);
  headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, token.workspaceVersion);
}
