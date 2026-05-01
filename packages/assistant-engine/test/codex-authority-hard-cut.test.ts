import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDirname = path.dirname(fileURLToPath(import.meta.url))
const assistantEngineRoot = path.resolve(testDirname, '..')
const packagesRoot = path.resolve(assistantEngineRoot, '..')

async function readAssistantEngineSource(relativePath: string): Promise<string> {
  return readFile(
    path.join(assistantEngineRoot, 'src', 'assistant', relativePath),
    'utf8',
  )
}

async function readWorkspacePackageSource(relativePath: string): Promise<string> {
  return readFile(path.join(packagesRoot, relativePath), 'utf8')
}

describe('Codex authority hard cut', () => {
  it('does not short-circuit assistant turns through hosted device-connect heuristics', async () => {
    const source = await readAssistantEngineSource('provider-turn-runner.ts')

    expect(source).not.toContain('maybeHandleAssistantHostedDeviceConnect')
    expect(source).not.toContain("from './hosted-device-connect.js'")
    expect(source).not.toContain("activityLabels: ['hosted-device-connect']")
    expect(source).toContain('executeCodexAssistantTurnAttemptFromInput')
  })

  it('does not keep the hosted device-connect heuristic helper as production source', async () => {
    await expect(
      readAssistantEngineSource('hosted-device-connect.ts'),
    ).rejects.toThrow()
  })

  it('keeps hosted Codex shell execution on an explicit environment allowlist', async () => {
    const source = await readWorkspacePackageSource(
      'assistant-runtime/src/hosted-runtime/codex-config.ts',
    )

    expect(source).toContain(
      'DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE = "none"',
    )
    expect(source).toContain(
      'DEFAULT_HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY',
    )
  })

  it('does not materialize the displayed Codex default model into CLI turn selection', async () => {
    const source = await readWorkspacePackageSource(
      'assistant-cli/src/assistant/ui/chat-controller-models.ts',
    )

    expect(source).not.toContain(
      'normalizeNullableString(input.codexDisplay.model)',
    )
  })
})
