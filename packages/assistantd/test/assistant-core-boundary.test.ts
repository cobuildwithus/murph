import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

async function listTypeScriptFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath)
    }
  }

  return files.sort()
}

function extractModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?["']([^"'`]+)["']/gu,
    /\bimport\s*\(\s*["']([^"'`]+)["']\s*\)/gu,
  ]

  for (const pattern of patterns) {
    let match = pattern.exec(source)
    while (match !== null) {
      specifiers.push(match[1])
      match = pattern.exec(source)
    }
  }

  return specifiers
}

test('assistant-services stays a compatibility shim over murph/assistant-core', async () => {
  const assistantServicesRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../assistant-services/src',
  )
  const files = (await listTypeScriptFiles(assistantServicesRoot)).filter(
    (filePath) => path.basename(filePath) !== 'index.ts',
  )

  assert.ok(files.length > 0)

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8')
    assert.match(
      source,
      /from\s+["']murph\/assistant-core["']/u,
      `${path.relative(assistantServicesRoot, filePath)} should import from murph/assistant-core.`,
    )
    assert.doesNotMatch(
      source,
      /from\s+["']murph["']/u,
      `${path.relative(assistantServicesRoot, filePath)} should not reach through the root murph export.`,
    )
    assert.doesNotMatch(
      source,
      /@murph\/runtime-state|node:fs|node:path/u,
      `${path.relative(assistantServicesRoot, filePath)} should stay a pure compatibility shim without local runtime-state ownership.`,
    )
  }
})

test('assistantd uses murph/assistant-core instead of the root murph export', async () => {
  const assistantdRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src',
  )
  const files = [
    path.join(assistantdRoot, 'http.ts'),
    path.join(assistantdRoot, 'service.ts'),
  ]

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8')
    assert.match(
      source,
      /from\s+["']murph\/assistant-core["']/u,
      `${path.basename(filePath)} should import from murph/assistant-core.`,
    )
    assert.doesNotMatch(
      source,
      /from\s+["']murph["']/u,
      `${path.basename(filePath)} should not reach through the root murph export.`,
    )
  }
})

test('non-CLI workspace code avoids the root murph export', async () => {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
  )
  const candidateFiles = [
    ...(await listTypeScriptFiles(path.join(repoRoot, 'packages'))),
    ...(await listTypeScriptFiles(path.join(repoRoot, 'apps'))),
  ].filter((filePath) => {
    const relativePath = path.relative(repoRoot, filePath)
    return (
      !relativePath.startsWith(path.join('packages', 'cli') + path.sep) &&
      !relativePath.includes(`${path.sep}dist${path.sep}`)
    )
  })

  for (const filePath of candidateFiles) {
    const source = await readFile(filePath, 'utf8')
    assert.ok(
      !extractModuleSpecifiers(source).includes('murph'),
      `${path.relative(repoRoot, filePath)} should use an explicit murph subpath or a package-local workspace boundary.`,
    )
  }
})
