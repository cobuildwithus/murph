import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'imessage',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    currentLocalDate: '2026-08-05',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

describe('assistant signup link guidance', () => {
  it('routes explicit shareable-link requests to one small dedicated skill', () => {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'signup-link',
    )
    const lowUsage = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'hosted-low-usage',
    )

    expect(skill?.triggerHint).toContain('explicitly asks')
    expect(skill?.triggerHint).toContain('shareable link')
    expect(buildAssistantSkillFileRef('signup-link')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/signup-link/SKILL.md',
    )
    expect(buildPrompt()).toContain(
      'signup-link (explicit requests)',
    )
    expect(lowUsage?.triggerHint).not.toContain('signup link')
    expect(lowUsage?.triggerHint).not.toContain('invite link')
  })

  it('keeps group introductions as the default and explains reusable automatic qualification', async () => {
    const skill = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'signup-link', 'SKILL.md'),
      'utf8',
    )
    const normalizedSkill = skill.replace(/\s+/gu, ' ')

    expect(normalizedSkill).toContain(
      'The existing group-chat introduction flow remains the default',
    )
    expect(normalizedSkill).toContain(
      'Only when the current member explicitly asks for a signup, invite, referral, or shareable link to forward',
    )
    expect(normalizedSkill).toContain(
      '`action="create_signup_referral_link"`',
    )
    expect(normalizedSkill).toContain(
      'pass the exact accepted `message_ref` from the requester',
    )
    expect(normalizedSkill).toContain(
      "Treat it as the member's reusable referral link",
    )
    expect(normalizedSkill).toContain(
      'do not imply that one recipient consumes it or that the member needs a fresh link for each later recipient',
    )
    expect(normalizedSkill).toContain(
      'Never choose, contact, or message the recipient',
    )
    expect(normalizedSkill).toContain(
      'do not append billing, low-usage, mission, or sponsorship options unless the user also asked about them',
    )
    expect(normalizedSkill).toContain(
      'does not earn usage, complete a mission, or guarantee a reward',
    )
    expect(normalizedSkill).toContain(
      'If a recipient later finishes their own Murph setup through an invite attributed to that link and the referral qualifies under server policy, Murph adds any referral reward automatically',
    )
    expect(normalizedSkill).toContain(
      'Do not promise a fixed reward or amount that the tool did not return',
    )
  })
})
