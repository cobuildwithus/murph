import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

function createPromptInput(
  conversationScope: 'direct' | 'group',
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope,
    currentLocalDate: '2026-08-11',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
  }
}

describe('assistant response-card defaults', () => {
  it('defaults every verified private meal and live-workout update to its eligible card', () => {
    const directPrompt = buildAssistantSystemPrompt(createPromptInput('direct'))
    const groupPrompt = buildAssistantSystemPrompt(createPromptInput('group'))

    expect(directPrompt).toContain(
      'Private cards: verified meal/live-workout updates use the allowed card alone; meal intent never sets targets.',
    )
    expect(directPrompt).not.toContain('routine logs stay concise')
    expect((directPrompt.match(/Private cards:/gu) ?? [])).toHaveLength(1)
    expect(groupPrompt).not.toContain('Private cards:')
  })

  it('routes compact and saved seven-day wearable views through one trusted card', () => {
    const disabledPrompt = buildAssistantSystemPrompt(createPromptInput('direct'))
    const directPrompt = buildAssistantSystemPrompt({
      ...createPromptInput('direct'),
      assistantWearableTrendCardsAvailable: true,
    })
    const groupPrompt = buildAssistantSystemPrompt(createPromptInput('group'))

    expect(disabledPrompt).not.toContain('murph.attach_wearable_trend_card')
    expect(disabledPrompt).not.toContain('wearables view show')

    for (const required of [
      'call it exactly once, not an acknowledgment',
      'card is the whole reply (no text/media)',
      'only ordered `metricKeys`, no display data',
      'Apple HealthKit=`hrv-sdnn`',
      'Oura/WHOOP/Garmin recovery=`hrv-rmssd`',
      'Never mix; ask only if multiple current methods remain ambiguous',
      '`vault-cli wearables view show <id-or-name> --format json`',
      'then only exact `savedViewId`',
      'manage views via `vault-cli wearables view ...`',
      'Saving a view does not schedule or alter the managed digest',
      'Explicit recurrence only',
      'instructions call `murph.attach_wearable_trend_card` once with only exact `savedViewId`',
      '`{"entityKind":"health_view","entityId":<savedViewId>}`',
      'missing/deleted views skip/fail, never recreate',
    ]) {
      expect(directPrompt).toContain(required)
    }
    expect(
      directPrompt.match(/murph\.attach_wearable_trend_card/gu) ?? [],
    ).toHaveLength(2)
    expect(groupPrompt).not.toContain('murph.attach_wearable_trend_card')
    expect(groupPrompt).not.toContain('wearables view show')
  })
})
