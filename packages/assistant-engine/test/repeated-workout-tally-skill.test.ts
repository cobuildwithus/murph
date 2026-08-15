import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

async function readSkill(slug: string) {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('repeated workout tally guidance', () => {
  it('requires explicit occurrence logs and separates actual from theoretical totals', async () => {
    const experiment = await readSkill('experiment-onboarding')
    const behavior = await readSkill('behavior-followthrough')
    const strength = await readSkill('strength-training')

    expect(experiment).toContain('more than one expected occurrence per date')
    expect(experiment).toContain('rollup.targetCompletions')
    expect(experiment).toContain('in occurrence units, not day units')
    expect(experiment).toContain('Never multiply elapsed days')
    expect(experiment).toContain('current per-occurrence standard')
    expect(experiment).toContain('progress.adherence.sessionEventIds')
    expect(experiment).toContain('theoretical full-compliance total')
    expect(behavior).toContain('more than one expected occurrence per day')
    expect(strength).toContain('actual cumulative repetition total')
    expect(strength).toContain('theoretical full-compliance total')
  })

  it('resolves a terse multi-set completion from canonical alternating-plan state before writing', async () => {
    const experiment = await readSkill('experiment-onboarding')
    const behavior = await readSkill('behavior-followthrough')
    const strength = await readSkill('strength-training')

    expect(experiment).toContain('resolve the exact canonical plan owner')
    expect(experiment).toContain('current member-local date')
    expect(experiment).toContain('The most recently discussed or logged exercise')
    expect(experiment).toContain('ask one narrow clarification and write nothing')
    expect(experiment).toContain(
      'create exactly one canonical occurrence for each confirmed set',
    )
    expect(experiment).toContain("use the resolved exercise's exact experiment id")
    expect(behavior).toContain(
      'unnamed repeated sets for an alternating or phased strength routine',
    )
    expect(behavior).toContain('never substitute the most recently discussed or logged target')
    expect(behavior).toContain(
      'automations can govern support consent and delivery but are not schedule evidence',
    )
    expect(strength).toContain('resolve the unique exercise, owner, and per-set standard')
    expect(strength).toContain('ask one narrow clarification and do not log a set')
  })

  it('keeps ordinary habit completion and plan-repair authority separate from repeated-set attribution', async () => {
    const behavior = await readSkill('behavior-followthrough')

    expect(behavior).toContain(
      "When the user asks about a current plan, today's target, a ramp, routine, or habit, read the relevant active goal/regimen/automation records before reconstructing details.",
    )
    expect(behavior).toContain(
      'A clarification that only names the current target authorizes only the current completion write',
    )
    expect(behavior).toContain(
      'It does not authorize editing a regimen, experiment, automation, or plan.',
    )
    expect(behavior).toContain(
      'Repair saved plan state only when the user explicitly asks for that repair or affirmatively accepts a concrete proposed repair.',
    )
    expect(behavior).toContain(
      'After an authorized repair, re-read the changed canonical plan before logging any completion.',
    )
  })

  it('advertises completed-set logging on the strength skill discovery surface', () => {
    const strength = ASSISTANT_SKILLS.find((skill) => skill.slug === 'strength-training')
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: 'Synthetic CLI contract.',
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: true,
      channel: 'linq',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2030-01-15',
      currentTimeZone: 'America/Chicago',
      onboardingGuidance: false,
      modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: null,
      assistantContextSnapshotPrompt: null,
    })

    expect(strength?.triggerHint).toContain('logging completed strength sets')
    expect(prompt).toContain(
      'Private repeated-set logging: strength-training owns it and resolves canonical routine context before writes. In groups, hand off to a private Murph conversation without private reads or writes',
    )
  })

  it('documents the fail-closed structured workout replacement guard', async () => {
    const trackedTable = await readSkill('tracked-table')

    expect(trackedTable).toContain(
      'refuses a structured replacement that omits a saved exercise or set',
    )
    expect(trackedTable).toContain('Use `--clear-workout` only')
    expect(trackedTable).toContain('remove the entire record')
  })
})
