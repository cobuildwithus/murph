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
    const source = await readAssistantEngineSource('codex-turn-runner.ts')

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
    const codexConfig = await readWorkspacePackageSource(
      'assistant-runtime/src/hosted-runtime/codex-config.ts',
    )
    const shellEnvPolicy = await readWorkspacePackageSource(
      'assistant-runtime/src/hosted-runtime/codex-shell-env-policy.ts',
    )

    expect(codexConfig).toContain(
      'from "./codex-shell-env-policy.ts"',
    )
    expect(codexConfig).toContain(
      'HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE',
    )
    expect(codexConfig).toContain(
      'HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY',
    )
    expect(shellEnvPolicy).toContain(
      'HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE = "all"',
    )
    expect(shellEnvPolicy).toContain(
      'HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY',
    )
    expect(shellEnvPolicy).toContain('"ELEVENLABS_API_KEY"')
    expect(shellEnvPolicy).toContain('"PATH"')
    expect(shellEnvPolicy).toContain('"VAULT"')
    expect(shellEnvPolicy).toContain('"MURPH_ELEVENLABS_MODEL_ID"')
    expect(shellEnvPolicy).toContain('"MURPH_ELEVENLABS_VOICE_ID"')
    expect(shellEnvPolicy).not.toContain('OPENAI_API_KEY')
    expect(shellEnvPolicy).not.toContain('VERCEL_AI_API_KEY')
  })

  it('does not hard-code hosted Codex model defaults in Murph config', async () => {
    const hostedRuntime = await readWorkspacePackageSource(
      'assistant-runtime/src/hosted-runtime/codex-config.ts',
    )
    const hostedOperatorConfig = await readWorkspacePackageSource(
      'operator-config/src/hosted-assistant-config.ts',
    )

    expect(hostedRuntime).not.toContain('DEFAULT_HOSTED_CODEX_MODEL')
    expect(hostedRuntime).not.toContain('model: runtimeEnv.HOSTED_ASSISTANT_MODEL')
    expect(hostedOperatorConfig).not.toContain('DEFAULT_HOSTED_ASSISTANT_MODEL')
    expect(hostedOperatorConfig).not.toContain(
      'if (!normalizeHostedAssistantString(providerConfig.model))',
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
