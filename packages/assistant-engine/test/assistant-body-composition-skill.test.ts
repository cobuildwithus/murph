import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

const BODY_COMPOSITION_ROOT_MAX_BYTES = 16 * 1024
const REFERENCE_FILES = [
  'fat-loss.md',
  'muscle-gain.md',
  'tracking-and-adjustment.md',
  'safety.md',
  'evidence.md',
] as const

async function readSkillFile(
  skillSlug: string,
  relativePath: string,
): Promise<string> {
  return readFile(
    path.join(
      resolveAssistantSkillsRoot(),
      skillSlug,
      relativePath,
    ),
    'utf8',
  )
}

async function readBodyCompositionFile(relativePath: string): Promise<string> {
  return readSkillFile('body-composition', relativePath)
}

describe('body-composition skill', () => {
  it('keeps one strategy owner and routes detailed paths through references', async () => {
    const relevantSkills = ASSISTANT_SKILLS.filter((skill) =>
      ['body-composition', 'weight-loss', 'weight-gain'].includes(skill.slug),
    )

    expect(relevantSkills.map((skill) => skill.slug)).toEqual([
      'body-composition',
    ])
    expect(relevantSkills[0]?.triggerHint).toContain('fat loss')
    expect(relevantSkills[0]?.triggerHint).toContain('weight gain')
    expect(relevantSkills[0]?.triggerHint).toContain('cutting')
    expect(relevantSkills[0]?.triggerHint).toContain('bulking')
    expect(relevantSkills[0]?.triggerHint).toContain('maintenance')

    const root = await readBodyCompositionFile('SKILL.md')
    expect(Buffer.byteLength(root, 'utf8')).toBeLessThanOrEqual(
      BODY_COMPOSITION_ROOT_MAX_BYTES,
    )
    expect(root).toContain(
      'This is one owner with several paths.',
    )
    expect(root).toContain('Planning is not activation.')
    expect(root).toContain('ask more only when safety requires it')
    expect(root).toContain('protein targets and distribution')
    expect(root).toContain('do not automatically refuse a goal')
    expect(root).toContain('## Owns')
    expect(root).toContain('## Hand Off')
    expect(root).toContain('## Data First')
    expect(root).toContain('## Answer Shape')

    for (const referenceFile of REFERENCE_FILES) {
      expect(root).toContain(`references/${referenceFile}`)
      const reference = await readBodyCompositionFile(
        path.join('references', referenceFile),
      )
      expect(reference.length).toBeGreaterThan(1_000)
    }
  })

  it('keeps fat loss sustainable, strength-supporting, and maintenance-aware', async () => {
    const fatLoss = await readBodyCompositionFile(
      'references/fat-loss.md',
    )

    expect(fatLoss).toContain('There is no universally superior macronutrient split.')
    expect(fatLoss).toContain('resistance training')
    expect(fatLoss).toContain('provisional planning range')
    expect(fatLoss).toContain('Do not promise a linear rate.')
    expect(fatLoss).toContain('A fat-loss plan without a maintenance transition is incomplete.')
    expect(fatLoss).toContain('Do not automatically cut a fixed number of calories.')
    expect(fatLoss).toContain('Use `nutrition-strategy`')
  })

  it('makes resistance training the gate for a conservative bulk', async () => {
    const muscleGain = await readBodyCompositionFile(
      'references/muscle-gain.md',
    )

    expect(muscleGain).toContain('A surplus cannot substitute for a training stimulus.')
    expect(muscleGain).toContain('Maintenance first')
    expect(muscleGain).toContain('Small surplus')
    expect(muscleGain).toContain('It did not establish a universal optimal rate.')
    expect(muscleGain).toContain('Use `nutrition-strategy`')
    expect(muscleGain).toContain('Do not automatically prescribe a “cut” after every bulk.')
  })

  it('keeps protein prescription in nutrition-strategy while retaining evidence traceability', async () => {
    const fatLoss = await readBodyCompositionFile(
      'references/fat-loss.md',
    )
    const muscleGain = await readBodyCompositionFile(
      'references/muscle-gain.md',
    )
    const nutritionStrategy = await readSkillFile(
      'nutrition-strategy',
      'SKILL.md',
    )
    const evidence = await readBodyCompositionFile(
      'references/evidence.md',
    )

    expect(nutritionStrategy).toContain(
      'Protein targets and distribution for generally healthy exercising adults.',
    )
    expect(fatLoss).not.toMatch(/\b\d+(?:\.\d+)?\s*g\/kg\/day\b/u)
    expect(muscleGain).not.toMatch(/\b\d+(?:\.\d+)?\s*g\/kg\/day\b/u)
    expect(evidence).toContain('PMID: [28698222]')
    expect(evidence).toContain(
      '`nutrition-strategy` remains the single owner for protein targets',
    )
  })

  it('requires trend evidence, provenance, consent, and minimum useful tracking', async () => {
    const tracking = await readBodyCompositionFile(
      'references/tracking-and-adjustment.md',
    )

    expect(tracking).toContain('Track only what can change a decision.')
    expect(tracking).toContain('same-condition weight trend')
    expect(tracking).toContain('One reading should almost never trigger')
    expect(tracking).toContain('Label BIA')
    expect(tracking).toContain('Photos are optional and private.')
    expect(tracking).toContain('Never auto-adjust intake or exercise')
    expect(tracking).toContain('aggregate only same-unit values')
    expect(tracking).toContain('docs/body-composition-cli-audit.md')
  })

  it('blocks harmful tactics and routes high-risk populations without using BMI alone', async () => {
    const safety = await readBodyCompositionFile(
      'references/safety.md',
    )

    expect(safety).toContain('Do not use one BMI')
    expect(safety).toContain('rapid weight loss')
    expect(safety).toContain('laxatives')
    expect(safety).toContain('Low Energy Availability and RED-S')
    expect(safety).toContain('Children and Adolescents')
    expect(safety).toContain('Pregnancy, Postpartum, and Breastfeeding')
    expect(safety).toContain('Postpartum and breastfeeding are not the same as pregnancy.')
    expect(safety).toContain('significant unintentional loss or gain')
    expect(safety).toContain('Prohibited Tactics')
  })

  it('keeps numerical defaults labeled and traceable to maintainable evidence', async () => {
    const evidence = await readBodyCompositionFile(
      'references/evidence.md',
    )

    expect(evidence).toContain('Last reviewed: **2026-08-09**')
    expect(evidence).toContain('Practical heuristic')
    expect(evidence).toContain('Product choice')
    expect(evidence).toContain('PMID: [40909191]')
    expect(evidence).toContain('PMID: [28698222]')
    expect(evidence).toContain('PMID: [37914977]')
    expect(evidence).toContain('PMID: [41718193]')
    expect(evidence).toContain('Known Limits')
    expect(evidence).toContain('Maintenance Triggers')
  })
})
