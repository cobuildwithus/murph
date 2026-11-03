import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  HOSTED_WEB_TEST_SHARD_COUNT,
  PACKAGE_COVERAGE_EXCLUSIONS,
  PACKAGE_COVERAGE_PLAN,
  validateReleaseVerificationPlan,
} from '../../../scripts/release-verification-plan.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
describe('host-support coverage matrix guards', () => {

  it('derives a complete non-empty coverage matrix from package coverage owners', () => {
    const validation = validateReleaseVerificationPlan(repoRoot)
    const plannedDirs = PACKAGE_COVERAGE_PLAN.map(({ dir }) => dir).sort()

    expect(validation.discoveredWorkspacePackageDirs).toEqual(plannedDirs)
    expect(validation.discoveredPackageCoverageDirs).toEqual(plannedDirs)
    expect(validation.packageCoverageShardNames).toHaveLength(6)
    expect(validation.hostedWebTestFileCount).toBeGreaterThanOrEqual(
      HOSTED_WEB_TEST_SHARD_COUNT,
    )
    expect(PACKAGE_COVERAGE_EXCLUSIONS).toEqual({})
    expect(plannedDirs).toContain('packages/health-commons')
    expect(plannedDirs).toContain('packages/hosted-local-harness')
    for (const shard of validation.packageCoverageShardNames) {
      expect(PACKAGE_COVERAGE_PLAN.some((entry) => entry.shard === shard)).toBe(true)
    }
  })

})
