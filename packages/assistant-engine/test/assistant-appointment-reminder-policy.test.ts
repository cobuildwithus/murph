import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

function createPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: null,
    assistantHostedAutomationAvailable: true,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantHostedLabsAvailable: false,
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-08-10',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    ...overrides,
  }
}

describe('assistant appointment reminder policy', () => {
  it('routes confirmed private appointments to the scheduling policy', async () => {
    const prompt = buildAssistantSystemPromptLayers(
      createPromptInput(),
    ).stableRouteCapabilityPrompt
    const skill = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'appointment-scheduling',
        'SKILL.md',
      ),
      'utf8',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(prompt).toContain(
      'For a confirmed future care appointment in private, follow `$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md`.',
    )
    expect(normalizedSkill).toContain(
      'a booked or otherwise confirmed future care appointment',
    )
    expect(normalizedSkill).toContain(
      'explicit owning-tool authorization for exactly one private one-shot reminder',
    )
    expect(normalizedSkill).toContain(
      'without separate confirmation unless the user opts out',
    )
    expect(normalizedSkill).toContain('before noon local')
    expect(normalizedSkill).toContain(
      'the prior evening at a known pre-bed reminder time or 8:00 PM',
    )
    expect(normalizedSkill).toContain(
      'For noon or later, schedule 8:00 AM local that day',
    )
    expect(normalizedSkill).toContain(
      'set `createOnly: true`, omit both `automationId` and `slug`',
    )
    expect(normalizedSkill).toContain(
      'include the ordinary tag `appointment-reminder`',
    )
    expect(normalizedSkill).toContain(
      'set `createOnlyEffectKey` to `appointment-reminder:<ordinal>`',
    )
    expect(normalizedSkill).toContain(
      'set `createOnlySourceRef` to the exact opaque `Appointment source ref` beside that accepted input',
    )
    expect(normalizedSkill).toContain(
      "one-based from the appointment's order within that source input",
    )
    expect(normalizedSkill).toContain(
      'either `created: true`, or `created: false` with `replayed: true`',
    )
    expect(normalizedSkill).toContain(
      '`action: "list"` and `exactTag: "appointment-reminder"`',
    )
    expect(normalizedSkill).toContain(
      'repeat the same bounded query once without `exactTag`',
    )
    expect(normalizedSkill).toContain(
      'no reminder was created because replay-safe appointment ownership is unavailable',
    )
    expect(normalizedSkill).toContain(
      'Distinct appointments in one input use distinct ordinals',
    )
    expect(normalizedSkill).toContain(
      'First appointments from separate non-correction inputs use their separate source refs with ordinal one',
    )
    expect(normalizedSkill).toContain(
      'Existing, changed, reordered, or removed appointments keep the original `Appointment source ref`',
    )
    expect(normalizedSkill).toContain(
      'A genuinely new appointment introduced by the edit may use the separate `Correction-added appointment source ref`',
    )
    expect(normalizedSkill).toContain(
      'a replayed save returns unchanged stored state and never counts as applying the correction',
    )
    expect(normalizedSkill).not.toContain('`--create-only`')
    expect(normalizedSkill).toContain(
      'patch that exact owner with the replacement one-shot schedule, current privacy-safe title or summary, and `status: "active"`',
    )
    expect(normalizedSkill).toContain(
      'patch the same exact owner to `status: "archived"`',
    )
    expect(normalizedSkill).toContain(
      'Omit `slug` from every appointment-reminder patch',
    )
    expect(normalizedSkill).toContain(
      'verify the returned automation id, unchanged lookup id for a patch, status, stored schedule, and timing result',
    )
    expect(normalizedSkill).toContain(
      'state the verified local reminder time and say that the member can move or cancel it by replying',
    )
    expect(normalizedSkill).toContain(
      'the reminder was saved but no delivery time was verified',
    )
    expect(normalizedSkill).toContain(
      'distinguish the still-confirmed appointment from the reminder that was not created or changed',
    )
    expect(normalizedSkill).toContain(
      'if zero or multiple plausible owners remain, make no mutation',
    )
    expect(normalizedSkill).toContain(
      'If the result remains truncated',
    )
  })

  it('keeps the automatic reminder policy out of group and unavailable routes', () => {
    const groupPrompt = buildAssistantSystemPromptLayers(
      createPromptInput({ conversationScope: 'group' }),
    ).stableRouteCapabilityPrompt
    const unavailablePrompt = buildAssistantSystemPromptLayers(
      createPromptInput({ assistantHostedAutomationAvailable: false }),
    ).stableRouteCapabilityPrompt

    expect(groupPrompt).not.toContain(
      'For a confirmed future care appointment in private',
    )
    expect(unavailablePrompt).not.toContain(
      'For a confirmed future care appointment in private',
    )
    expect(unavailablePrompt).toContain(
      'Scheduled automation changes are unavailable in this turn.',
    )
    expect(unavailablePrompt).toContain(
      'say concisely that no reminder was created because scheduled reminders are unavailable in the current conversation.',
    )
  })
})
