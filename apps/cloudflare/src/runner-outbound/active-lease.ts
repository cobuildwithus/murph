import {
  requireRunnerOutboundUserStubMethod,
  resolveRunnerOutboundUserRunnerStub,
  type RunnerOutboundEnvironmentSource,
} from "./shared.ts";

const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
const HOSTED_RUNTIME_LEASE_GENERATION_HEADER = "x-hosted-runtime-lease-generation";
const HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER = "x-hosted-runtime-workspace-version";

export interface RunnerActiveInvocationLeaseHeaders {
  attemptId: string;
  leaseGeneration: string;
  workspaceVersion: string;
}

export class RunnerActiveInvocationLeaseError extends Error {
  constructor(message = "Hosted runner active invocation lease is not valid.") {
    super(message);
    this.name = "RunnerActiveInvocationLeaseError";
  }
}

export function readRunnerActiveInvocationLeaseHeaders(
  request: Request,
): RunnerActiveInvocationLeaseHeaders | null {
  const attemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER);
  const leaseGeneration = request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER);
  const workspaceVersion = request.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER);

  if (!attemptId || !leaseGeneration || !workspaceVersion) {
    return null;
  }

  return {
    attemptId,
    leaseGeneration,
    workspaceVersion,
  };
}

export async function requireRunnerActiveInvocationLease(input: {
  env: RunnerOutboundEnvironmentSource;
  request: Request;
  userId: string;
}): Promise<RunnerActiveInvocationLeaseHeaders> {
  const headers = readRunnerActiveInvocationLeaseHeaders(input.request);
  if (!headers) {
    throw new RunnerActiveInvocationLeaseError();
  }

  const stub = await resolveRunnerOutboundUserRunnerStub(input.env, input.userId);
  const ownsActiveInvocationLease = requireRunnerOutboundUserStubMethod(
    stub,
    "ownsActiveInvocationLease",
  );
  const ownsLease = await ownsActiveInvocationLease({
    attemptId: headers.attemptId,
    leaseGeneration: headers.leaseGeneration,
    userId: input.userId,
    workspaceVersion: headers.workspaceVersion,
  });
  if (!ownsLease) {
    throw new RunnerActiveInvocationLeaseError();
  }

  return headers;
}

export function writeRunnerActiveInvocationLeaseHeaders(
  headers: Headers,
  lease: RunnerActiveInvocationLeaseHeaders,
): void {
  headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, lease.attemptId);
  headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, lease.leaseGeneration);
  headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, lease.workspaceVersion);
}
