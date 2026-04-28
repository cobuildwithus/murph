import { describe, expect, it } from 'vitest'
import type { SetupCommandOptions } from '@murphai/operator-config/setup-cli-contracts'
import {
  createSetupAssistantResolver,
  hasExplicitSetupAssistantOptions,
  inferSetupAssistantPresetFromOptions,
} from '../src/setup-assistant.ts'

describe('removed OpenAI-compatible setup option handling', () => {
  it('keeps legacy OpenAI-compatible options explicit but fail-closed', () => {
    expect(
      hasExplicitSetupAssistantOptions({
        assistantZeroDataRetention: false,
      }),
    ).toBe(true)
    expect(() =>
      inferSetupAssistantPresetFromOptions({
        assistantZeroDataRetention: false,
      }),
    ).toThrow(/OpenAI-compatible assistant setup options have been removed/u)
  })

  it('rejects legacy gateway options before resolving a Codex assistant', async () => {
    const resolver = createSetupAssistantResolver({
      assistantAccount: {
        resolve: async () => null,
      },
      resolveCodexHome: async () => ({
        codexHome: null,
        discoveredHomes: [],
      }),
    })

    await expect(
      resolver.resolve({
        allowPrompt: false,
        commandName: 'test',
        preset: 'codex',
        options: {
          vault: '/tmp/test-vault',
          strict: false,
          whisperModel: 'base.en',
          assistantProviderPreset: 'vercel-ai-gateway',
          assistantZeroDataRetention: false,
        } as unknown as SetupCommandOptions,
      }),
    ).rejects.toThrow(/OpenAI-compatible assistant setup options have been removed/u)
  })
})
