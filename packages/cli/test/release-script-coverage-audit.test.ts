import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
})
