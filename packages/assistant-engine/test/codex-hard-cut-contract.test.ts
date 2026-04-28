import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const sourceRoots = [
  path.join('packages', 'assistant-engine', 'src'),
  path.join('packages', 'assistant-runtime', 'src'),
] as const
const activeAiSdkImportPattern =
  /\bfrom\s+['"](?:ai(?:\/[^'"]*)?|@ai-sdk\/[^'"]+)['"]|\bimport\s*\(\s*['"](?:ai(?:\/[^'"]*)?|@ai-sdk\/[^'"]+)['"]\s*\)|\brequire\s*\(\s*['"](?:ai(?:\/[^'"]*)?|@ai-sdk\/[^'"]+)['"]\s*\)|@ai-sdk\//u

describe('Codex-only assistant hard-cut contracts', () => {
  it('removes active AI SDK imports from assistant runtime source', async () => {
    const matches: string[] = []

    for (const filePath of await listSourceFiles(sourceRoots)) {
      const source = await readFile(resolveRepoPath(filePath), 'utf8')
      if (activeAiSdkImportPattern.test(source)) {
        matches.push(filePath)
      }
    }

    expect(matches).toEqual([])
  })

  it('removes obsolete OpenAI-compatible provider and model-harness execution modules', () => {
    expect([
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'providers', 'openai-compatible.ts'),
      path.join('packages', 'assistant-engine', 'src', 'model-harness', 'model-spec.ts'),
      path.join('packages', 'assistant-engine', 'src', 'model-harness', 'responses-policy.ts'),
      path.join('packages', 'assistant-engine', 'src', 'model-harness', 'tool-catalog.ts'),
      path.join('packages', 'cli', 'src', 'inbox-model-runtime.ts'),
    ].filter((filePath) => existsSync(resolveRepoPath(filePath)))).toEqual([])
  })

  it('keeps Codex app-server model provider, steer, and interrupt protocol support explicit', async () => {
    const codexRuntime = await readFile(
      resolveRepoPath(path.join('packages', 'assistant-engine', 'src', 'assistant-codex.ts')),
      'utf8',
    )
    const codexRequestBuilder = await readFile(
      resolveRepoPath(path.join('packages', 'assistant-engine', 'src', 'assistant-codex', 'app-server-requests.ts')),
      'utf8',
    )

    expect(codexRequestBuilder).toMatch(/\bmodelProvider\b/u)
    expect(codexRuntime).toContain("'turn/steer'")
    expect(codexRuntime).toContain("'turn/interrupt'")
  })
})

async function listSourceFiles(roots: readonly string[]): Promise<string[]> {
  const files: string[] = []
  for (const root of roots) {
    await collectSourceFiles(root, files)
  }
  return files.sort()
}

async function collectSourceFiles(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(resolveRepoPath(directory), {
    withFileTypes: true,
  })

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await collectSourceFiles(entryPath, files)
      continue
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath)
    }
  }
}

function resolveRepoPath(filePath: string): string {
  return path.join(repoRoot, filePath)
}
