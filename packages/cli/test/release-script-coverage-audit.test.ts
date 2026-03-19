import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveAssistantStatePaths } from '../src/assistant-state.js'

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

describe('monorepo release flow coverage audit', () => {
  it('exposes root-owned release scripts', () => {
    expect(rootPackageJson.name).toBe('healthybob-workspace')
    expect(rootPackageJson.scripts?.['changelog:update']).toBe('bash scripts/update-changelog.sh')
    expect(rootPackageJson.scripts?.['release:notes']).toBe('bash scripts/generate-release-notes.sh')
    expect(rootPackageJson.scripts?.['release:check']).toBe('bash scripts/release-check.sh')
    expect(rootPackageJson.scripts?.['release:patch']).toBe('bash scripts/release.sh patch')
    expect(rootPackageJson.scripts?.['release:minor']).toBe('bash scripts/release.sh minor')
    expect(rootPackageJson.scripts?.['release:major']).toBe('bash scripts/release.sh major')
    expect(rootPackageJson.scripts?.['review:gpt:data']).toBe('bash scripts/review-gpt-data.sh')
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
      }),
    ) as {
      packages: Array<{ name: string }>
      primaryPackage: { name: string } | null
      version: string
    }

    expect(summary.version).toBe('0.0.0')
    expect(summary.primaryPackage?.name).toBe('healthybob')
    expect(summary.packages.map((entry) => entry.name)).toEqual([
      '@healthybob/contracts',
      '@healthybob/runtime-state',
      '@healthybob/core',
      '@healthybob/query',
      '@healthybob/importers',
      '@healthybob/device-syncd',
      '@healthybob/inboxd',
      '@healthybob/parsers',
      'healthybob',
    ])
  })

  it('keeps packages/cli publish-ready as healthybob without package-local release scripts', () => {
    expect(cliPackageJson.name).toBe('healthybob')
    expect(cliPackageJson.files).toContain('CHANGELOG.md')
    expect(cliPackageJson.bin?.healthybob).toBe('dist/bin.js')
    expect(cliPackageJson.bin?.['vault-cli']).toBe('dist/bin.js')
    expect(cliPackageJson.dependencies?.['@healthybob/device-syncd']).toBe('workspace:*')
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

  it('packages the selected vault and matching assistant-state without runtime or export-pack residue', () => {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), 'healthybob-review-gpt-data-'))
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
          'healthybob-test-data',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
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
