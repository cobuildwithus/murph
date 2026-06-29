import { describe, expect, it } from 'vitest'

import { buildAssistantAutomationTurnEnvelope } from '../src/assistant/automation/turn-envelope.ts'

describe('assistant automation turn envelope', () => {
  it('projects automation target overrides onto the assistant message input', () => {
    expect(buildAssistantAutomationTurnEnvelope({
      assistantTargetOverride: {
        model: 'gpt-5.5',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
      },
      turnTrigger: 'automation-cron',
    })).toMatchObject({
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      reasoningEffort: 'high',
      serviceTier: null,
      turnEnvironment: null,
      turnTrigger: 'automation-cron',
    })
  })

  it('omits empty automation target overrides', () => {
    expect(buildAssistantAutomationTurnEnvelope({
      assistantTargetOverride: {},
      turnTrigger: 'automation-cron',
    })).not.toHaveProperty('reasoningEffort')
  })
})
