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

  it('removes obsolete provider and model-harness execution modules', () => {
    expect([
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'automation', 'routing.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'legacy-model-spec.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'provider-config.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'provider-binding.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'provider-registry.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'provider-route.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'provider-turn-runner.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'provider-turn', 'attempt-observability.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'provider-turn', 'planning.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'providers', 'legacy-provider.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'providers', 'registry.ts'),
      path.join('packages', 'assistant-engine', 'src', 'inbox-model-harness.ts'),
      path.join('packages', 'assistant-engine', 'src', 'inbox-multimodal.ts'),
      path.join('packages', 'assistant-engine', 'src', 'model-harness', 'model-spec.ts'),
      path.join('packages', 'assistant-engine', 'src', 'model-harness', 'responses-policy.ts'),
      path.join('packages', 'assistant-engine', 'src', 'model-harness', 'tool-catalog.ts'),
      path.join('packages', 'cli', 'src', 'inbox-model-runtime.ts'),
    ].filter((filePath) => existsSync(resolveRepoPath(filePath)))).toEqual([])
  })

  it('removes hosted provider request debug traces from active runtime source', async () => {
    const runtimePaths = [
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'codex-turn-runner.ts'),
      path.join('packages', 'assistant-runtime', 'src', 'hosted-runtime', 'events.ts'),
      path.join('packages', 'assistant-runtime', 'src', 'hosted-runtime', 'maintenance.ts'),
    ]
    const removedTraceResidue = [
      'murph.assistant-provider-request-debug.v1',
      'assistant.provider.request.debug',
      'Hosted assistant provider request summary captured',
    ]

    for (const runtimePath of runtimePaths) {
      const source = await readFile(resolveRepoPath(runtimePath), 'utf8')
      for (const residue of removedTraceResidue) {
        expect(source).not.toContain(residue)
      }
    }
  })

  it('removes old route contracts and model-route residue', async () => {
    const oldContractFileName = ['inbox', 'model', 'contracts.ts'].join('-')
    const deletedContractPaths = [
      path.join('packages', 'cli', 'src', oldContractFileName),
      path.join('packages', 'assistant-engine', 'src', oldContractFileName),
    ]
    const contractPaths = [
      path.join('packages', 'assistant-engine', 'src', 'attachment-prompt-contracts.ts'),
    ]
    const removedContractSymbols = [
      'assistantToolSpecSchema',
      'assistantExecutionPlanSchema',
      ['inbox', 'Model', 'RouteResultSchema'].join(''),
      'AssistantToolExecutionResult',
      'AssistantExecutionPlan',
      ['Inbox', 'Model', 'RouteResult'].join(''),
      'providerMode',
    ]

    expect(
      deletedContractPaths.filter((filePath) => existsSync(resolveRepoPath(filePath))),
    ).toEqual([])
    for (const contractPath of contractPaths) {
      const source = await readFile(resolveRepoPath(contractPath), 'utf8')
      for (const symbol of removedContractSymbols) {
        expect(source).not.toContain(symbol)
      }
    }
  })

  it('removes dead modelSpec forwarding from assistant automation runtime surfaces', async () => {
    const runtimePaths = [
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'automation', 'run-loop.ts'),
      path.join('packages', 'assistant-engine', 'src', 'assistant', 'automation', 'scanner.ts'),
      path.join('packages', 'assistant-cli', 'src', 'assistant', 'automation', 'run-loop.ts'),
      path.join('packages', 'assistant-cli', 'src', 'assistant-daemon-client.ts'),
      path.join('packages', 'assistantd', 'src', 'service.ts'),
    ]

    for (const runtimePath of runtimePaths) {
      const source = await readFile(resolveRepoPath(runtimePath), 'utf8')
      expect(source).not.toContain('modelSpec')
    }
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
