import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'telegram',
    cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
    currentLocalDate: '2026-06-25',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

async function readSkill(): Promise<string> {
  return readFile(
    path.join(
      resolveAssistantSkillsRoot(),
      'sleep-recovery-readiness',
      'SKILL.md',
    ),
    'utf8',
  )
}

describe('assistant sleep recovery readiness skill', () => {
  it('routes sleep, readiness, deload, irregular-schedule, and wearable turns', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'sleep-recovery-readiness: Use for sleep, recovery, or readiness questions',
    )
    expect(prompt).toContain('whether to train hard, modify, rest, or deload')
    expect(prompt).toContain('naps, shift work, travel or jet lag')
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/sleep-recovery-readiness/SKILL.md',
    )
    expect(prompt).toContain(
      'Use `sleep-recovery-readiness` when sleep, fatigue, soreness, low motivation, recovery/readiness, deloading, naps, shift work, travel/jet lag, or wearable recovery trends should decide whether to train as planned, modify, recover, rest, or seek care.',
    )
  })

  it('keeps one compact decision layer instead of a parallel recovery system', async () => {
    const skill = await readSkill()

    expect(skill).toContain(
      'Do not create a readiness score, point system, mandatory questionnaire, sleep store, recovery engine, protocol catalog, streak, or CLI family.',
    )
    expect(skill).toContain(
      'Do not use a signal count or point total. Judge magnitude, persistence, context, and consequence.',
    )
    expect(skill).not.toMatch(/two or more[^\n]*signals?/i)
    expect(skill).toContain(
      'Ask at most one decision-changing question before recommending',
    )
    expect(skill).toContain(
      'The active strength, cardio, or competition skill owns exact exercise selection',
    )
    expect(skill).toContain(
      "Produce one integrated answer; do not make the user coordinate Murph's internal skills.",
    )
  })

  it('handles uncertainty with reversible decisions rather than thresholds', async () => {
    const skill = await readSkill()

    expect(skill).toContain('leave ordinary variation alone')
    expect(skill).toContain('sleepiness (could doze) or fatigue')
    expect(skill).toContain(
      'does not test every vigilance or judgment deficit and cannot clear dangerous drowsiness',
    )
    expect(skill).toContain('when movement is useful and wanted')
    expect(skill).toContain(
      'Allow a wake-up margin before driving, precision work, or another safety-critical task.',
    )
    expect(skill).toContain(
      'mistimed light can shift the clock the wrong way',
    )
    expect(skill).toContain(
      'Personal baseline helps interpret change; it does not prove that chronic short sleep or persistent sleepiness is healthy.',
    )
    expect(skill).toContain(
      'Treat common exposures as hypotheses, not moral rules',
    )
    expect(skill).toContain('do not impose one universal cutoff')
  })

  it('uses personal trends without treating wearables as an oracle', async () => {
    const skill = await readSkill()

    expect(skill).toContain(
      'Treat the device as a measurement layer, not the decision owner',
    )
    expect(skill).toContain(
      'A green score never overrides clear symptoms or unsafe function. A red score alone does not mandate rest.',
    )
    expect(skill).toContain(
      'Do not directly compare HRV values across people, devices, or measurement methods.',
    )
    expect(skill).toContain(
      'Sleep stages and proprietary composites are supporting, lower-confidence evidence',
    )
  })

  it('keeps behavior, training, and clinical boundaries explicit', async () => {
    const skill = await readSkill()

    expect(skill).toContain('Use `behavior-followthrough`')
    expect(skill).toContain(
      'Sleep hygiene alone is not a complete treatment for chronic insomnia.',
    )
    expect(skill).toContain(
      'Do not diagnose sleep apnea, insomnia, overtraining syndrome, or another disorder from chat',
    )
    expect(skill).toContain(
      'stop driving, operating machinery, swimming alone, working at heights',
    )
    expect(skill).toContain('thoughts of self-harm, or inability to stay safe')
  })

  it('exposes exactly the five reusable modes', async () => {
    const skill = await readSkill()
    const headings = skill.match(/^### \d+\.[^\n]+$/gm) ?? []

    expect(headings).toEqual([
      '### 1. Acute readiness check',
      '### 2. Sleep routine improvement',
      '### 3. Deload or recovery-block decision',
      '### 4. Wearable trend interpretation',
      '### 5. Care-navigation escalation',
    ])
  })
})
