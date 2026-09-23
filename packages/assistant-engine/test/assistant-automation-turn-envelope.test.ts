import { describe, expect, it } from 'vitest'

import { buildAssistantAutomationTurnEnvelope } from '../src/assistant/automation/turn-envelope.ts'

describe('assistant automation turn envelope', () => {
  it('upgrades saved Terra automation targets in turn-scoped input', () => {
    expect(buildAssistantAutomationTurnEnvelope({
      assistantTargetOverride: {
        model: 'gpt-5.6-terra',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
      },
      turnTrigger: 'automation-cron',
    })).toMatchObject({
      assistantTargetOverride: {
        model: 'gpt-6-sol',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
      },
      serviceTier: null,
      turnEnvironment: null,
      turnTrigger: 'automation-cron',
    })
  })

  it('omits empty automation target overrides', () => {
    expect(buildAssistantAutomationTurnEnvelope({
      assistantTargetOverride: {},
      turnTrigger: 'automation-cron',
    })).not.toHaveProperty('assistantTargetOverride')
  })
})
