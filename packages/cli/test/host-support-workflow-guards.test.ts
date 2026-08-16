import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const hostSupportWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'host-support.yml')
const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const actionsCacheV5 = 'actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5'

function getJob(workflow: string, jobName: string, nextJobName: string): string {
  const startMarker = `  ${jobName}:\n`
  const endMarker = `\n  ${nextJobName}:\n`
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start + startMarker.length)

  if (start === -1 || end === -1) {
    throw new Error(`Unable to find ${jobName} in the host-support workflow`)
  }

  return workflow.slice(start, end)
}

describe('host support workflow guards', () => {
  it('keeps the hosted-web verify env placeholders aligned across release and support workflows', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:1/murph_test')
    expect(workflow).toContain('HOSTED_DEVICE_ROUTING_INDEX_KEY: 0101010101010101010101010101010101010101010101010101010101010101')
    expect(workflow).toContain('HOSTED_MAILBOX_FINGERPRINT_KEY: BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('HOSTED_CONTACT_PRIVACY_KEYS: v1:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc')
    expect(workflow).toContain('NEXT_PUBLIC_PRIVY_APP_ID: ${{ vars.HOSTED_WEB_VERIFY_PRIVY_APP_ID }}')
    expect(workflow).toContain('PRIVY_VERIFICATION_KEY: ci-hosted-web-verification-key')
  })

  it('keeps the release gate split into parallel shards instead of one long release:check job', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')
    const buildTypecheckJob = getJob(
      workflow,
      'release-build-typecheck-linux',
      'release-package-coverage-linux',
    )
    const fixtureCoverageJob = getJob(
      workflow,
      'release-fixture-coverage-linux',
      'release-checks-linux',
    )

    expect(workflow).toContain('name: Release build/typecheck (ubuntu)')
    expect(workflow).toContain('name: Release package coverage (${{ matrix.shard }})')
    expect(workflow).toContain('name: Release app verification (ubuntu)')
    expect(workflow).toContain('name: Release fixture coverage (ubuntu)')
    expect(workflow).toContain('name: Release checks (ubuntu)')
    expect(workflow).toContain('pnpm build:workspace:clean')
    expect(workflow).toContain('pnpm typecheck')
    expect(buildTypecheckJob).toContain(
      'pnpm --dir packages/messaging-ingress verify:package-boundary:prepared',
    )
    expect(buildTypecheckJob).toContain(
      'pnpm --dir packages/inboxd verify:package-boundary:prepared',
    )
    expect(buildTypecheckJob).toContain(
      'pnpm --dir packages/hosted-local-harness verify:package-boundary:prepared',
    )
    expect(workflow).toContain('pnpm no-js')
    expect(workflow).toContain('bash scripts/doc-gardening.sh --fail-on-issues')
    expect(workflow).toContain('pnpm test:apps')
    expect(workflow).toContain('MURPH_APP_VERIFY_PARALLEL: "1"')
    expect(workflow).toContain(
      'MURPH_SUPPLEMENT_SEARCH_TEST_DB_URL: postgresql://postgres:postgres@127.0.0.1:5432/murph_search_test',
    )
    expect(workflow).toContain('image: public.ecr.aws/docker/library/postgres:17')
    expect(workflow).toContain('POSTGRES_DB: murph_search_test')
    expect(workflow).toContain('POSTGRES_USER: postgres')
    expect(workflow).toContain('MURPH_VERIFY_STEP_PARALLEL: "1"')
    expect(fixtureCoverageJob).toContain('run: pnpm test:scenario-integrity')
    expect(rootPackageJson.scripts?.['test:scenario-integrity']).toBe(
      'tsx e2e/smoke/verify-scenario-integrity.ts --coverage',
    )
    expect(workflow).toContain(
      'MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_CLI_RELEASE_TARBALL_TEST=1 MURPH_VITEST_MAX_WORKERS=50%',
    )
    expect(workflow).not.toContain('run: pnpm release:check')
  })

  it('keeps every package coverage owner assigned to a release shard', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')
    const packageCoverageJob = getJob(
      workflow,
      'release-package-coverage-linux',
      'release-app-verification-linux',
    )
    const packageDirs = [
      'packages/assistant-cli',
      'packages/assistant-engine',
      'packages/assistant-runtime',
      'packages/assistantd',
      'packages/cloudflare-hosted-control',
      'packages/contracts',
      'packages/core',
      'packages/device-syncd',
      'packages/exercise-library',
      'packages/health-metrics',
      'packages/cli',
      'packages/gateway-core',
      'packages/hosted-execution',
      'packages/importers',
      'packages/inbox-services',
      'packages/inboxd',
      'packages/messaging-ingress',
      'packages/openclaw-plugin',
      'packages/operator-config',
      'packages/parsers',
      'packages/query',
      'packages/runtime-state',
      'packages/setup-cli',
      'packages/vault-usecases',
    ]

    for (const packageDir of packageDirs) {
      expect(packageCoverageJob).toContain(packageDir)
    }
  })

  it('restores only narrow TypeScript build-info caches in the release jobs', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')
    const buildTypecheckJob = getJob(
      workflow,
      'release-build-typecheck-linux',
      'release-package-coverage-linux',
    )
    const appVerificationJob = getJob(
      workflow,
      'release-app-verification-linux',
      'release-fixture-coverage-linux',
    )
    const cacheInputHash =
      "${{ hashFiles('.nvmrc', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json', 'packages/*/package.json', 'apps/*/package.json', 'tsconfig*.json', 'packages/*/tsconfig*.json', 'apps/*/tsconfig*.json') }}"

    expect(buildTypecheckJob.match(new RegExp(actionsCacheV5, 'gu')) ?? []).toHaveLength(1)
    expect(buildTypecheckJob).toContain(`- name: Restore release typecheck build info
        if: github.event_name == 'push'
        uses: ${actionsCacheV5}`)
    expect(buildTypecheckJob).toContain(`path: |
            tsconfig.tools.tsbuildinfo
            packages/*/*typecheck*.tsbuildinfo
            apps/cloudflare/typecheck.tsbuildinfo
            apps/web/.next/cache/tsconfig.tsbuildinfo`)
    expect(buildTypecheckJob).toContain(
      `key: tsbuildinfo-release-build-typecheck-\${{ runner.os }}-\${{ runner.arch }}-${cacheInputHash}-\${{ github.sha }}`,
    )
    expect(buildTypecheckJob).toContain(`restore-keys: |
            tsbuildinfo-release-build-typecheck-\${{ runner.os }}-\${{ runner.arch }}-${cacheInputHash}-`)
    expect(buildTypecheckJob).not.toContain(
      `tsbuildinfo-release-build-typecheck-\${{ runner.os }}-\${{ runner.arch }}-\n`,
    )

    const cleanBuildIndex = buildTypecheckJob.indexOf('run: pnpm build:workspace:clean')
    const cacheRestoreIndex = buildTypecheckJob.indexOf(`uses: ${actionsCacheV5}`)
    const typecheckIndex = buildTypecheckJob.indexOf('run: pnpm typecheck')
    expect(cleanBuildIndex).toBeGreaterThanOrEqual(0)
    expect(cacheRestoreIndex).toBeGreaterThan(cleanBuildIndex)
    expect(typecheckIndex).toBeGreaterThan(cacheRestoreIndex)

    expect(appVerificationJob.match(new RegExp(actionsCacheV5, 'gu')) ?? []).toHaveLength(1)
    expect(appVerificationJob).toContain(`- name: Restore release app verification build info
        if: github.event_name == 'push'
        uses: ${actionsCacheV5}`)
    expect(appVerificationJob).toContain(`path: |
            apps/cloudflare/typecheck.tsbuildinfo
            apps/web/.next/cache/tsconfig.tsbuildinfo
            apps/web/.next/cache/tsconfig.next.tsbuildinfo`)
    expect(appVerificationJob).toContain(
      `key: tsbuildinfo-release-app-verification-\${{ runner.os }}-\${{ runner.arch }}-${cacheInputHash}-\${{ github.sha }}`,
    )
    expect(appVerificationJob).toContain(`restore-keys: |
            tsbuildinfo-release-app-verification-\${{ runner.os }}-\${{ runner.arch }}-${cacheInputHash}-`)
    expect(appVerificationJob).not.toContain(
      `tsbuildinfo-release-app-verification-\${{ runner.os }}-\${{ runner.arch }}-\n`,
    )

    const installIndex = appVerificationJob.indexOf('run: pnpm install --frozen-lockfile')
    const appCacheRestoreIndex = appVerificationJob.indexOf(`uses: ${actionsCacheV5}`)
    const appVerificationIndex = appVerificationJob.indexOf('run: pnpm test:apps')
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(appCacheRestoreIndex).toBeGreaterThan(installIndex)
    expect(appVerificationIndex).toBeGreaterThan(appCacheRestoreIndex)

    expect(workflow.match(/uses:\s+actions\/cache@/gu) ?? []).toHaveLength(2)
    expect(workflow.match(/^\s+restore-keys:/gmu) ?? []).toHaveLength(2)
    expect(workflow).not.toContain('actions/cache/restore@')
    expect(workflow).not.toContain('actions/cache/save@')
    expect(workflow).not.toContain('**/*.tsbuildinfo')
    expect(workflow).not.toMatch(/^\s+(?:apps\/web\/)?\.next\/cache(?:\/\*\*)?\/?\s*$/mu)
  })

  it('bounds only assistant-engine coverage above the default Node heap', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('elif [[ "$package_dir" == "packages/assistant-engine" ]]')
    expect(workflow).toContain(
      'env NODE_OPTIONS=--max-old-space-size=6144 MURPH_VITEST_MAX_WORKERS=50% pnpm --dir "$package_dir" test:coverage',
    )
    expect(workflow).toContain(
      'env MURPH_VITEST_MAX_WORKERS=50% pnpm --dir "$package_dir" test:coverage',
    )
    expect(workflow.match(/NODE_OPTIONS=--max-old-space-size=6144/gu) ?? []).toHaveLength(1)
  })

  it('prepares built CLI runtime artifacts before the host-support setup suite', () => {
    const workflow = readFileSync(hostSupportWorkflowPath, 'utf8')

    expect(workflow).toContain('- name: Prepare built CLI runtime artifacts')
    expect(workflow).toContain('run: pnpm build:test-runtime:prepared')
    expect(workflow).toContain(
      'run: env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run packages/cli/test/setup-cli.test.ts packages/cli/test/inbox-service-boundaries.test.ts --no-coverage --maxWorkers 1',
    )
  })
})
