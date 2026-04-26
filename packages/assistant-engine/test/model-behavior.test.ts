import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
  resolveAssistantModelBehaviorProfile,
} from '../src/assistant/model-behavior.js'
import {
  buildAssistantNotificationDecisionSystemPromptWithCacheMetadata,
  buildAssistantSystemPrompt,
  buildAssistantSystemPromptWithCacheMetadata,
  type AssistantNotificationDecisionSystemPromptInput,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

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

describe('assistant system prompt cache stability', () => {
  it('keeps the common OpenAI route prefix stable across dynamic turn context', () => {
    const cacheInput = {
      toolSchemaHash: 'assistant-tool-schema-common-openai-test',
    }
    const promptA = buildAssistantSystemPromptWithCacheMetadata(
      createCommonOpenAiPromptInput({
        activeExperimentContext: 'Active experiment context for user A.',
        allowSensitiveHealthContext: true,
        channel: 'telegram',
        currentLocalDate: '2026-04-15',
        currentTimeZone: 'Asia/Kuala_Lumpur',
        vaultOverview: 'Vault overview for user A.',
      }),
      cacheInput,
    )
    const promptB = buildAssistantSystemPromptWithCacheMetadata(
      createCommonOpenAiPromptInput({
        activeExperimentContext: 'Active experiment context for user B.',
        allowSensitiveHealthContext: false,
        channel: 'sms',
        currentLocalDate: '2026-04-16',
        currentTimeZone: 'America/Los_Angeles',
        vaultOverview: 'Vault overview for user B.',
      }),
      cacheInput,
    )

    expect(
      firstNChars(
        promptA.prompt,
        promptA.cacheMetadata.dynamicContextStartsAfterStaticCore,
      ),
    ).toEqual(
      firstNChars(
        promptB.prompt,
        promptB.cacheMetadata.dynamicContextStartsAfterStaticCore,
      ),
    )
    expect(promptA.cacheMetadata.dynamicContextStartsAfterStaticCore).toBeGreaterThan(
      8_000,
    )
    expect(promptB.cacheMetadata.dynamicContextStartsAfterStaticCore).toBe(
      promptA.cacheMetadata.dynamicContextStartsAfterStaticCore,
    )
    const stablePrefix = firstNChars(
      promptA.prompt,
      promptA.cacheMetadata.dynamicContextStartsAfterStaticCore,
    )
    const dynamicSuffix = promptA.prompt.slice(
      promptA.cacheMetadata.dynamicContextStartsAfterStaticCore,
    )

    expect(stablePrefix).not.toContain('Asia/Kuala_Lumpur')
    expect(stablePrefix).not.toContain('2026-04-15')
    expect(stablePrefix).not.toContain('Vault overview for user A.')
    expect(stablePrefix).not.toContain('Active experiment context for user A.')
    expect(dynamicSuffix).toContain('The user\'s canonical timezone')
    expect(dynamicSuffix).toContain('Asia/Kuala_Lumpur')
    expect(promptA.cacheMetadata).toMatchInlineSnapshot(`
      {
        "dynamicContextStartsAfterStaticCore": 20526,
        "stableRouteCapabilityPromptHash": "05855168435be53bd844fb343affa0211e2ff92a3762dd95cecd26725c56daec",
        "staticPromptHash": "ee411cd5984a0ea4bd72a58d31446957eb38b809346373bcf9632d381e5802fc",
        "toolSchemaHash": "assistant-tool-schema-common-openai-test",
      }
    `)
    expect(promptB.cacheMetadata.staticPromptHash).toBe(
      promptA.cacheMetadata.staticPromptHash,
    )
    expect(promptB.cacheMetadata.stableRouteCapabilityPromptHash).toBe(
      promptA.cacheMetadata.stableRouteCapabilityPromptHash,
    )
    expect(promptB.cacheMetadata.toolSchemaHash).toBe(
      promptA.cacheMetadata.toolSchemaHash,
    )
  })

  it('keeps the notification decision prefix stable across dynamic turn context', () => {
    const cacheInput = {
      toolSchemaHash: 'assistant-notification-tools-test',
    }
    const promptA = buildAssistantNotificationDecisionSystemPromptWithCacheMetadata(
      createCommonNotificationPromptInput({
        activeExperimentContext: 'Notification active experiment for user A.',
        allowSensitiveHealthContext: true,
        channel: 'telegram',
        currentLocalDate: '2026-04-15',
        currentTimeZone: 'Asia/Kuala_Lumpur',
        vaultOverview: 'Notification vault overview for user A.',
      }),
      cacheInput,
    )
    const promptB = buildAssistantNotificationDecisionSystemPromptWithCacheMetadata(
      createCommonNotificationPromptInput({
        activeExperimentContext: 'Notification active experiment for user B.',
        allowSensitiveHealthContext: false,
        channel: 'sms',
        currentLocalDate: '2026-04-16',
        currentTimeZone: 'America/Los_Angeles',
        vaultOverview: 'Notification vault overview for user B.',
      }),
      cacheInput,
    )

    expect(promptB.cacheMetadata.staticPromptHash).toBe(
      promptA.cacheMetadata.staticPromptHash,
    )
    expect(promptB.cacheMetadata.stableRouteCapabilityPromptHash).toBe(
      promptA.cacheMetadata.stableRouteCapabilityPromptHash,
    )
    expect(promptB.cacheMetadata.dynamicContextStartsAfterStaticCore).toBe(
      promptA.cacheMetadata.dynamicContextStartsAfterStaticCore,
    )
    expect(promptB.cacheMetadata.toolSchemaHash).toBe(
      promptA.cacheMetadata.toolSchemaHash,
    )

    const stablePrefix = firstNChars(
      promptA.prompt,
      promptA.cacheMetadata.dynamicContextStartsAfterStaticCore,
    )
    expect(stablePrefix).toEqual(
      firstNChars(
        promptB.prompt,
        promptB.cacheMetadata.dynamicContextStartsAfterStaticCore,
      ),
    )
    const dynamicSuffix = promptA.prompt.slice(
      promptA.cacheMetadata.dynamicContextStartsAfterStaticCore,
    )

    expect(stablePrefix).not.toContain('Notification execution rules:')
    expect(stablePrefix).not.toContain('Asia/Kuala_Lumpur')
    expect(stablePrefix).not.toContain('Notification vault overview for user A.')
    expect(stablePrefix).not.toContain(
      'Notification active experiment for user A.',
    )
    expect(dynamicSuffix).toContain('Notification execution rules:')
    expect(dynamicSuffix).toContain('Asia/Kuala_Lumpur')
  })
})

describe('assistant experiment onboarding guidance', () => {
  it('points richer experiment setup at the typed apply-onboarding command', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      allowSensitiveHealthContext: true,
      assistantCommandAccessMode: 'bound-tools',
      assistantHealthCommonsAccessMode: 'bound-tools',
      assistantHostedDeviceConnectAvailable: true,
      assistantHostedDeviceConnectProviders: [],
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

    expect(prompt).toContain('vault-cli experiment apply-onboarding <id>')
    expect(prompt).toContain('vault-cli experiment apply-onboarding --schema --format json')
    expect(prompt).toContain('accepted scalar flags')
    expect(prompt).toContain('set up the default/required measurement path first')
    expect(prompt).toContain('Do not ask detailed ROI, color, texture, photo, or imaging fields by default')
    expect(prompt).not.toContain('scaffold and update the experiment record')
  })
})

function createCommonOpenAiPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract for common OpenAI route.',
    allowSensitiveHealthContext: true,
    assistantCommandAccessMode: 'bound-tools',
    assistantHealthCommonsAccessMode: 'bound-tools',
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    assistantKnowledgeToolsAvailable: true,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    vaultOverview: null,
    ...overrides,
  }
}

function createCommonNotificationPromptInput(
  overrides: Partial<AssistantNotificationDecisionSystemPromptInput> = {},
): AssistantNotificationDecisionSystemPromptInput {
  return {
    allowSensitiveHealthContext: true,
    assistantHealthCommonsAccessMode: 'bound-tools',
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    channel: 'telegram',
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    vaultOverview: null,
    ...overrides,
  }
}

function firstNChars(value: string, length: number): string {
  return value.slice(0, length)
}
