export interface PackageCoveragePlanEntry {
  readonly dir: string;
  readonly shard: string;
}

export interface ReleaseVerificationPlanValidation {
  readonly discoveredPackageCoverageDirs: string[];
  readonly discoveredWorkspacePackageDirs: string[];
  readonly hostedWebTestFileCount: number;
  readonly packageCoverageShardNames: string[];
}

export const PACKAGE_COVERAGE_EXCLUSIONS: Readonly<Record<string, string>>;
export const PACKAGE_COVERAGE_PLAN: readonly PackageCoveragePlanEntry[];
export const HOSTED_WEB_TEST_SHARD_COUNT: number;

export function validateReleaseVerificationPlan(
  repoRoot?: string,
): ReleaseVerificationPlanValidation;

export function packageCoverageDirsForShard(
  shard: string,
  repoRoot?: string,
): string[];

export function packageCoverageMatrix(repoRoot?: string): {
  include: Array<{ shard: string }>;
};

export function hostedWebTestMatrix(repoRoot?: string): {
  include: Array<{ shard: string }>;
};
