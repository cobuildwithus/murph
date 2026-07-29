import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

async function readSkill(slug: string): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('assistant group challenge scorecard guidance', () => {
  it('routes composite formats through one narrow companion skill', async () => {
    const base = ASSISTANT_SKILLS.find((skill) => skill.slug === 'group-challenge')
    const scorecards = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'group-challenge-scorecards',
    )

    expect(base?.triggerHint).toContain('group-challenge-scorecards')
    expect(scorecards?.triggerHint).toContain('teams')
    expect(scorecards?.triggerHint).toContain('shared or participant target')
    expect(scorecards?.triggerHint).toContain('multiple metrics')
    expect(scorecards?.triggerHint).toContain('weighted additive points')
    expect(scorecards?.triggerHint).toContain('up-to-five-component')
    expect(scorecards?.triggerHint).toContain(
      'group-challenge still owns formation, buy-in, consent, durable state, scheduling, diagnostics, and close-out',
    )
  })

  it('keeps health-data interpretation model-owned and deterministic code narrow', async () => {
    const skill = (await readSkill('group-challenge-scorecards')).replace(/\s+/gu, ' ')

    expect(skill).toContain('The model owns the game; code owns arithmetic')
    expect(skill).toContain('one to five additive components')
    expect(skill).toContain(
      'write an inspectable rule for turning each projection into one non-negative integer quantity',
    )
    expect(skill).toContain(
      'The reusable scorecard helper owns only exact point arithmetic, caps, coverage, and individual/team/collective aggregation',
    )
    expect(skill).toContain(
      'It must not become a health-metric query language.',
    )
    expect(skill).toContain(
      'V1 has no arbitrary code, negative points, multipliers, nested expressions, cross-component bonuses, or hidden formulas.',
    )
  })

  it('preserves truthful partial scoring across formats', async () => {
    const skill = (await readSkill('group-challenge-scorecards')).replace(/\s+/gu, ' ')

    expect(skill).toContain(
      'For team `sum`, a partial team total is a verified subtotal.',
    )
    expect(skill).toContain(
      'For team `average`, do not publish a comparison-safe average until every included participant has complete component coverage',
    )
    expect(skill).toContain(
      'Missing, pending, and not-granted components award no **verified** points yet, but do not become measured zeroes.',
    )
    expect(skill).toContain(
      'available components form a verified lower-bound score',
    )
    expect(skill).toContain(
      'Never manufacture an individual loser or blame one person when the group misses.',
    )
  })

  it('generalizes the referee voice without inventing a loser in cooperative games', async () => {
    const comedy = (await readSkill('groupchat-comedy')).replace(/\s+/gu, ' ')

    expect(comedy).not.toContain('someone actually losing')
    expect(comedy).toContain(
      'A cooperative game can have suspense without inventing an individual loser.',
    )
    expect(comedy).toContain(
      'In a collective game, the group reaches, unlocks, celebrates, gives, or completes something together',
    )
    expect(comedy).toContain(
      'In collective games, never turn the least-active member into the price of missing the target.',
    )
    expect(comedy).toContain('collective mission control and milestone countdowns')
  })

  it('acknowledges the staged five-scope transport migration rather than overclaiming support', async () => {
    const skill = (await readSkill('group-challenge-scorecards')).replace(/\s+/gu, ' ')

    expect(skill).toContain(
      'Until the hosted `read_shared` contract, parser, runtime, and tool schema all move together from three to five',
    )
    expect(skill).toContain(
      'do not configure a live scorecard that exceeds the current runtime\'s accepted number of distinct scopes',
    )
    expect(skill).toContain(
      'Five components may still run when some reuse the same scope.',
    )
  })
})
