import { describe, expect, it } from 'vitest'

import { buildAssistantAutomationTurnEnvelope } from '../src/assistant/automation/turn-envelope.ts'

describe('assistant automation turn envelope', () => {
  it('carries automation target overrides as turn-scoped input', () => {
    expect(buildAssistantAutomationTurnEnvelope({
      assistantTargetOverride: {
        model: 'gpt-5.6-terra',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
      },
      turnTrigger: 'automation-cron',
    })).toMatchObject({
      assistantTargetOverride: {
        model: 'gpt-5.6-terra',
        modelProvider: 'vercel-ai-gateway',
        reasoningEffort: 'high',
      },
      executionContext: { hosted: null },
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

  it('preserves a hosted execution context', () => {
    const executionContext = {
      hosted: {
        memberId: 'member-1',
        userEnvKeys: [],
      },
    }
    expect(buildAssistantAutomationTurnEnvelope({
      executionContext,
      turnTrigger: 'automation-cron',
    }).executionContext).toBe(executionContext)
  })
})
