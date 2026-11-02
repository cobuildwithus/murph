import { readFile } from "node:fs/promises"
import { MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION } from "../src/assistant/managed-automations.ts"
import { describe, expect, it } from 'vitest'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(input: {
  conversationScope?: 'direct' | 'group'
  currentLocalDate?: string
  scheduledOccurrenceAt?: string
} = {}): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'imessage',
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    currentLocalDate: input.currentLocalDate ?? '2026-07-18',
    currentTimeZone: 'America/New_York',
    conversationScope: input.conversationScope ?? 'direct',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    scheduledOccurrenceAt: input.scheduledOccurrenceAt,
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

describe('scheduled meal occurrence date', () => {
  it('keeps a post-midnight retry anchored to its scheduled occurrence date', () => {
    const prompt = buildPrompt({
      currentLocalDate: '2026-07-24',
      scheduledOccurrenceAt: '2026-07-24T01:00:00.000Z',
    })

    expect(prompt).toContain("Today's date for the user is July 24, 2026.")
    expect(prompt).toContain('Occurrence instant: `2026-07-24T01:00:00.000Z`.')
    expect(prompt).toContain('Occurrence timezone: `America/New_York`.')
    expect(prompt).toContain('Occurrence local date: `2026-07-23`.')
    expect(prompt).toContain(
      "Use the local date as the anchor for this automation's relevant action window.",
    )
  })
})

it('keeps closeout review separate from retention and teaches the real thumbnail fallback', async () => {
  const skill = await readFile(new URL('../skills/automatic-meal-capture/SKILL.md', import.meta.url), 'utf8')
  expect(skill).toContain('photo_thumbnail')
  expect(skill).toContain('Full photos expire 90 days after capture')
  expect(skill).toContain('photoReviewedAt')
  expect(skill).not.toContain('replaces retained image bytes with a privacy tombstone')
  expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain('mark their pending photos reviewed')
  expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).not.toContain('remove their retained photos after using them')
})
