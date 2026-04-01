export interface HostedWorkerDeploymentVersionTraffic {
  percentage: number;
  versionId: string;
}

export interface HostedWorkerGradualDeploymentSupport {
  directDeployRequiredReason: string | null;
  gradualDeploymentsSupported: boolean;
  migrationTags: string[];
}

const HOSTED_WORKER_GRADUAL_DEPLOYMENT_SAFE_MIGRATION_TAGS = new Set(["v1", "v2"]);

export function resolveHostedWorkerDeploymentTraffic(input: {
  candidateVersionId: string;
  currentDeploymentVersions: HostedWorkerDeploymentVersionTraffic[];
  rolloutPercentage: number;
}): HostedWorkerDeploymentVersionTraffic[] {
  const rolloutPercentage = normalizeRolloutPercentage(input.rolloutPercentage);
  const currentDeploymentVersions = normalizeCurrentDeploymentVersions(
    input.currentDeploymentVersions,
  );

  assertSupportedHostedWorkerDeploymentTraffic(currentDeploymentVersions);

  if (currentDeploymentVersions.length === 1) {
    return resolveSingleVersionDeploymentTraffic({
      candidateVersionId: input.candidateVersionId,
      currentVersion: currentDeploymentVersions[0],
      rolloutPercentage,
    });
  }

  return resolveSplitDeploymentTraffic({
    candidateVersionId: input.candidateVersionId,
    currentDeploymentVersions,
    rolloutPercentage,
  });
}

export function formatHostedWorkerDeploymentVersionSpecs(
  traffic: HostedWorkerDeploymentVersionTraffic[],
): string[] {
  return traffic.map(({ percentage, versionId }) => `${versionId}@${percentage}`);
}

export function resolveHostedWorkerGradualDeploymentSupport(
  config: Record<string, unknown>,
): HostedWorkerGradualDeploymentSupport {
  const migrationTags = readHostedWorkerMigrationTags(config);
  const unsupportedMigrationTags = migrationTags.filter(
    (tag) => !HOSTED_WORKER_GRADUAL_DEPLOYMENT_SAFE_MIGRATION_TAGS.has(tag),
  );

  if (unsupportedMigrationTags.length > 0) {
    return {
      directDeployRequiredReason: [
        "Rendered Wrangler config includes unsupported Durable Object migration tag(s)",
        unsupportedMigrationTags.map((tag) => `\`${tag}\``).join(", "),
        "for gradual versions/deployments.",
        "Use HOSTED_EXECUTION_DEPLOYMENT_MODE=direct for the migration rollout first.",
      ].join(" "),
      gradualDeploymentsSupported: false,
      migrationTags,
    };
  }

  return {
    directDeployRequiredReason: null,
    gradualDeploymentsSupported: true,
    migrationTags,
  };
}

function normalizeCurrentDeploymentVersions(
  versions: HostedWorkerDeploymentVersionTraffic[],
): HostedWorkerDeploymentVersionTraffic[] {
  return versions.map((version) => ({
    percentage: normalizeRolloutPercentage(version.percentage),
    versionId: version.versionId,
  }));
}

function assertSupportedHostedWorkerDeploymentTraffic(
  currentDeploymentVersions: HostedWorkerDeploymentVersionTraffic[],
): void {
  if (currentDeploymentVersions.length === 0) {
    throw new Error([
      "Gradual deployments require an existing deployment.",
      "Use a direct deploy for the first rollout.",
    ].join(" "));
  }

  if (currentDeploymentVersions.length > 2) {
    throw new Error("Cloudflare gradual deployments support at most two active versions.");
  }
}

function resolveSingleVersionDeploymentTraffic(input: {
  candidateVersionId: string;
  currentVersion: HostedWorkerDeploymentVersionTraffic;
  rolloutPercentage: number;
}): HostedWorkerDeploymentVersionTraffic[] {
  if (input.currentVersion.versionId === input.candidateVersionId) {
    if (input.rolloutPercentage !== 100) {
      throw new Error([
        "The candidate version is already 100% deployed.",
        "Select a different candidate or use a 100% rollout.",
      ].join(" "));
    }

    return [input.currentVersion];
  }

  if (input.rolloutPercentage === 100) {
    return [{
      percentage: 100,
      versionId: input.candidateVersionId,
    }];
  }

  return [
    {
      percentage: 100 - input.rolloutPercentage,
      versionId: input.currentVersion.versionId,
    },
    {
      percentage: input.rolloutPercentage,
      versionId: input.candidateVersionId,
    },
  ];
}

function resolveSplitDeploymentTraffic(input: {
  candidateVersionId: string;
  currentDeploymentVersions: HostedWorkerDeploymentVersionTraffic[];
  rolloutPercentage: number;
}): HostedWorkerDeploymentVersionTraffic[] {
  const candidateIndex = input.currentDeploymentVersions.findIndex(
    ({ versionId }) => versionId === input.candidateVersionId,
  );

  if (candidateIndex === -1) {
    throw new Error([
      "The current deployment already splits traffic between two versions.",
      "Finish or roll back that deployment before introducing a new candidate version.",
    ].join(" "));
  }

  if (input.rolloutPercentage === 100) {
    return [{
      percentage: 100,
      versionId: input.candidateVersionId,
    }];
  }

  const remainingPercentage = 100 - input.rolloutPercentage;
  return input.currentDeploymentVersions.map((version, index) => ({
    percentage: index === candidateIndex ? input.rolloutPercentage : remainingPercentage,
    versionId: version.versionId,
  }));
}

function normalizeRolloutPercentage(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Hosted rollout percentages must be integers between 0 and 100.");
  }

  return value;
}

function readHostedWorkerMigrationTags(config: Record<string, unknown>): string[] {
  const migrations = config.migrations;

  if (!Array.isArray(migrations)) {
    return [];
  }

  return migrations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const tag = "tag" in entry ? normalizeString(String(entry.tag)) : null;
    return tag ? [tag] : [];
  });
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
