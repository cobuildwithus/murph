import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'

async function readSkill(slug: string): Promise<string> {
  return readFile(
    path.join(resolveAssistantSkillsRoot(), slug, 'SKILL.md'),
    'utf8',
  )
}

describe('assistant group-chat comedy skill', () => {
  it('keeps Murph-originated forfeits funny without making logistics the punishment', async () => {
    const comedy = await readSkill('groupchat-comedy')
    const normalized = comedy.replace(/\s+/gu, ' ')

    expect(normalized).toContain(
      'Treat practicality as a creative quality, not a zero-cost gate.',
    )
    expect(normalized).toContain(
      'A modest purchase or ordinary consumable is fair when it materially creates the bit',
    )
    expect(normalized).toContain(
      'anchor them to a moment already on the calendar',
    )
    expect(normalized).toContain(
      "the loser composes and reads a poem about the winner's historic excellence at steps",
    )
    expect(normalized).toContain(
      'The screenshot should be the performance or the line, not a receipt or a single-use outfit.',
    )
    expect(normalized).toContain(
      "These are reference points, not a fixed menu: invent fresher versions from the group's canon and constraints.",
    )
    expect(normalized).toContain('Judge ideas by their funny-to-hassle ratio.')
    expect(normalized).toContain(
      "Down-rank a cash transfer, paying for the winner's dinner, a single-use costume or prop",
    )
    expect(normalized).toContain(
      'Food or drink stunts can be funny, but the hard limits still apply',
    )
    expect(normalized).toContain(
      "These limits govern Murph's participation and framing, including stakes the group proposes.",
    )
    expect(normalized).toContain(
      'If a consequence crosses the safety or non-coercion limits, do not encourage, arrange, score, or settle it',
    )
    expect(normalized).toContain(
      'offer one equally funny safer remix without lecturing',
    )

    expect(comedy).not.toContain('chug a gallon of milk')
    expect(comedy).not.toContain('cold plunge in a lake')
    expect(comedy).not.toContain('wear a speedo')
    expect(comedy).not.toContain('sit in a Waffle House for 24 hours')
    expect(comedy).not.toContain('eat 74 hot dogs')
  })

  it('keeps challenge kickoff guidance aligned with the comedy owner', async () => {
    const challenge = await readSkill('group-challenge')
    const normalized = challenge.replace(/\s+/gu, ' ')

    expect(normalized).toContain('funny-to-hassle ratio')
    expect(normalized).toContain(
      'do not turn zero-purchase into a rule: a modest purchase can carry a strong bit',
    )
    expect(normalized).toContain('single-use junk')
    expect(normalized).toContain(
      "the group's explicit choice wins when it is safe, opted-in, and within the `groupchat-comedy` hard limits",
    )
    expect(normalized).toContain(
      'settle only safe, opted-in stakes within the `groupchat-comedy` hard limits',
    )
    expect(challenge).not.toContain('polite "harmless" forfeits')
  })
})
