import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  detectWorkspacePackageCycles,
  formatWorkspacePackageCycles,
} from '../../../scripts/check-workspace-package-cycles.mjs'
import { withoutNodeV8Coverage } from './cli-test-helpers.js'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageDir, '..', '..')
const rootPackageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as {
  name?: string
  scripts?: Record<string, string>
}
const cliPackageJson = JSON.parse(
  readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
) as {
  bin?: Record<string, string>
  bundleDependencies?: string[]
  dependencies?: Record<string, string>
  files?: string[]
  name?: string
  scripts?: Record<string, string>
  version?: string
}

function runNodeScript(...args: string[]) {
  return spawnSync('node', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withoutNodeV8Coverage(),
  })
}

function isSandboxedTsxPipeFailure(result: { stderr: string; stdout: string }) {
  return (
    result.stderr.includes('listen EPERM: operation not permitted') &&
    result.stderr.includes('/tsx-') &&
    result.stderr.includes('.pipe')
  )
}

function runAuditToolDirectly(scriptName: string, outDir: string, prefix: string) {
  const fullBundle = scriptName === 'package-audit-context-full.sh'
  const bootstrap = fullBundle
    ? `
source scripts/repo-tools.config.sh
export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS=''
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
  "config" \
  "packages" \
  "src" \
  "app" \
  "apps" \
  "contracts" \
  "scripts" \
  "docs"
`
    : 'source scripts/repo-tools.config.sh'

  return spawnSync(
    'bash',
    [
      '-lc',
      `set -euo pipefail
${bootstrap}
exec "$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@"`,
      'audit-context',
      '--zip',
      '--out-dir',
      outDir,
      '--name',
      prefix,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: withoutNodeV8Coverage(),
    },
  )
}

function createAuditZip(scriptName: string, prefix: string) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const initialResult = spawnSync(
    'bash',
    [path.join(repoRoot, 'scripts', scriptName), '--zip', '--out-dir', outDir, '--name', prefix],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: withoutNodeV8Coverage(),
    },
  )
  const result =
    initialResult.status !== 0 && isSandboxedTsxPipeFailure(initialResult)
      ? runAuditToolDirectly(scriptName, outDir, prefix)
      : initialResult

  if (result.status !== 0) {
    throw new Error(
      `Failed to create audit zip via ${scriptName}:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    )
  }

  const zipName = readdirSync(outDir).find((entry) => entry.endsWith('.zip'))
  expect(zipName, `missing zip output in ${outDir}`).toBeTruthy()
  return {
    outDir,
    zipPath: path.join(outDir, zipName!),
  }
}

function listZipEntries(zipPath: string) {
  return execFileSync('unzip', ['-Z1', zipPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withoutNodeV8Coverage(),
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

describe('monorepo release flow coverage audit', () => {
  it('exposes root-owned release scripts', () => {
    expect(rootPackageJson.name).toBe('murph-workspace')
    expect(rootPackageJson.scripts?.build).toContain('pnpm -r --sort')
    expect(rootPackageJson.scripts?.build).toContain('--workspace-concurrency=${MURPH_BUILD_WORKSPACE_CONCURRENCY:-4}')
    expect(rootPackageJson.scripts?.build).toContain("--filter './packages/**' build")
    expect(rootPackageJson.scripts?.['changelog:update']).toBe('bash scripts/update-changelog.sh')
    expect(rootPackageJson.scripts?.['release:notes']).toBe('bash scripts/generate-release-notes.sh')
    expect(rootPackageJson.scripts?.['release:check']).toBe('bash scripts/release-check.sh')
    expect(rootPackageJson.scripts?.['release:trust:github']).toBe(
      'node scripts/configure-trusted-publishing.mjs',
    )
    expect(rootPackageJson.scripts?.['release:patch']).toBe('bash scripts/release.sh patch')
    expect(rootPackageJson.scripts?.['release:minor']).toBe('bash scripts/release.sh minor')
    expect(rootPackageJson.scripts?.['release:major']).toBe('bash scripts/release.sh major')
    expect(rootPackageJson.scripts?.['review:gpt:full']).toBe(
      'cobuild-review-gpt --config scripts/review-gpt-full.config.sh',
    )
    expect(rootPackageJson.scripts?.['review:gpt:data']).toBe('bash scripts/review-gpt-data.sh')
    expect(rootPackageJson.scripts?.['chatgpt:thread:export']).toBe(
      'cobuild-review-gpt thread export --format json --filter-output exportPath',
    )
    expect(rootPackageJson.scripts?.['chatgpt:thread:download']).toBe(
      'cobuild-review-gpt thread download --format json --filter-output downloadedFile',
    )
    expect(rootPackageJson.scripts?.['chatgpt:thread:watch']).toBe(
      'cobuild-review-gpt thread wake --no-poll-until-complete --format json',
    )
    expect(rootPackageJson.scripts?.['chatgpt:thread:wake']).toBe(
      'cobuild-review-gpt thread wake --no-poll-until-complete --format json',
    )
    expect(rootPackageJson.scripts?.['verify:workspace-package-cycles']).toBe(
      'node scripts/check-workspace-package-cycles.mjs',
    )
    expect(rootPackageJson.scripts?.['zip:src:full']).toBe('bash scripts/package-audit-context-full.sh --zip')
  })

  it('keeps repo thread helpers routed through the packaged review-gpt commands without local shadow logic', () => {
    const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const pnpmWorkspace = readFileSync(
      path.join(repoRoot, 'pnpm-workspace.yaml'),
      'utf8',
    )
    const reviewGptVersionRange = String(
      rootPackageJson.devDependencies?.['@cobuild/review-gpt'] ?? '',
    )
    const reviewGptPinnedVersion = reviewGptVersionRange.replace(/^\^/u, '')

    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-export.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-download.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-wake.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-attachment-files.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-attachment-files.test.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-managed-browser.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-managed-browser.test.mjs'))).toBe(false)
    expect(reviewGptVersionRange).toMatch(/^\^0\.5\.\d+$/u)
    expect(pnpmWorkspace).toContain(`  - '@cobuild/review-gpt@${reviewGptPinnedVersion}'`)
    expect(pnpmWorkspace).not.toContain('patchedDependencies:')
    expect(existsSync(path.join(repoRoot, 'patches', `@cobuild__review-gpt@${reviewGptPinnedVersion}.patch`))).toBe(false)
  })

  it('keeps the lean and full review-gpt wrappers wired to the expected package scripts', () => {
    const leanReviewConfig = readFileSync(
      path.join(repoRoot, 'scripts', 'review-gpt.config.sh'),
      'utf8',
    )
    const fullReviewConfig = readFileSync(
      path.join(repoRoot, 'scripts', 'review-gpt-full.config.sh'),
      'utf8',
    )
    const repoToolsConfig = readFileSync(
      path.join(repoRoot, 'scripts', 'repo-tools.config.sh'),
      'utf8',
    )
    const fullPackageScript = readFileSync(
      path.join(repoRoot, 'scripts', 'package-audit-context-full.sh'),
      'utf8',
    )

    expect(leanReviewConfig).toContain('include_tests=0')
    expect(leanReviewConfig).toContain('include_docs=0')
    expect(leanReviewConfig).toContain('package_script="scripts/package-audit-context.sh"')
    expect(leanReviewConfig).toContain('review_gpt_register_dir_preset "privacy" "privacy.md"')
    expect(fullReviewConfig).toContain('source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/review-gpt.config.sh"')
    expect(fullReviewConfig).toContain('include_tests=1')
    expect(fullReviewConfig).toContain('include_docs=1')
    expect(fullReviewConfig).toContain('package_script="scripts/package-audit-context-full.sh"')
    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='0'")
    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='0'")
    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='0'")
    expect(repoToolsConfig).toContain('repo_tools_join_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS')
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'")
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'")
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'")
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS=''")
  })

  it('keeps the lean audit bundle smaller than the full one while preserving durable agent docs', () => {
    const leanBundle = createAuditZip('package-audit-context.sh', 'murph-lean-audit')
    const fullBundle = createAuditZip('package-audit-context-full.sh', 'murph-full-audit')

    try {
      const leanEntries = listZipEntries(leanBundle.zipPath)
      const fullEntries = listZipEntries(fullBundle.zipPath)

      expect(leanEntries).toContain('agent-docs/operations/verification-and-runtime.md')
      expect(leanEntries).toContain('agent-docs/product-specs/repo-v1.md')
      expect(leanEntries).toContain('docs/architecture.md')
      expect(leanEntries).not.toContain('agent-docs/generated/doc-inventory.md')
      expect(leanEntries).not.toContain('agent-docs/exec-plans/completed/README.md')
      expect(leanEntries).not.toContain('agent-docs/prompts/task-finish-review.md')
      expect(leanEntries).not.toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(leanEntries).not.toContain('apps/web/test/device-sync-http.test.ts')
      expect(leanEntries).not.toContain('docs/device-sync-hosted-control-plane.md')
      expect(leanEntries).not.toContain('.github/workflows/release.yml')

      expect(fullEntries).toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(fullEntries).toContain('apps/web/test/device-sync-http.test.ts')
      expect(fullEntries).toContain('docs/device-sync-hosted-control-plane.md')
      expect(fullEntries).toContain('.github/workflows/release.yml')
      expect(fullEntries).toContain('agent-docs/exec-plans/completed/README.md')
      expect(fullEntries).toContain('agent-docs/prompts/task-finish-review.md')
      expect(leanEntries.length).toBeLessThan(fullEntries.length)
    } finally {
      rmSync(leanBundle.outDir, { force: true, recursive: true })
      rmSync(fullBundle.outDir, { force: true, recursive: true })
    }
  })

  it('keeps release:check focused on release guards, typecheck, clean workspace build, and coverage verification', () => {
    const releaseCheck = readFileSync(
      path.join(repoRoot, 'scripts', 'release-check.sh'),
      'utf8',
    )

    expect(releaseCheck).toContain('bash -n scripts/release-check.sh scripts/release.sh scripts/update-changelog.sh scripts/generate-release-notes.sh')
    expect(releaseCheck).toContain('node scripts/verify-release-target.mjs')
    expect(releaseCheck).toContain('corepack pnpm build:workspace:clean')
    expect(releaseCheck).toContain('corepack pnpm verify:acceptance')
    expect(releaseCheck).not.toContain('pnpm install --frozen-lockfile')
    expect(releaseCheck).not.toContain('pnpm verify:repo')
    expect(releaseCheck).not.toContain('--out-dir "$temp_dir/tarballs"')

    expect(releaseCheck.indexOf('node scripts/verify-release-target.mjs')).toBeLessThan(
      releaseCheck.indexOf('corepack pnpm build:workspace:clean'),
    )
    expect(releaseCheck.indexOf('corepack pnpm build:workspace:clean')).toBeLessThan(
      releaseCheck.indexOf('corepack pnpm verify:acceptance'),
    )
  })

  it('runs release checks directly instead of through an env-overridable shell command', () => {
    const releaseScript = readFileSync(path.join(repoRoot, 'scripts', 'release.sh'), 'utf8')

    expect(releaseScript).toContain("echo 'Running release checks...'")
    expect(releaseScript).toContain('corepack pnpm release:check')
    expect(releaseScript).not.toContain('RELEASE_CHECK_CMD')
    expect(releaseScript).not.toContain('CHECK_CMD=')
    expect(releaseScript).not.toContain('sh -lc "$CHECK_CMD"')
  })

  it('propagates CLI package coverage failures instead of forcing the release lane green', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const runTimedStep = workspaceVerify.match(
      /run_timed_step\(\) \{[\s\S]*?^\}/m,
    )?.[0]
    const cliCoverageBranch = workspaceVerify.match(
      /run_workspace_package_coverage\(\) \{[\s\S]*?^\}/m,
    )?.[0]

    expect(runTimedStep).toBeTruthy()
    expect(cliCoverageBranch).toBeTruthy()
    expect(cliCoverageBranch).toContain(
      'env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" --coverage',
    )
    expect(cliCoverageBranch).toContain('return $?')
    const harnessDir = mkdtempSync(
      path.join(os.tmpdir(), 'murph-workspace-verify-harness-'),
    )

    try {
      const harnessPath = path.join(harnessDir, 'workspace-verify-harness.sh')
      writeFileSync(
        harnessPath,
        `#!/usr/bin/env bash
set -euo pipefail
verify_log() { :; }
${runTimedStep!}
run_workspace_package_coverage() {
  if [[ "$1" == "packages/cli" ]]; then
    run_timed_step "$2" false
    return $?
  fi
}
if ! run_workspace_package_coverage packages/cli "CLI package coverage"; then
  printf 'captured\\n'
  exit 0
fi
printf 'missed\\n'
exit 1
`,
        'utf8',
      )

      const result = spawnSync('bash', [harnessPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('captured')
      expect(result.stdout).not.toContain('missed')
    } finally {
      rmSync(harnessDir, { recursive: true, force: true })
    }
  })

  it('keeps the durable storage-boundary docs explicit about canonical product state versus assistant runtime residue', () => {
    const architecture = readFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), 'utf8')
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
    const baselineArchitecture = readFileSync(
      path.join(repoRoot, 'docs', 'architecture.md'),
      'utf8',
    )
    const invariants = readFileSync(
      path.join(repoRoot, 'docs', 'contracts', '00-invariants.md'),
      'utf8',
    )
    const commandSurface = readFileSync(
      path.join(repoRoot, 'docs', 'contracts', '03-command-surface.md'),
      'utf8',
    )
    const safeExtensionGuide = readFileSync(
      path.join(repoRoot, 'docs', 'safe-extension-guide.md'),
      'utf8',
    )
    const workflowRouting = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'agent-workflow-routing.md'),
      'utf8',
    )
    const verificationAndRuntime = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'verification-and-runtime.md'),
      'utf8',
    )
    const security = readFileSync(path.join(repoRoot, 'agent-docs', 'SECURITY.md'), 'utf8')
    const runtimeStateReadme = readFileSync(
      path.join(repoRoot, 'packages', 'runtime-state', 'README.md'),
      'utf8',
    )

    expect(architecture).toContain('Storage-policy hard line:')
    expect(architecture).toContain('execution residue, replay/continuity artifacts, and operator diagnostics only')
    expect(readme).toContain('it does not belong in assistant runtime first')
    expect(baselineArchitecture).toContain('do not use assistant runtime as a first stop for user-facing or queryable product state')
    expect(invariants).toContain('never in assistant runtime state')
    expect(commandSurface).toContain('runtime inspection/control only')
    expect(commandSurface).toContain('not an `assistant` runtime CRUD surface')
    expect(safeExtensionGuide).toContain('do not prototype it in assistant runtime first')
    expect(workflowRouting).toContain('it must not start life in assistant runtime or other operational state')
    expect(verificationAndRuntime).toContain('it must not start in assistant runtime first')
    expect(security).toContain('not a product-state staging area')
    expect(runtimeStateReadme).toContain('intentionally not a product-state incubator')
    expect(runtimeStateReadme).toContain('execution residue only')
  })

  it('verifies the live release manifest and publish set', () => {
    const summary = JSON.parse(
      execFileSync('node', ['scripts/verify-release-target.mjs', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage(),
      }),
    ) as {
      packages: Array<{ bundledWorkspaceDependencies?: string[]; name: string }>
      primaryPackage: { name: string } | null
      version: string
    }

    expect(summary.version).toBe(cliPackageJson.version)
    expect(summary.primaryPackage?.name).toBe('@murphai/murph')
    expect([...summary.packages.map((entry) => entry.name)].sort()).toEqual([
      '@murphai/contracts',
      '@murphai/hosted-execution',
      '@murphai/gateway-core',
      '@murphai/murph',
      '@murphai/openclaw-plugin',
    ].sort())

    expect(summary.packages).toContainEqual(expect.objectContaining({
      bundledWorkspaceDependencies: [
        '@murphai/core',
        '@murphai/device-syncd',
        '@murphai/importers',
        '@murphai/runtime-state',
      ],
      name: '@murphai/hosted-execution',
    }))
    expect(summary.packages).toContainEqual(expect.objectContaining({
      bundledWorkspaceDependencies: [
        '@murphai/assistant-cli',
        '@murphai/assistant-engine',
        '@murphai/assistantd',
        '@murphai/core',
        '@murphai/device-syncd',
        '@murphai/gateway-local',
        '@murphai/importers',
        '@murphai/inbox-services',
        '@murphai/inboxd',
        '@murphai/inboxd-imessage',
        '@murphai/messaging-ingress',
        '@murphai/operator-config',
        '@murphai/parsers',
        '@murphai/query',
        '@murphai/runtime-state',
        '@murphai/setup-cli',
        '@murphai/vault-usecases',
      ],
      name: '@murphai/murph',
    }))
  })

  it('keeps release script help usage stable for both --help and -h', () => {
    const cases = [
      {
        args: ['scripts/verify-release-target.mjs'],
        expected:
          'Usage: node scripts/verify-release-target.mjs [--expect-version <version>] [--json]',
      },
      {
        args: ['scripts/pack-publishables.mjs'],
        expected:
          'Usage: node scripts/pack-publishables.mjs [--expect-version <version>] [--out-dir <dir>] [--pack-output <file>] [--clean]',
      },
      {
        args: ['scripts/publish-publishables.mjs'],
        expected:
          'Usage: node scripts/publish-publishables.mjs [--pack-output <file>] [--npm-tag <tag>] [--provenance|--no-provenance]',
      },
    ] as const

    for (const helpFlag of ['--help', '-h']) {
      for (const testCase of cases) {
        const result = runNodeScript(...testCase.args, helpFlag)

        expect(result.status).toBe(0)
        expect(result.stderr).toBe('')
        expect(result.stdout.trim()).toBe(testCase.expected)
      }
    }
  })

  it('rejects unknown release-script arguments with the stable error text', () => {
    for (const scriptPath of [
      'scripts/verify-release-target.mjs',
      'scripts/pack-publishables.mjs',
      'scripts/publish-publishables.mjs',
    ]) {
      const result = runNodeScript(scriptPath, '--wat')

      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Unknown argument: --wat')
    }
  })

  it('preserves current value-token consumption and missing-value validation branches', () => {
    const verifyResult = runNodeScript(
      'scripts/verify-release-target.mjs',
      '--expect-version',
      '--json',
    )
    expect(verifyResult.status).not.toBe(0)
    expect(verifyResult.stdout).toBe('')
    expect(verifyResult.stderr).toContain(
      `Expected release version --json, but manifest packages are on ${cliPackageJson.version}.`,
    )

    const packMissingValue = runNodeScript(
      'scripts/pack-publishables.mjs',
      '--pack-output',
      '--expect-version',
    )
    expect(packMissingValue.status).not.toBe(0)
    expect(packMissingValue.stdout).toBe('')
    expect(packMissingValue.stderr).toContain(
      'Missing value for --expect-version.',
    )

    const packEmptyString = runNodeScript(
      'scripts/pack-publishables.mjs',
      '--out-dir',
      '',
    )
    expect(packEmptyString.status).not.toBe(0)
    expect(packEmptyString.stdout).toBe('')
    expect(packEmptyString.stderr).toContain('Missing value for --out-dir.')

    const publishMissingValue = runNodeScript(
      'scripts/publish-publishables.mjs',
      '--pack-output',
      '--npm-tag',
    )
    expect(publishMissingValue.status).not.toBe(0)
    expect(publishMissingValue.stdout).toBe('')
    expect(publishMissingValue.stderr).toContain('Missing value for --npm-tag.')

    const publishEmptyString = runNodeScript(
      'scripts/publish-publishables.mjs',
      '--npm-tag',
      '',
    )
    expect(publishEmptyString.status).not.toBe(0)
    expect(publishEmptyString.stdout).toBe('')
    expect(publishEmptyString.stderr).toContain('Missing value for --npm-tag.')
  })

  it('keeps packages/cli publish-ready as @murphai/murph without package-local release scripts', () => {
    expect(cliPackageJson.name).toBe('@murphai/murph')
    expect(cliPackageJson.files).toContain('CHANGELOG.md')
    expect(cliPackageJson.bin?.murph).toBe('dist/bin.js')
    expect(cliPackageJson.bin?.['vault-cli']).toBe('dist/bin.js')
    expect(cliPackageJson.dependencies?.['@murphai/device-syncd']).toBe('workspace:*')
    expect(cliPackageJson.dependencies?.['@murphai/gateway-local']).toBe('workspace:*')
    expect(cliPackageJson.dependencies?.['@murphai/messaging-ingress']).toBe('workspace:*')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/assistant-engine')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/vault-usecases')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/gateway-local')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/inboxd-imessage')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/messaging-ingress')
    expect(cliPackageJson.scripts?.['release:check']).toBeUndefined()
    expect(existsSync(path.join(packageDir, 'scripts', 'release.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'release-check.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'update-changelog.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'generate-release-notes.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'verify-release-target.ts'))).toBe(false)
  })

  it('keeps release-only docs drift allowances tied to the manifest package set', () => {
    const rootDocsDrift = readFileSync(
      path.join(repoRoot, 'scripts', 'check-agent-docs-drift.sh'),
      'utf8',
    )

    expect(rootDocsDrift).toContain('scripts/release-manifest.json')
    expect(rootDocsDrift).toContain('packages/cli/CHANGELOG.md')
    expect(rootDocsDrift).toContain('package_jsons_version_only')
  })

  it('wires the workspace package cycle guard into repo verification and keeps the live graph acyclic', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const result = runNodeScript('scripts/check-workspace-package-cycles.mjs')

    expect(workspaceVerify).toContain('node "scripts/check-workspace-package-cycles.mjs"')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('Workspace package dependency cycle check passed.')
  })

  it('detects and formats workspace package dependency cycles without duplicate reports', () => {
    const cycles = detectWorkspacePackageCycles([
      {
        name: '@murphai/a',
        packageJsonPath: path.join(repoRoot, 'packages', 'a', 'package.json'),
        internalDependencies: [{ name: '@murphai/b', fields: ['dependencies'] }],
      },
      {
        name: '@murphai/b',
        packageJsonPath: path.join(repoRoot, 'packages', 'b', 'package.json'),
        internalDependencies: [{ name: '@murphai/c', fields: ['devDependencies'] }],
      },
      {
        name: '@murphai/c',
        packageJsonPath: path.join(repoRoot, 'packages', 'c', 'package.json'),
        internalDependencies: [{ name: '@murphai/a', fields: ['peerDependencies'] }],
      },
      {
        name: '@murphai/d',
        packageJsonPath: path.join(repoRoot, 'packages', 'd', 'package.json'),
        internalDependencies: [{ name: '@murphai/a', fields: ['optionalDependencies'] }],
      },
    ])

    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.packageNames).toEqual([
      '@murphai/a',
      '@murphai/b',
      '@murphai/c',
      '@murphai/a',
    ])
    expect(formatWorkspacePackageCycles(cycles, repoRoot)).toBe(
      '@murphai/a -> @murphai/b -> @murphai/c -> @murphai/a '
        + '[packages/a/package.json (dependencies) -> @murphai/b | '
        + 'packages/b/package.json (devDependencies) -> @murphai/c | '
        + 'packages/c/package.json (peerDependencies) -> @murphai/a]',
    )
  })

  it('packages only canonical vault files without runtime or export-pack residue', () => {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-review-gpt-data-'))
    const vaultRoot = path.join(parentRoot, 'vault')
    const outputRoot = path.join(repoRoot, '.tmp-review-gpt-data')

    rmSync(outputRoot, { recursive: true, force: true })
    mkdirSync(path.join(vaultRoot, 'journal', '2026'), { recursive: true })
    mkdirSync(path.join(vaultRoot, '.runtime'), { recursive: true })
    mkdirSync(path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'sessions'), {
      recursive: true,
    })
    mkdirSync(path.join(vaultRoot, 'exports', 'packs', 'existing-pack'), { recursive: true })
    writeFileSync(path.join(vaultRoot, 'vault.json'), '{ "id": "vault_test" }\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'CORE.md'), '# Vault\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'journal', '2026', '2026-03-18.md'), '# Journal\n', 'utf8')
    writeFileSync(
      path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'MEMORY.md'),
      '# Memory\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'sessions', 'session.json'),
      '{"sessionId":"asst_test"}\n',
      'utf8',
    )
    writeFileSync(path.join(vaultRoot, '.runtime', 'secret.json'), '{"token":"nope"}\n', 'utf8')
    writeFileSync(
      path.join(vaultRoot, 'exports', 'packs', 'existing-pack', 'manifest.json'),
      '{"packId":"existing-pack"}\n',
      'utf8',
    )

    try {
      const output = execFileSync(
        'bash',
        [
          'scripts/package-data-context.sh',
          '--vault',
          vaultRoot,
          '--out-dir',
          outputRoot,
          '--name',
          'murph-test-data',
          '--no-docs',
          '--no-tests',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      )

      expect(output).toContain('Data package created.')
      expect(output).toContain('Vault files: 3')
      expect(output).not.toContain(vaultRoot)

      const zipMatch = output.match(/^ZIP: ([^ ]+) \(/m)
      expect(zipMatch).not.toBeNull()

      const zipPath = path.join(repoRoot, zipMatch?.[1] ?? '')
      const bundleDir = path.basename(zipPath, '.zip')
      const entries = execFileSync('unzip', ['-Z1', zipPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage(),
      })
        .trim()
        .split('\n')
        .filter((entry) => entry.length > 0)

      expect(entries).toContain(`${bundleDir}/bundle-manifest.json`)
      expect(entries).toContain(`${bundleDir}/vault/vault.json`)
      expect(entries).toContain(`${bundleDir}/vault/CORE.md`)
      expect(entries).toContain(`${bundleDir}/vault/journal/2026/2026-03-18.md`)
      expect(entries).not.toContain(`${bundleDir}/vault/.runtime/operations/assistant/MEMORY.md`)
      expect(entries).not.toContain(
        `${bundleDir}/vault/.runtime/operations/assistant/sessions/session.json`,
      )
      expect(entries).not.toContain(`${bundleDir}/vault/.runtime/secret.json`)
      expect(entries).not.toContain(
        `${bundleDir}/vault/exports/packs/existing-pack/manifest.json`,
      )
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
      rmSync(parentRoot, { recursive: true, force: true })
    }
  })
})
