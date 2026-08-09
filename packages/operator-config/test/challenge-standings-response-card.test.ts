import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  challengeStandingsResponseCardJsonSchema,
  buildLinqIMessageAppCardUrl,
  buildLinqIMessageAppLayout,
  encodeChallengeStandingsAppCardUrl,
  renderAssistantResponseCardText,
  renderAssistantResponseCardTranscriptText,
  type ChallengeStandingsResponseCardV1,
} from '../src/assistant-response-cards.ts'

const INDIVIDUAL_CARD: ChallengeStandingsResponseCardV1 = {
  kind: 'challenge_standings',
  version: 1,
  format: 'individual',
  title: 'Weird Health Week',
  subtitle: 'Day 4 of 7',
  objective: { kind: 'ranking' },
  entries: [
    {
      label: 'Maya',
      points: 120,
      coverage: 'complete',
      detail: 'Run selfie + 10k steps',
    },
    {
      label: 'Jon',
      points: 90,
      coverage: 'partial',
      detail: 'Verified through yesterday',
    },
    {
      label: 'Priya',
      points: null,
      coverage: 'unscored',
      detail: 'Waiting for shared data',
    },
  ],
  footer: 'Top three shown.',
}

const COLLECTIVE_CARD: ChallengeStandingsResponseCardV1 = {
  kind: 'challenge_standings',
  version: 1,
  format: 'collective',
  title: 'Move Atlanta Together',
  subtitle: "Updated after Friday's check-in",
  objective: { kind: 'target', targetPoints: 1_000 },
  collectivePoints: 640,
  coverage: 'partial',
  footer: '360 points to unlock the lake-day victory lap.',
}

function decodeAppCardUrl(url: string): unknown {
  const encoded = new URL(url).hash.replace(/^#murph-card=/u, '')
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
}

describe('challenge standings response cards', () => {
  it('publishes the closed group model-facing schema', () => {
    expect(challengeStandingsResponseCardJsonSchema.description).toContain(
      'challenge_standings',
    )
    const serializedSchema = JSON.stringify(challengeStandingsResponseCardJsonSchema)
    expect(serializedSchema).toContain('"challenge_standings"')
    expect(serializedSchema).toContain('"collective"')
    expect(serializedSchema).toContain('"targetPoints"')
  })

  it('keeps the group schema challenge-only and truthful for withheld scores', () => {
    const serializedSchema = JSON.stringify(
      challengeStandingsResponseCardJsonSchema,
    )
    expect(serializedSchema).toContain('\"challenge_standings\"')
    expect(serializedSchema).not.toContain('daily_nutrition')
    expect(serializedSchema).not.toContain('compact_table')

    const unscoredTeam: ChallengeStandingsResponseCardV1 = {
      ...INDIVIDUAL_CARD,
      format: 'teams',
      entries: [{
        label: 'North team',
        points: null,
        coverage: 'unscored',
        detail: 'Average withheld until coverage is complete',
      }],
      footer: null,
    }
    expect(renderAssistantResponseCardText(unscoredTeam)).toContain(
      '— North team: unscored',
    )

    const allUnscoredCollective: ChallengeStandingsResponseCardV1 = {
      ...COLLECTIVE_CARD,
      collectivePoints: null,
      coverage: 'unscored',
      footer: null,
    }
    expect(renderAssistantResponseCardText(allUnscoredCollective)).toContain(
      'No verified score yet / 1,000 points',
    )
    expect(buildLinqIMessageAppLayout(allUnscoredCollective).subcaption).toBe(
      'Waiting for score',
    )
  })

  it('renders ranked scores, ties, partial lower bounds, and unscored rows', () => {
    expect(renderAssistantResponseCardText(INDIVIDUAL_CARD)).toBe(
      [
        'Weird Health Week — Day 4 of 7',
        '',
        '1. Maya: 120 points — Run selfie + 10k steps',
        '2. Jon: 90+ points — Verified through yesterday',
        '— Priya: unscored — Waiting for shared data',
        '',
        'Scores marked + are verified lower bounds.',
        '',
        'Top three shown.',
      ].join('\n'),
    )

    expect(renderAssistantResponseCardText({
      ...INDIVIDUAL_CARD,
      entries: [
        INDIVIDUAL_CARD.entries[0]!,
        {
          ...INDIVIDUAL_CARD.entries[0]!,
          label: 'Tied friend',
        },
      ],
      footer: null,
    })).toContain('\n1. Tied friend: 120 points')
    expect(renderAssistantResponseCardTranscriptText(INDIVIDUAL_CARD)).toBe(
      renderAssistantResponseCardText(INDIVIDUAL_CARD),
    )
  })

  it('renders collective progress without inventing an individual loser', () => {
    expect(renderAssistantResponseCardText(COLLECTIVE_CARD)).toBe(
      [
        "Move Atlanta Together — Updated after Friday's check-in",
        '',
        '640+ / 1,000 points',
        '360 points to go.',
        'Verified lower-bound progress.',
        '',
        '360 points to unlock the lake-day victory lap.',
      ].join('\n'),
    )

    expect(buildLinqIMessageAppLayout(COLLECTIVE_CARD)).toEqual({
      caption: 'Move Atlanta Together',
      subcaption: '640+ / 1,000 pts',
      trailing_caption: 'OPEN',
    })
  })

  it('builds a truthful static layout for ranked standings', () => {
    expect(buildLinqIMessageAppLayout(INDIVIDUAL_CARD)).toEqual({
      caption: 'Weird Health Week',
      subcaption: 'Maya · 120 pts',
      trailing_caption: 'OPEN',
    })
  })

  it('includes target context in ranked static previews', () => {
    expect(buildLinqIMessageAppLayout({
      ...INDIVIDUAL_CARD,
      objective: { kind: 'target', targetPoints: 150 },
    }).subcaption).toBe('Maya · 120 / 150 pts')
  })

  it('encodes the exact schema-v4 snapshot consumed by iOS', () => {
    const url = encodeChallengeStandingsAppCardUrl(INDIVIDUAL_CARD)
    expect(buildLinqIMessageAppCardUrl(INDIVIDUAL_CARD)).toBe(url)
    expect(url.length).toBeLessThan(2_048)
    expect(decodeAppCardUrl(url)).toEqual({
      schemaVersion: 4,
      card: INDIVIDUAL_CARD,
    })
  })
})
