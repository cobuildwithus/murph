import { describe, expect, it } from 'vitest'
import { createAssistantModelTarget } from '../src/assistant-backend.ts'
import { parseAssistantSessionRecord } from '../src/assistant-cli-contracts.ts'
import { createHostedAssistantConfig, createHostedAssistantProfile } from '../src/assistant/hosted-config.ts'
import { parseHostedAssistantConfig, prepareHostedAssistantConfigForWrite } from '../src/hosted-assistant-config.ts'

describe('retired stored model compatibility', () => {
  const target = createAssistantModelTarget({ model: 'gpt-6.2-sol', modelProvider: 'openai', reasoningEffort: 'xhigh' })!

  it.each([
    ['gpt-5.6-sol', 'gpt-6.2-sol'],
    ['gpt-6-sol', 'gpt-6.2-sol'],
    ['gpt-6.1-sol', 'gpt-6.2-sol'],
    ['gpt-6-astra', 'gpt-6.2-astra'],
    ['gpt-5.6-luna', 'gpt-6-luna'],
  ])('normalizes a saved %s conversation while preserving reasoning', (savedModel, model) => {
    const result = parseAssistantSessionRecord({
      schema: 'murph.assistant-conversation.v2', conversationId: 'session_synthetic',
      alias: null, binding: { conversationKey: null, channel: 'telegram', identityId: null, actorId: null,
        threadId: 'synthetic-thread', delivery: null, threadIsDirect: true },
      codexTarget: { ...target, model: savedModel }, codexResume: null, createdAt: '2030-01-01T00:00:00Z',
      updatedAt: '2030-01-01T00:00:00Z', lastTurnAt: null, turnCount: 0,
    })
    expect(result.target.model).toBe(model)
    expect(result.providerOptions.model).toBe(model)
    expect(result.target.reasoningEffort).toBe('xhigh')
  })

  it('reads legacy operator profiles and rejects new writes of their old model', () => {
    const config = createHostedAssistantConfig({ profiles: [createHostedAssistantProfile({
      id: 'synthetic-profile', providerConfig: { model: 'gpt-6.2-sol', reasoningEffort: 'high' },
    })] })
    const legacy = { ...config, profiles: config.profiles.map(profile => ({ ...profile,
      target: { ...profile.target, model: 'gpt-5.6-sol' },
    })) }
    expect(parseHostedAssistantConfig(legacy).profiles[0]?.target).toMatchObject({ model: 'gpt-6.2-sol', reasoningEffort: 'high' })
    expect(() => prepareHostedAssistantConfigForWrite(legacy)).toThrow('retired')
    expect(() => createAssistantModelTarget({ model: 'gpt-5.6-sol' })).toThrow('retired')
    expect(() => createAssistantModelTarget({ model: 'gpt-5.6-luna' })).toThrow('use gpt-6-luna')
  })
})
