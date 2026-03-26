import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)

const SOURCE_ROOTS = [
  'apps/cloudflare/src',
  'apps/web/src',
  'packages/cli/src',
  'packages/device-syncd/src',
  'packages/importers/src',
  'packages/inboxd/src',
  'packages/parsers/src',
  'packages/query/src',
  'packages/runtime-state/src',
  'packages/web/src',
] as const

const ALLOWED_NON_CORE_CANONICAL_MUTATORS = [
  'packages/cli/src/assistant/canonical-write-guard.ts',
  'packages/inboxd/src/indexing/persist.ts',
] as const

const FS_MUTATION_PATTERNS = [
  /\bwriteFile\(/u,
  /\bappendFile\(/u,
  /\bcopyFile\(/u,
  /\brename\(/u,
  /\brm\(/u,
  /\bunlink\(/u,
]

const VAULT_RESOLUTION_PATTERNS = [
  /\bresolveVaultPathOnDisk\(/u,
  /\bresolveVaultPath\(/u,
  /\bresolveVaultRelativePath\(/u,
  /\babsoluteVaultRoot\b/u,
  /path\.join\(\s*vaultRoot\b/u,
  /path\.join\(\s*input\.vault\b/u,
  /path\.join\(\s*input\.vaultRoot\b/u,
]

const CANONICAL_TARGET_PATTERNS = [
  /WORKOUT_FORMATS_DIRECTORY/u,
  /['"`]bank\//u,
  /['"`]journal\//u,
  /['"`]ledger\//u,
  /['"`]audit\//u,
  /CORE\.md/u,
  /vault\.json/u,
  /VAULT_LAYOUT\.(?:metadata|coreDocument|journalDirectory|auditDirectory|eventLedgerDirectory|sampleLedgerDirectory|rawDirectory)/u,
]

const DIRECT_CANONICAL_JOIN_PATTERNS = [
  /path(?:\.posix)?\.join\(\s*(?:vaultRoot|input\.vault|input\.vaultRoot|absoluteVaultRoot|paths\.absoluteVaultRoot)\s*,\s*['"`](?:bank|journal|ledger|audit|raw)['"`]/u,
  /path(?:\.posix)?\.join\(\s*(?:vaultRoot|input\.vault|input\.vaultRoot|absoluteVaultRoot|paths\.absoluteVaultRoot)\s*,\s*['"`](?:CORE\.md|vault\.json)['"`]/u,
]

test('non-core source files do not mutate canonical vault paths without an explicit audit allowlist', async () => {
  const actual = (
    await Promise.all(
      SOURCE_ROOTS.map(async (sourceRoot) => {
        const absoluteRoot = path.join(REPO_ROOT, sourceRoot)
        return findCanonicalMutators(absoluteRoot)
      }),
    )
  )
    .flat()
    .map((relativePath) => relativePath.replace(/\\/gu, '/'))
    .sort()

  assert.deepEqual(actual, [...ALLOWED_NON_CORE_CANONICAL_MUTATORS].sort())
})

test('canonical mutator matcher catches representative bypass shapes and ignores safe vault-local writes', () => {
  assert.equal(
    isCanonicalMutatorSource(`
      const absolutePath = path.join(vaultRoot, 'raw', 'inbox', 'captures', 'cap_1', 'envelope.json')
      await writeFile(absolutePath, payload, 'utf8')
    `),
    true,
  )

  assert.equal(
    isCanonicalMutatorSource(`
      const absolutePath = path.posix.join(input.vaultRoot, 'bank', 'foods', 'example.md')
      await writeFile(absolutePath, markdown, 'utf8')
    `),
    true,
  )

  assert.equal(
    isCanonicalMutatorSource(`
      const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath)
      await writeFile(resolved.absolutePath, markdown, 'utf8')
      const root = WORKOUT_FORMATS_DIRECTORY
    `),
    true,
  )

  assert.equal(
    isCanonicalMutatorSource(`
      const directory = path.join(absoluteVaultRoot, 'derived', 'assistant', 'payloads', toolName)
      await writeFile(path.join(directory, fileName), payload, 'utf8')
    `),
    false,
  )

  assert.equal(
    isCanonicalMutatorSource(`
      const example = 'raw/inbox/captures/cap_123/attachments/1/report.pdf'
      await writeFile(absolutePath, payload, 'utf8')
    `),
    false,
  )
})

async function findCanonicalMutators(root: string): Promise<string[]> {
  const entries = await walkSourceFiles(root)
  const matches: string[] = []

  for (const absolutePath of entries) {
    const relativePath = path.relative(REPO_ROOT, absolutePath).replace(/\\/gu, '/')

    if (relativePath.startsWith('packages/core/')) {
      continue
    }

    const source = await readFile(absolutePath, 'utf8')
    if (isCanonicalMutatorSource(source)) {
      matches.push(relativePath)
    }
  }

  return matches
}

async function walkSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(absolutePath)))
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    if (!absolutePath.endsWith('.ts') && !absolutePath.endsWith('.tsx')) {
      continue
    }

    files.push(absolutePath)
  }

  return files
}

function matchesPattern(source: string, patterns: readonly RegExp[]) {
  return patterns.some((pattern) => pattern.test(source))
}

function isCanonicalMutatorSource(source: string) {
  if (!matchesPattern(source, FS_MUTATION_PATTERNS)) {
    return false
  }

  if (matchesPattern(source, DIRECT_CANONICAL_JOIN_PATTERNS)) {
    return true
  }

  return (
    matchesPattern(source, VAULT_RESOLUTION_PATTERNS) &&
    matchesPattern(source, CANONICAL_TARGET_PATTERNS)
  )
}
