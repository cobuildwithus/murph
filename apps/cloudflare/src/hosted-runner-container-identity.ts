export type HostedRunnerContainerIdentitySource = Readonly<Record<string, unknown>>;

export interface HostedRunnerContainerIdentity {
  runnerContainerName: string;
  userId: string;
}

export function resolveHostedExecutionRunnerContainerName(input: {
  source: HostedRunnerContainerIdentitySource;
  userId: string;
}): string {
  const workerVersionSegment = readRunnerContainerWorkerVersionSegment(input.source);
  return workerVersionSegment
    ? `${input.userId}--v-${workerVersionSegment}`
    : input.userId;
}

export function readHostedRunnerContainerIdentity(input: {
  containerName: string | null | undefined;
  source: HostedRunnerContainerIdentitySource;
}): HostedRunnerContainerIdentity | null {
  const runnerContainerName = typeof input.containerName === "string"
    ? input.containerName.trim()
    : "";
  if (!runnerContainerName) {
    return null;
  }

  const userId = readHostedRunnerContainerUserId(runnerContainerName, {
    hasWorkerVersionSegment: readRunnerContainerWorkerVersionSegment(input.source) !== null,
  });

  return userId
    ? {
        runnerContainerName,
        userId,
      }
    : null;
}

function readHostedRunnerContainerUserId(
  runnerContainerName: string,
  input: { hasWorkerVersionSegment: boolean },
): string | null {
  if (!input.hasWorkerVersionSegment) {
    return runnerContainerName;
  }

  if (runnerContainerName.startsWith("--v-")) {
    return null;
  }

  const versionSuffixStart = runnerContainerName.lastIndexOf("--v-");
  if (
    versionSuffixStart > 0
    && versionSuffixStart + "--v-".length < runnerContainerName.length
  ) {
    const userId = runnerContainerName.slice(0, versionSuffixStart).trim();
    return userId.length > 0 ? userId : null;
  }

  return runnerContainerName;
}

function readRunnerContainerWorkerVersionSegment(
  source: HostedRunnerContainerIdentitySource,
): string | null {
  const metadata = source.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const versionId = (metadata as { id?: unknown }).id;
  return typeof versionId === "string"
    ? sanitizeRunnerContainerNameSegment(versionId)
    : null;
}

function sanitizeRunnerContainerNameSegment(value: string): string | null {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : null;
}
