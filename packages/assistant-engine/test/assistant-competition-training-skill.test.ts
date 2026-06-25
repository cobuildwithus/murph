import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

const skillsRoot = resolveAssistantSkillsRoot()
const skillRoot = path.join(skillsRoot, 'competition-training')
const scenariosFixturePath = new URL(
  './fixtures/competition-training/scenarios.jsonl',
  import.meta.url,
)

async function readSkillFile(relativePath: string): Promise<string> {
  return readFile(path.join(skillRoot, relativePath), 'utf8')
}

async function parseScenarios(): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(scenariosFixturePath, 'utf8')
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('assistant competition-training skill', () => {
  it('registers exactly one bounded competition route', () => {
    const matches = ASSISTANT_SKILLS.filter(
      (skill) => skill.slug === 'competition-training',
    )

    expect(matches).toHaveLength(1)
    expect(matches[0]?.name).toBe('competition-training')
    expect(matches[0]?.triggerHint).toContain('fitness race or competition')
    expect(matches[0]?.triggerHint).toContain('ordinary exercise')
    expect(matches[0]?.triggerHint).toContain('new pain or injury')
  })

  it('keeps the always-loaded prompt outcome-first and bounded', async () => {
    const raw = await readSkillFile('SKILL.md')
    const lineCount = raw.split('\n').length

    expect(raw).toContain('name: competition-training')
    expect(raw).toContain('## Role')
    expect(raw).toContain('## Goal')
    expect(raw).toContain('## Success criteria')
    expect(raw).toContain('## Collaboration rules')
    expect(raw).toContain('## Current-fact retrieval budget')
    expect(raw).toContain('## Output modes')
    expect(raw).toContain('Stop once the user\'s core decision is clear')
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(18_000)
    expect(lineCount).toBeLessThanOrEqual(280)
  })

  it('ships one core, five references, and no template or event catalog', async () => {
    const [rootEntries, references] = await Promise.all([
      readdir(skillRoot),
      readdir(path.join(skillRoot, 'references')),
    ])

    expect(rootEntries.sort()).toEqual(['SKILL.md', 'references'])
    expect(references.sort()).toEqual([
      'demand-overlays.md',
      'evidence-register.md',
      'fueling-recovery-safety.md',
      'performance-psychology.md',
      'planning-kernel.md',
    ])
    expect(rootEntries).not.toContain('evals')
    expect(rootEntries).not.toContain('templates')
    expect(references).not.toContain('event-adapters.md')
  })

  it('resolves every progressive-disclosure reference named by the core', async () => {
    const raw = await readSkillFile('SKILL.md')
    const refs = [...raw.matchAll(/`(references\/[^`]+\.md)`/gu)]
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value))

    expect(new Set(refs).size).toBe(5)
    await Promise.all(
      refs.map(async (relativePath) => {
        const result = await stat(path.join(skillRoot, relativePath))
        expect(result.isFile()).toBe(true)
      }),
    )
  })

  it('uses a stable decision kernel and composable demands', async () => {
    const [core, overlays, planning] = await Promise.all([
      readSkillFile('SKILL.md'),
      readSkillFile('references/demand-overlays.md'),
      readSkillFile('references/planning-kernel.md'),
    ])

    expect(core).toContain(
      '**Event -> goal -> exposure -> limiter -> phase -> plan -> review**',
    )
    expect(core).toContain('**Complete:**')
    expect(core).toContain('**Perform:**')
    expect(core).toContain('**Qualify or podium:**')
    expect(overlays).toContain('## Overlay A: continuous endurance')
    expect(overlays).toContain(
      '## Overlay F: strength, power, or skill dominant',
    )
    expect(overlays).toContain('### Youth or developmental athlete')
    expect(overlays).toContain('### Masters or older athlete')
    expect(overlays).toContain('### Adaptive or para format')
    expect(overlays).toContain('## Add a new overlay only when')
    expect(planning).toContain('## Phase decisions')
    expect(planning).toContain('## Progression')
    expect(planning).toContain('## Taper')
  })

  it('composes with behavior-followthrough instead of recreating it', async () => {
    const [core, psychology, behavior] = await Promise.all([
      readSkillFile('SKILL.md'),
      readSkillFile('references/performance-psychology.md'),
      readFile(path.join(skillsRoot, 'behavior-followthrough', 'SKILL.md'), 'utf8'),
    ])

    expect(core).toContain(
      '`behavior-followthrough` owns anchors, standard/tiny/fallback versions',
    )
    expect(core).toContain(
      'hand the implementation loop to `behavior-followthrough`',
    )
    expect(psychology).toContain('## Ownership boundary')
    expect(psychology).toContain(
      'Hand off their implementation instead of duplicating COM-B',
    )
    expect(psychology).not.toContain('## Setup workflow')
    expect(psychology).not.toContain('## Notification decision policy')
    expect(behavior).toContain(
      'Treat missed behavior as information about the loop, not as a character flaw.',
    )
  })

  it('rejects false precision, workout debt, manipulation, and guarantees', async () => {
    const [core, planning, psychology] = await Promise.all([
      readSkillFile('SKILL.md'),
      readSkillFile('references/planning-kernel.md'),
      readSkillFile('references/performance-psychology.md'),
    ])

    expect(core).toContain('recent tolerated exposure')
    expect(core).toContain('A missed session is information, not debt.')
    expect(core).toContain('acute-to-chronic workload ratio')
    expect(core).toContain('fixed intensity split')
    expect(core).toContain('fixed taper formula')
    expect(core).toContain('no result guarantee')
    expect(planning).toContain('### No universal safety percentage')
    expect(psychology).toContain('## Habit formation without myths')
    expect(psychology).toContain('## Perfectionism guardrails')
    expect(psychology).toContain('## Burnout and overreaching signals')
    expect(core).toContain('Never use shame, streak anxiety, public comparison')
  })

  it('contains energy-availability, hydration, environment, and urgent safety guards', async () => {
    const [core, safety] = await Promise.all([
      readSkillFile('SKILL.md'),
      readSkillFile('references/fueling-recovery-safety.md'),
    ])

    expect(core).toContain('Do not prescribe rapid weight loss')
    expect(core).toContain('dark urine with severe muscle pain/weakness')
    expect(safety).toContain('## Energy availability first')
    expect(safety).toContain('### Possible exercise-associated hyponatremia')
    expect(safety).toContain('### Exertional heat illness')
    expect(safety).toContain('### Open water')
    expect(safety).toContain('## Rhabdomyolysis concern')
    expect(safety).toContain('## Youth and developmental athletes')
    expect(safety).toContain('## Masters and older athletes')
    expect(safety).toContain('## Adaptive and para athletes')
    expect(safety).toContain('## Mental health and exercise compulsion')
  })

  it('ships a broad machine-readable semantic regression corpus', async () => {
    const scenarios = await parseScenarios()
    const ids = scenarios.map((scenario) => scenario.id)
    const categories = new Set(scenarios.map((scenario) => scenario.category))

    expect(scenarios.length).toBeGreaterThanOrEqual(90)
    expect(new Set(ids).size).toBe(scenarios.length)
    for (const requiredCategory of [
      'routing-positive',
      'routing-negative',
      'ux-directness',
      'event-classification',
      'qualification-goal',
      'short-runway',
      'performance-psychology',
      'behavior-handoff',
      'fueling',
      'safety-urgent',
      'current-facts',
      'post-event',
      'developmental-athlete',
      'masters-athlete',
    ]) {
      expect(categories.has(requiredCategory)).toBe(true)
    }

    for (const scenario of scenarios) {
      expect(typeof scenario.id).toBe('string')
      expect(typeof scenario.prompt).toBe('string')
      expect(typeof scenario.expectedRoute).toBe('string')
      expect(Array.isArray(scenario.must)).toBe(true)
      expect(Array.isArray(scenario.mustNot)).toBe(true)
    }
  })

  it('keeps evidence curated and current facts external', async () => {
    const [core, evidence] = await Promise.all([
      readSkillFile('SKILL.md'),
      readSkillFile('references/evidence-register.md'),
    ])
    const urls = new Set(evidence.match(/https?:\/\/[^)\s]+/gu) ?? [])

    expect(urls.size).toBeGreaterThanOrEqual(45)
    expect(evidence).toContain('## Official current event sources')
    expect(evidence).toContain('Remove obsolete, duplicate')
    expect(core).toContain('Start with the named organizer or governing body.')
    expect(core).toContain('Absence of a found rule is not proof')
  })
})
