import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

const skillRoot = path.join(resolveAssistantSkillsRoot(), 'running-cardio')

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-06-25',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
  })
}

async function readSkill(relativePath = 'SKILL.md'): Promise<string> {
  return readFile(path.join(skillRoot, relativePath), 'utf8')
}

describe('assistant running cardio skill', () => {
  it('registers a general-cardio route with explicit competition and PT boundaries', () => {
    const skill = ASSISTANT_SKILLS.find(({ slug }) => slug === 'running-cardio')

    expect(skill).toBeDefined()
    expect(skill?.name).toBe('running-cardio')
    expect(skill?.triggerHint).toContain('general running and cardiovascular fitness')
    expect(skill?.triggerHint).toContain('competition-training')
    expect(skill?.triggerHint).toContain('specific benchmark')
    expect(skill?.triggerHint).toContain('physical-therapy')
    expect(skill?.triggerHint).toContain('behavior-followthrough')
  })

  it('surfaces the route and skill path in the system prompt', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'running-cardio: Use for general running and cardiovascular fitness',
    )
    expect(prompt).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/running-cardio/SKILL.md',
    )
  })

  it('keeps exactly four modes and four orthogonal session types', async () => {
    const raw = await readSkill()
    const modeHeadings = raw.match(
      /^### (Start\/restart|Build base|Develop|Support\/maintain)$/gm,
    )
    const sessionTypes = raw.match(
      /^\d\. \*\*(Easy aerobic|Sustained quality|Interval quality|Relaxed speed)\*\*/gm,
    )

    expect(modeHeadings).toHaveLength(4)
    expect(sessionTypes).toHaveLength(4)
    expect(raw).not.toContain('**Easy extension**')
    expect(raw).not.toContain('**Low-impact substitute**')
    expect(raw).not.toContain('**Recovery or off**')
    expect(raw).toContain('modifiers—not additional session types')
  })

  it('protects the maintainable planning grammar instead of a plan catalog', async () => {
    const raw = await readSkill()

    expect(raw).toContain(
      '`owner -> mode -> weekly structure -> session types -> modifiers -> one progression lever -> review`',
    )
    expect(raw).toContain('not a catalog of named plans')
    expect(raw).toContain(
      'Do not add a new mode, session type, state store, or one-off plan',
    )
  })

  it('keeps production prompt size bounded', async () => {
    const main = await readSkill()
    const referenceNames = await readdir(path.join(skillRoot, 'references'))
    const references = await Promise.all(
      referenceNames.map((name) => readSkill(path.join('references', name))),
    )

    expect(main.length).toBeLessThan(18_500)
    expect(references.join('').length).toBeLessThan(32_000)
    expect(main.length + references.join('').length).toBeLessThan(50_000)
  })

  it('loads only three focused operational references', async () => {
    const referenceNames = (
      await readdir(path.join(skillRoot, 'references'))
    ).sort()

    expect(referenceNames).toEqual([
      'intensity-and-modalities.md',
      'programming.md',
      'safety-and-adjustment.md',
    ])

    const main = await readSkill()
    for (const referenceName of referenceNames) {
      expect(main).toContain(`references/${referenceName}`)
      expect((await readSkill(path.join('references', referenceName))).length).toBeGreaterThan(4_000)
    }
  })

  it('does not duplicate the generic adherence engine', async () => {
    const main = await readSkill()
    const referenceNames = await readdir(path.join(skillRoot, 'references'))

    expect(referenceNames).not.toContain('adherence-and-coaching.md')
    expect(main).toContain(
      'Do not duplicate generic anchors, reminders, streaks, repair logic, or support-style machinery.',
    )
    expect(main).toContain('Compose with `behavior-followthrough`')
    expect(main).toContain("fallback is not “one all-out rep.”")
  })


  it('keeps the user surface compact and builds self-regulation', async () => {
    const main = await readSkill()

    expect(main).toContain('use three compact blocks')
    expect(main).toContain('**Recommendation**')
    expect(main).toContain('**This week**')
    expect(main).toContain('**Adjust**')
    expect(main).toContain('The elite outcome is self-regulation')
    expect(main).toContain('less help over time')
  })

  it('uses cardio-specific adherence without fixed habit doctrine', async () => {
    const main = await readSkill()
    const programming = await readSkill('references/programming.md')

    expect(main).toContain('after an isolated miss, resume without debt')
    expect(main).toContain('Do not promise that a routine becomes automatic after a fixed number of days.')
    expect(programming).toContain('An isolated miss usually requires no repair')
    expect(programming).toContain('Do not promise a fixed time to form a habit.')
    expect(programming).toContain('Fade support')
  })

  it('handles Zone 2 as an ambiguous taxonomy rather than an exact watch label', async () => {
    const main = await readSkill()
    const intensity = await readSkill('references/intensity-and-modalities.md')

    expect(main).toContain('Zone labels are not standardized')
    expect(main).toContain('below the first ventilatory/lactate threshold')
    expect(intensity).toContain('These meanings are not interchangeable.')
    expect(intensity).toContain('full-sentence talk test')
    expect(intensity).toContain('supporting evidence, not a verdict')
  })

  it('rejects brittle training and wearable doctrine', async () => {
    const main = await readSkill()

    expect(main).toContain('Do not prescribe a universal weekly percentage increase.')
    expect(main).toContain('no required numerical easy/hard ratio')
    expect(main).toContain('Do not promise that Zone 2 is uniquely necessary')
    expect(main).toContain('wearable readiness scores')
    expect(main).toContain('calorie estimates')
  })

  it('answers the requested horizon while calibrating uncertainty', async () => {
    const main = await readSkill()

    expect(main).toContain('give the requested plan horizon')
    expect(main).toContain('first one or two weeks a calibration phase')
    expect(main).toContain("Do not force every user into a separate short plan")
  })

  it('composes with every adjacent owner without recreating their work', async () => {
    const main = await readSkill()

    for (const slug of [
      'competition-training',
      'physical-therapy',
      'chronic-pain-support',
      'chronic-illness-support',
      'behavior-followthrough',
      'self-management-experiments',
    ]) {
      expect(main).toContain(`\`${slug}\``)
    }

    expect(main).toContain(
      'When another skill leads, do not recreate its assessment or support system here.',
    )
  })
})
