import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  challengeStandingsCardV1Bounds,
  IMESSAGE_APP_CARD_URL_PREFIX,
} from '@murphai/contracts'

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
      detail: null,
    },
    {
      label: 'Jon',
      points: 90,
      coverage: 'partial',
      detail: null,
    },
    {
      label: 'Priya',
      points: null,
      coverage: 'unscored',
      detail: null,
    },
  ],
  footer: null,
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
  coverageCounts: {
    completeParticipants: 1,
    partialParticipants: 1,
    totalParticipants: 3,
    unscoredParticipants: 1,
  },
  footer: null,
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
        detail: null,
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
      coverageCounts: {
        completeParticipants: 0,
        partialParticipants: 0,
        totalParticipants: 3,
        unscoredParticipants: 3,
      },
      footer: null,
    }
    expect(renderAssistantResponseCardText(allUnscoredCollective)).toContain(
      'No verified score yet / 1,000 points',
    )
    expect(renderAssistantResponseCardText(allUnscoredCollective)).toContain(
      'Coverage: 0 complete, 0 partial, 3 unscored (3 total).',
    )
    expect(buildLinqIMessageAppLayout(allUnscoredCollective).subcaption).toBe(
      'Waiting for score\nWaiting for shared data.',
    )
  })

  it('renders ranked scores, ties, partial lower bounds, and unscored rows', () => {
    expect(renderAssistantResponseCardText(INDIVIDUAL_CARD)).toBe(
      [
        'Weird Health Week — Day 4 of 7',
        '',
        '— Maya: 120 points',
        '— Jon: 90+ points',
        '— Priya: unscored',
        '',
        'Scores marked + are verified lower bounds.',
        '',
        'Ranks are withheld until every score is complete.',
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
        'More progress may be pending.',
        'Coverage: 1 complete, 1 partial, 1 unscored (3 total).',
        'Verified lower-bound progress.',
      ].join('\n'),
    )

    expect(buildLinqIMessageAppLayout(COLLECTIVE_CARD)).toEqual({
      caption: "Move Atlanta Together — Updated after Friday's check-in",
      subcaption: '640+ / 1,000 pts\nMore progress may be pending.',
      trailing_caption:
        'Coverage · 1 complete · 1 partial · 1 unscored · 3 total',
      trailing_subcaption: 'Verified lower-bound progress.',
    })
  })

  it('builds a truthful static layout for ranked standings', () => {
    expect(buildLinqIMessageAppLayout(INDIVIDUAL_CARD)).toEqual({
      caption: 'Weird Health Week — Day 4 of 7',
      subcaption: '— Maya: 120 points\n— Jon: 90+ points',
      trailing_caption: '— Priya: unscored',
      trailing_subcaption: [
        'Scores marked + are verified lower bounds.',
        'Ranks are withheld until every score is complete.',
      ].join(' · '),
    })
  })

  it('includes target context in ranked static previews', () => {
    expect(buildLinqIMessageAppLayout({
      ...INDIVIDUAL_CARD,
      objective: { kind: 'target', targetPoints: 150 },
    }).subcaption).toBe(
      '— Maya: 120 / 150 points\n— Jon: 90+ / 150 points',
    )
  })

  it('encodes the exact schema-v4 snapshot consumed by iOS', () => {
    const url = encodeChallengeStandingsAppCardUrl(INDIVIDUAL_CARD)
    expect(buildLinqIMessageAppCardUrl(INDIVIDUAL_CARD)).toBe(url)
    expect(url.length).toBeLessThan(2_048)
    expect(decodeAppCardUrl(url)).toEqual({
      schemaVersion: 4,
      card: INDIVIDUAL_CARD,
    })

    const maximumRankedCard: ChallengeStandingsResponseCardV1 = {
      ...INDIVIDUAL_CARD,
      title: 'T'.repeat(challengeStandingsCardV1Bounds.title),
      subtitle: 'S'.repeat(challengeStandingsCardV1Bounds.subtitle),
      entries: Array.from(
        { length: challengeStandingsCardV1Bounds.entries },
        (_, index) => ({
          label: 'L'.repeat(challengeStandingsCardV1Bounds.entryLabel),
          points: challengeStandingsCardV1Bounds.entries - index,
          coverage: 'complete' as const,
          detail: null,
        }),
      ),
      footer: 'F'.repeat(challengeStandingsCardV1Bounds.footer),
    }
    const maximumUrl = encodeChallengeStandingsAppCardUrl(maximumRankedCard)
    expect(maximumUrl.startsWith(IMESSAGE_APP_CARD_URL_PREFIX)).toBe(true)
    expect(maximumUrl.length).toBe(1_945)
    const maximumLayout = buildLinqIMessageAppLayout(maximumRankedCard)
    expect(Object.values(maximumLayout).every((value) => value.length <= 512))
      .toBe(true)
    expect([
      maximumLayout.subcaption,
      maximumLayout.trailing_caption ?? '',
    ].join('\n').split('\n')).toHaveLength(challengeStandingsCardV1Bounds.entries)

    const makeBoundaryCard = (multibyteCharacters: number) => {
      const titleMultibyteCharacters = Math.min(multibyteCharacters, 60)
      const subtitleMultibyteCharacters = Math.max(
        0,
        multibyteCharacters - titleMultibyteCharacters,
      )
      return {
        ...INDIVIDUAL_CARD,
        title: `${'é'.repeat(titleMultibyteCharacters)}${'T'.repeat(
          60 - titleMultibyteCharacters,
        )}`,
        subtitle: `${'é'.repeat(subtitleMultibyteCharacters)}${'S'.repeat(
          120 - subtitleMultibyteCharacters,
        )}`,
        objective: {
          kind: 'target' as const,
          targetPoints: Number.MAX_SAFE_INTEGER,
        },
        entries: Array.from({ length: 8 }, (_, index) => ({
          label: 'L'.repeat(40),
          points: Number.MAX_SAFE_INTEGER - index,
          coverage: 'complete' as const,
          detail: null,
        })),
        footer: 'F'.repeat(120),
      }
    }
    expect(encodeChallengeStandingsAppCardUrl(makeBoundaryCard(85)).length)
      .toBe(2_047)
    expect(() => encodeChallengeStandingsAppCardUrl(makeBoundaryCard(86)))
      .toThrow('inline Messages card limit')
  })
})
