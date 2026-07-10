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
  it('routes only readiness and recovery-block decisions to the umbrella skill', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'Sleep/readiness: sleep-improvement, circadian-rhythm, sleep-recovery-readiness, hrv-resting-heart-rate, energy-fatigue.',
    )
    expect(prompt).toContain(
      'sleep-improvement owns sleep mechanics; circadian-rhythm clock timing; sleep-recovery-readiness an acute train/modify/rest decision; hrv-resting-heart-rate marker interpretation; energy-fatigue persistent fatigue.',
    )
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/<slug>/SKILL.md')
    expect(prompt).not.toContain('Use when the user needs an acute readiness decision')
  })

  it('keeps one compact decision layer instead of a parallel sleep system', async () => {
    const skill = await readSkill()

    expect(skill).toContain('Use this as Murph operating guidance')
    expect(skill).toContain(
      'It is not a parallel sleep coach, circadian coach, wearable-metric interpreter, or fatigue workup.',
    )
    expect(skill).toContain(
      'Do not create a readiness score, point system, mandatory questionnaire, sleep store, recovery engine, protocol catalog, streak, or CLI family.',
    )
    expect(skill).toContain(
      'Do not use a signal count or point total. Judge magnitude, persistence, context, and consequence.',
    )
    expect(skill).toContain('Ask at most one question per message')
    expect(skill).toContain(
      "Compose with the owning skill in one user-facing answer. Do not make the user coordinate Murph's internal handoffs.",
    )
    expect(skill).not.toMatch(/two or more[^\n]*signals?/i)
    expect(skill).not.toContain('### 2. Sleep routine improvement')
    expect(skill).not.toContain('### 4. Wearable trend interpretation')
  })

  it('hands sleep, circadian, HRV/RHR, and persistent fatigue ownership to focused skills', async () => {
    const skill = await readSkill()

    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/sleep-improvement/SKILL.md',
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/circadian-rhythm/SKILL.md',
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/hrv-resting-heart-rate/SKILL.md',
    )
    expect(skill).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/energy-fatigue/SKILL.md',
    )
    expect(skill).toContain(
      'When the user\'s main question is what the HRV/RHR, sleep-stage, sleep-score, or circadian signal means, hand off to the focused owner before recommending.',
    )
  })

  it('handles uncertainty with reversible decisions rather than thresholds', async () => {
    const skill = await readSkill()

    expect(skill).toContain(
      'A single short or disrupted night raises uncertainty; it does not automatically cancel every session.',
    )
    expect(skill).toContain('sleepiness that could cause dozing or fatigue without dozing')
    expect(skill).toContain(
      'does not test every vigilance or judgment deficit and cannot clear dangerous drowsiness',
    )
    expect(skill).toContain('When the user is otherwise well and the activity can be safely probed')
    expect(skill).toContain('Low motivation alone is weak evidence.')
  })

  it('uses personal wearable context without treating wearables as an oracle', async () => {
    const skill = await readSkill()

    expect(skill).toContain(
      'Wearable data can inform a readiness call, but it does not own it.',
    )
    expect(skill).toContain(
      'A green score never overrides clear symptoms or unsafe function.',
    )
    expect(skill).toContain('A red score alone does not mandate rest.')
    expect(skill).toContain(
      'Do not directly compare HRV values across people, devices, or measurement methods.',
    )
    expect(skill).toContain(
      'Treat sleep stages and proprietary composites as supporting, lower-confidence evidence.',
    )
  })

  it('keeps behavior, training, and clinical boundaries explicit', async () => {
    const skill = await readSkill()

    expect(skill).toContain('Use `behavior-followthrough`')
    expect(skill).toContain(
      'The active training skill owns the exact program.',
    )
    expect(skill).toContain(
      'Do not diagnose sleep apnea, insomnia, overtraining syndrome, or another disorder from chat',
    )
    expect(skill).toContain(
      'stop driving, operating machinery, swimming alone, working at heights',
    )
    expect(skill).toContain('thoughts of self-harm, or inability to stay safe')
  })

  it('exposes only the focused readiness modes', async () => {
    const skill = await readSkill()
    const headings = skill.match(/^### \d+\.[^\n]+$/gm) ?? []

    expect(headings).toEqual([
      '### 1. Acute training readiness',
      '### 2. Accumulated fatigue or deload',
      '### 3. Safety or care escalation',
    ])
  })
})
