import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveAssistantStatePaths } from '@murph/assistant-core/assistant-state'
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
  dependencies?: Record<string, string>
  files?: string[]
  name?: string
  scripts?: Record<string, string>
}

function runNodeScript(...args: string[]) {
  return spawnSync('node', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withoutNodeV8Coverage(),
  })
}

function createAuditZip(scriptName: string, prefix: string) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const result = spawnSync(
    'bash',
    [path.join(repoRoot, 'scripts', scriptName), '--zip', '--out-dir', outDir, '--name', prefix],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: withoutNodeV8Coverage(),
    },
  )

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
    expect(rootPackageJson.scripts?.['changelog:update']).toBe('bash scripts/update-changelog.sh')
    expect(rootPackageJson.scripts?.['release:notes']).toBe('bash scripts/generate-release-notes.sh')
    expect(rootPackageJson.scripts?.['release:check']).toBe('bash scripts/release-check.sh')
    expect(rootPackageJson.scripts?.['release:patch']).toBe('bash scripts/release.sh patch')
    expect(rootPackageJson.scripts?.['release:minor']).toBe('bash scripts/release.sh minor')
    expect(rootPackageJson.scripts?.['release:major']).toBe('bash scripts/release.sh major')
    expect(rootPackageJson.scripts?.['review:gpt:full']).toBe(
      'cobuild-review-gpt --config scripts/review-gpt-full.config.sh',
    )
    expect(rootPackageJson.scripts?.['review:gpt:data']).toBe('bash scripts/review-gpt-data.sh')
    expect(rootPackageJson.scripts?.['verify:workspace-package-cycles']).toBe(
      'node scripts/check-workspace-package-cycles.mjs',
    )
    expect(rootPackageJson.scripts?.['zip:src:full']).toBe('bash scripts/package-audit-context-full.sh --zip')
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
      expect(leanEntries).toContain('agent-docs/FRONTEND.md')
      expect(leanEntries).toContain('agent-docs/product-specs/repo-bootstrap.md')
      expect(leanEntries).toContain('docs/architecture.md')
      expect(leanEntries).not.toContain('agent-docs/generated/doc-inventory.md')
      expect(leanEntries).not.toContain('agent-docs/exec-plans/completed/README.md')
      expect(leanEntries).not.toContain('agent-docs/prompts/task-finish-review.md')
      expect(leanEntries).not.toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(leanEntries).not.toContain('apps/web/test/device-sync-http.test.ts')
      expect(leanEntries).not.toContain('docs/legacy-removal-audit-2026-03-31.md')
      expect(leanEntries).not.toContain('.github/workflows/release.yml')

      expect(fullEntries).toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(fullEntries).toContain('apps/web/test/device-sync-http.test.ts')
      expect(fullEntries).toContain('docs/legacy-removal-audit-2026-03-31.md')
      expect(fullEntries).toContain('.github/workflows/release.yml')
      expect(fullEntries).toContain('agent-docs/generated/doc-inventory.md')
      expect(fullEntries).toContain('agent-docs/exec-plans/completed/README.md')
      expect(fullEntries).toContain('agent-docs/prompts/task-finish-review.md')
      expect(leanEntries.length).toBeLessThan(fullEntries.length)
    } finally {
      rmSync(leanBundle.outDir, { force: true, recursive: true })
      rmSync(fullBundle.outDir, { force: true, recursive: true })
    }
  })

  it('keeps release:check ordered around install, build, repo verification, target validation, and pnpm pack', () => {
    const releaseCheck = readFileSync(
      path.join(repoRoot, 'scripts', 'release-check.sh'),
      'utf8',
    )

    const expectedOrder = [
      'pnpm install --frozen-lockfile',
      'pnpm build',
      'pnpm verify:repo',
      'node scripts/verify-release-target.mjs',
      'node scripts/pack-publishables.mjs',
    ]

    let previousIndex = -1
    for (const token of expectedOrder) {
      const nextIndex = releaseCheck.indexOf(token)
      expect(nextIndex, `missing ${token}`).toBeGreaterThan(-1)
      expect(nextIndex, `${token} out of order`).toBeGreaterThan(previousIndex)
      previousIndex = nextIndex
    }
  })

  it('verifies the live release manifest and publish set', () => {
    const summary = JSON.parse(
      execFileSync('node', ['scripts/verify-release-target.mjs', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage(),
      }),
    ) as {
      packages: Array<{ name: string }>
      primaryPackage: { name: string } | null
      version: string
    }

    expect(summary.version).toBe('0.0.0')
    expect(summary.primaryPackage?.name).toBe('murph')
    expect(summary.packages.map((entry) => entry.name)).toEqual([
      '@murph/contracts',
      '@murph/hosted-execution',
      '@murph/runtime-state',
      '@murph/core',
      '@murph/query',
      '@murph/importers',
      '@murph/device-syncd',
      '@murph/inboxd',
      '@murph/parsers',
      '@murph/assistant-core',
      '@murph/gateway-core',
      '@murph/assistant-runtime',
      '@murph/assistantd',
      'murph',
    ])
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
      'Expected release version --json, but manifest packages are on 0.0.0.',
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

  it('keeps packages/cli publish-ready as murph without package-local release scripts', () => {
    expect(cliPackageJson.name).toBe('murph')
    expect(cliPackageJson.files).toContain('CHANGELOG.md')
    expect(cliPackageJson.bin?.murph).toBe('dist/bin.js')
    expect(cliPackageJson.bin?.['vault-cli']).toBe('dist/bin.js')
    expect(cliPackageJson.dependencies?.['@murph/device-syncd']).toBe('workspace:*')
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
        name: '@murph/a',
        packageJsonPath: path.join(repoRoot, 'packages', 'a', 'package.json'),
        internalDependencies: [{ name: '@murph/b', fields: ['dependencies'] }],
      },
      {
        name: '@murph/b',
        packageJsonPath: path.join(repoRoot, 'packages', 'b', 'package.json'),
        internalDependencies: [{ name: '@murph/c', fields: ['devDependencies'] }],
      },
      {
        name: '@murph/c',
        packageJsonPath: path.join(repoRoot, 'packages', 'c', 'package.json'),
        internalDependencies: [{ name: '@murph/a', fields: ['peerDependencies'] }],
      },
      {
        name: '@murph/d',
        packageJsonPath: path.join(repoRoot, 'packages', 'd', 'package.json'),
        internalDependencies: [{ name: '@murph/a', fields: ['optionalDependencies'] }],
      },
    ])

    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.packageNames).toEqual([
      '@murph/a',
      '@murph/b',
      '@murph/c',
      '@murph/a',
    ])
    expect(formatWorkspacePackageCycles(cycles, repoRoot)).toBe(
      '@murph/a -> @murph/b -> @murph/c -> @murph/a '
        + '[packages/a/package.json (dependencies) -> @murph/b | '
        + 'packages/b/package.json (devDependencies) -> @murph/c | '
        + 'packages/c/package.json (peerDependencies) -> @murph/a]',
    )
  })

  it('packages the selected vault and matching assistant-state without runtime or export-pack residue', () => {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-review-gpt-data-'))
    const vaultRoot = path.join(parentRoot, 'vault')
    const outputRoot = path.join(repoRoot, '.tmp-review-gpt-data')

    rmSync(outputRoot, { recursive: true, force: true })
    mkdirSync(path.join(vaultRoot, 'journal', '2026'), { recursive: true })
    mkdirSync(path.join(vaultRoot, '.runtime'), { recursive: true })
    mkdirSync(path.join(vaultRoot, 'exports', 'packs', 'existing-pack'), { recursive: true })
    writeFileSync(path.join(vaultRoot, 'vault.json'), '{ "id": "vault_test" }\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'CORE.md'), '# Vault\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'journal', '2026', '2026-03-18.md'), '# Journal\n', 'utf8')
    writeFileSync(path.join(vaultRoot, '.runtime', 'secret.json'), '{"token":"nope"}\n', 'utf8')
    writeFileSync(
      path.join(vaultRoot, 'exports', 'packs', 'existing-pack', 'manifest.json'),
      '{"packId":"existing-pack"}\n',
      'utf8',
    )

    const assistantPaths = resolveAssistantStatePaths(vaultRoot)
    mkdirSync(assistantPaths.sessionsDirectory, { recursive: true })
    writeFileSync(assistantPaths.longTermMemoryPath, '# Memory\n', 'utf8')
    writeFileSync(
      path.join(assistantPaths.sessionsDirectory, 'session.json'),
      '{"sessionId":"asst_test"}\n',
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
      expect(output).toContain('Assistant-state files: 2 (included)')
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
      expect(entries).toContain(`${bundleDir}/assistant-state/MEMORY.md`)
      expect(entries).toContain(`${bundleDir}/assistant-state/sessions/session.json`)
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
