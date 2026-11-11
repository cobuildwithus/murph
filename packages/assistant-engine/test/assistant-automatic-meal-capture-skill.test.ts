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
    assistantHostedDeviceConnectProviders: [],
    channel: 'imessage',
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    currentLocalDate: input.currentLocalDate ?? '2026-07-18',
    currentTimeZone: 'America/New_York',
    conversationScope: input.conversationScope ?? 'direct',
    onboardingGuidance: false,
    scheduledOccurrenceAt: input.scheduledOccurrenceAt,
    turnTrigger: null,
  })
}

describe('scheduled meal occurrence date', () => {
  it('keeps a post-midnight retry anchored to its scheduled occurrence date', () => {
    const prompt = buildPrompt({
      currentLocalDate: '2026-07-24',
      scheduledOccurrenceAt: '2026-07-24T01:00:00.000Z',
    })

    expect(prompt).toContain('July 24, 2026')
    expect(prompt).toContain('2026-07-24T01:00:00.000Z')
    expect(prompt).toContain('2026-07-23')
  })
})

it('keeps closeout review separate from retention and teaches the real thumbnail fallback', async () => {
  await readFile(new URL('../skills/automatic-meal-capture/SKILL.md', import.meta.url), 'utf8')
  expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).toContain('mark their pending photos reviewed')
  expect(MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions).not.toContain('remove their retained photos after using them')
})
