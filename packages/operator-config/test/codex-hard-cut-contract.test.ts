import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  assistantChatProviderValues,
  assistantProviderSessionOptionsSchema,
} from '../src/assistant-cli-contracts.ts'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from '../src/assistant/provider-config.ts'
import {
  VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
  assistantExecutionDriverValues,
  assistantResumeKindValues,
} from '../src/assistant/target-runtime.ts'

describe('operator config Codex-only hard-cut contracts', () => {
  it('keeps Codex as the only active assistant runtime provider value', () => {
    expect(assistantChatProviderValues).toEqual(['codex-cli'])
    expect(assistantExecutionDriverValues).toEqual(['codex-app-server'])
    expect(assistantResumeKindValues).toEqual(['codex-thread'])
  })

  it('serializes Vercel AI Gateway through Codex modelProvider config', () => {
    const sessionOptions = serializeAssistantProviderSessionOptions({
      provider: 'codex-cli',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
    })

    expect(assistantProviderSessionOptionsSchema.parse(sessionOptions)).toMatchObject({
      executionDriver: 'codex-app-server',
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      modelProviderConfig: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
      provider: 'codex-cli',
      resumeKind: 'codex-thread',
    })
  })

  it('fails closed for removed OpenAI-compatible config inputs', () => {
    expect(() =>
      normalizeAssistantProviderConfig({
        provider: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5',
      }),
    ).toThrow(/Reconfigure the assistant for Codex App Server/u)
  })

  it('does not publish legacy OpenAI-compatible provider presets', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports?: Record<string, unknown> }

    expect(
      packageJson.exports?.['./assistant/openai-compatible-provider-presets'],
    ).toBeUndefined()
  })
})
