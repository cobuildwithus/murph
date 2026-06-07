import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

describe('experiment onboarding skill guidance', () => {
  async function readExperimentOnboardingSkill() {
    const skill = ASSISTANT_SKILLS.find(
      (candidate) => candidate.slug === 'experiment-onboarding',
    )
    expect(skill).toBeTruthy()
    if (!skill) {
      throw new Error('experiment-onboarding skill is not registered')
    }

    return readFile(
      path.join(resolveAssistantSkillsRoot(), skill.slug, 'SKILL.md'),
      'utf8',
    )
  }

  it('requires first-session prep to include a compact walkthrough', async () => {
    const raw = await readExperimentOnboardingSkill()

    expect(raw).toContain(
      'First-session support is not just a time reminder.',
    )
    expect(raw).toContain(
      'give a brief first-session walkthrough in the current reply after creating the run',
    )
    expect(raw).toContain(
      'the one-shot prep automation must instruct the scheduled assistant to give that brief walkthrough at reminder time',
    )
    expect(raw).toContain(
      'Summarize only what the user needs for session one',
    )
    expect(raw).toContain(
      'Do not make the reminder merely say "you have a session" or "I can walk you through it."',
    )
    expect(raw).toContain(
      'This is the user\'s first time doing this experiment. If sending, give a brief first-session walkthrough, not just a reminder.',
    )
    expect(raw).toContain(
      'experimentOnboarding.planDefaults.firstSessionGuidance',
    )
    expect(raw).toContain('Keep it short and do not dump the full protocol.')
  })

  it('requires bounded first-week habit support reminder guidance', async () => {
    const raw = await readExperimentOnboardingSkill()

    expect(raw).toContain(
      'First-session prep and first-week habit support are separate.',
    )
    expect(raw).toContain(
      'first-week habit support is a required reminder decision',
    )
    expect(raw).toContain('first 7 calendar days')
    expect(raw).toContain('first 3-5 planned intervention sessions')
    expect(raw).toContain(
      'Do not create indefinite recurring reminders for first-week support.',
    )
    expect(raw).toContain('Prefer bounded one-shot')
    expect(raw).toContain(
      'experiment-week-one-<experiment-slug>-<YYYY-MM-DD>',
    )
    expect(raw).toContain('first_week_support_status')
    expect(raw).toContain('first_week_support_cadence')
    expect(raw).toContain('first_week_support_window')
    expect(raw).toContain('first_week_support_automation_slugs')
    expect(raw).toContain('first_week_support_blocked_reason')
    expect(raw).toContain(
      '--setup-answer first_week_support_status=scheduled',
    )
    expect(raw).toContain('--setup-answer first_week_support_cadence=daily')
    expect(raw).toContain(
      'Skip sending if the experiment is inactive, the user declined or cancelled reminders',
    )
    expect(raw).toContain(
      'First-week support automation instructions must tell the scheduled assistant this is bounded early habit support',
    )
    expect(raw).toContain(
      'read `vault-cli experiment show <id> --format json`, `vault-cli commons protocol show <key-or-route> --format json`, and `vault-cli experiment progress <id> --as-of <date> --format json` before sending',
    )
  })
})
