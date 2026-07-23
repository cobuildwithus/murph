import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(input: {
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
      setupCommand: 'murph',
    },
    currentLocalDate: input.currentLocalDate ?? '2026-07-18',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    scheduledOccurrenceAt: input.scheduledOccurrenceAt,
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

describe('assistant automatic meal capture skill', () => {
  it('registers the skill and routes automatic photo questions to it', () => {
    const matches = ASSISTANT_SKILLS.filter(
      ({ slug }) => slug === 'automatic-meal-capture',
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.triggerHint).toContain('Full Photos permission')
    expect(matches[0]?.triggerHint).toContain('missing or delayed photo imports')
    expect(matches[0]?.triggerHint).toContain('automatic 9pm closeout')
    expect(matches[0]?.triggerHint).toContain('retained-photo privacy cleanup')
    expect(matches[0]?.triggerHint).toContain('without duplicate logging')
    expect(matches[0]?.triggerHint).toContain('Always co-load with food-journal')

    const prompt = buildPrompt()
    expect(prompt).toContain(
      'Automatic meal capture: automatic-meal-capture for the iPhone app, Photos permission, background timing, Meals review, import verification, and photo-only meal enrichment.',
    )
    expect(prompt).toContain(
      'When calorie or macro tracking is explicitly active, always load automatic-meal-capture alongside food-journal on eligible interactive nutrition turns and check recent unresolved device meals; import itself does not start a model turn.',
    )
  })

  it('teaches setup, background limits, import proof, and calorie-aware enrichment', async () => {
    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'automatic-meal-capture',
        'SKILL.md',
      ),
      'utf8',
    )

    expect(skill).toMatch(/^---\nname: automatic-meal-capture\n/)
    expect(skill).toContain('iOS 26.1 or later')
    expect(skill).toContain(
      'https://apps.apple.com/us/app/murph-ai/id6786145859',
    )
    expect(skill).toContain('grant **Full Photos** access')
    expect(skill).toContain('existing photos are never scanned')
    expect(skill).toContain("Uncertain candidates stay in the iPhone's")
    expect(skill).toContain('age out after 14 days')
    expect(skill).toContain('24-item limit')
    expect(skill).toContain('`source: device`')
    expect(skill).toContain('managed daily closeout at 9:00pm')
    expect(skill).toContain(
      'The original capture instant—not upload or import time—owns meal timing.',
    )
    expect(skill).toContain('iOS may delay or skip any background\nopportunity')
    expect(skill).toContain(
      'Automatic capture does not itself require a chat reply and its import does not\nstart a model turn.',
    )
    expect(skill).toContain('next eligible interactive turn')
    expect(skill).toContain('scoped upload\ncredential may require renewal')
    expect(skill).toContain('vault-cli meal list --from <YYYY-MM-DD>')
    expect(skill).toContain('vault-cli meal show <meal-id> --format json')
    expect(skill).toContain(
      'do not request a resend solely from back-to-back\nreads',
    )
    expect(skill).toContain(
      'Suggest resending only after later evidence shows the upload failed.',
    )
    expect(skill).toContain('vault-cli meal edit <meal-id>')
    expect(skill).toContain('## Run the automatic 9pm closeout')
    expect(skill).toContain(
      'engine-supplied `Occurrence local date` from the `Scheduled\n   occurrence context` as the action and latest-capture boundary',
    )
    expect(skill).toContain(
      "even when the\n   wall-clock `Today's date` differs",
    )
    expect(skill).toContain('vault-cli meal remove-photo <meal-id>')
    expect(skill).toContain('vault-cli meal closeout-work')
    expect(skill).toContain('oldest bounded batch')
    expect(skill).not.toContain('preceding 31 local days')
    expect(skill).toContain('label partial totals as partial')
    expect(skill).toContain('each retained photo as pending closeout work')
    expect(skill).toContain('late import gets one dated catch-up')
    expect(skill).toContain('latest `recordedAt` is at or after')
    expect(skill).toContain('partial-cleanup failure loses no meal')
    expect(skill).toContain('Keep it qualitative\n   by default')
    expect(skill).toContain('a delivery prerequisite, not a second automation opt-in')
    expect(skill).toContain('`--nutrition-source label`')
    expect(skill).toContain('`--nutrition-source database`')
    expect(skill).toContain('likely manual,\n   conversation, provider')
    expect(skill).toContain(
      'Do not run `meal add` for a captured photo that already has a meal id.',
    )
    expect(skill).toContain(
      "Treat calorie or macro tracking as active only when the member's request,\ncurrent plan, or durable context makes that focus explicit.",
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md',
    )
  })

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
