const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
const HOSTED_RUNTIME_LEASE_GENERATION_HEADER = "x-hosted-runtime-lease-generation";
const HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER = "x-hosted-runtime-workspace-version";
const MAX_ATTEMPT_ID_LENGTH = 200;
const MAX_GENERATION_DIGITS = 20;

export interface HostedRuntimeWriteFence {
  attemptId: string;
  leaseGeneration: string;
  workspaceVersion: string;
}

export function readHostedRuntimeWriteFence(
  request: Request,
): HostedRuntimeWriteFence | null {
  const attemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)?.trim() ?? "";
  const leaseGeneration = request.headers
    .get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)?.trim() ?? "";
  const workspaceVersion = request.headers
    .get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)?.trim() ?? "";

  if (
    !/^[A-Za-z0-9._:-]+$/u.test(attemptId)
    || attemptId.length > MAX_ATTEMPT_ID_LENGTH
    || !isCanonicalGeneration(leaseGeneration)
    || !isCanonicalGeneration(workspaceVersion)
  ) {
    return null;
  }

  return { attemptId, leaseGeneration, workspaceVersion };
}

function isCanonicalGeneration(value: string): boolean {
  return value.length <= MAX_GENERATION_DIGITS && /^(?:0|[1-9]\d*)$/u.test(value);
}
