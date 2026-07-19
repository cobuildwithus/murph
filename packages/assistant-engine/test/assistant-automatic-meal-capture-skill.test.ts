import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
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
    currentLocalDate: '2026-07-18',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
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
})
