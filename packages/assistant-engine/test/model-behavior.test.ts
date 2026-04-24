import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
  resolveAssistantModelBehaviorProfile,
} from '../src/assistant/model-behavior.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

describe('resolveAssistantModelBehaviorProfile', () => {
  it('uses the GPT-5 agentic profile for GPT-5 OpenAI-compatible targets', () => {
    expect(
      resolveAssistantModelBehaviorProfile({
        model: 'gpt-5.4',
        provider: 'openai-compatible',
      }),
    ).toBe('gpt5-agentic')
  })

  it('treats namespaced GPT-5 model ids as GPT-5 family routes', () => {
    expect(
      resolveAssistantModelBehaviorProfile({
        model: 'openai/gpt-5.4',
        provider: 'openai-compatible',
      }),
    ).toBe('gpt5-agentic')
  })

  it('uses the GPT-5 agentic profile for default Codex CLI routes', () => {
    expect(
      resolveAssistantModelBehaviorProfile({
        provider: 'codex-cli',
      }),
    ).toBe('gpt5-agentic')
  })

  it('keeps OSS Codex routes on the default profile', () => {
    expect(
      resolveAssistantModelBehaviorProfile({
        oss: true,
        provider: 'codex-cli',
      }),
    ).toBe('default')
  })
})

describe('assistant GPT-5 execution prompt overlay', () => {
  it('adds the GPT-5 execution contract without changing the calmer Murph voice', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      allowSensitiveHealthContext: true,
      assistantCommandAccessMode: 'bound-tools',
      assistantHealthCommonsAccessMode: 'bound-tools',
      assistantHostedDeviceConnectAvailable: true,
      assistantHostedDeviceConnectProviders: [
        { label: 'Oura', provider: 'oura' },
      ],
      assistantKnowledgeToolsAvailable: true,
      channel: 'telegram',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-04-15',
      currentTimeZone: 'Asia/Kuala_Lumpur',
      onboardingGuidance: false,
      modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: null,
      vaultOverview: null,
    })

    expect(prompt).toContain('Execution style:')
    expect(prompt).toContain('GPT-5 execution bias:')
    expect(prompt).toContain(
      'do the work in this turn instead of asking for extra permission',
    )
    expect(prompt).toContain('It does not mean inventing extra health interventions')
    expect(
      buildAssistantExecutionBehaviorText({ profile: 'gpt5-agentic' }),
    ).toContain('Commentary-only turns are incomplete')
  })

  it('keeps the default profile on the shared execution guidance only', () => {
    const text = buildAssistantExecutionBehaviorText({
      profile: 'default',
    })

    expect(text).toContain('Execution style:')
    expect(text).not.toContain('GPT-5 execution bias:')
  })
})
