import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  challengeStandingsCardV1Bounds,
  IMESSAGE_APP_CARD_URL_PREFIX,
} from '@murphai/contracts'

import {
  challengeStandingsResponseCardJsonSchema,
  challengeStandingsResponseCardV1Schema,
  buildLinqIMessageAppCardImageUrl,
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

function decodeImageAppCardUrl(url: string): {
  schemaVersion: 5
  card: ChallengeStandingsResponseCardV1
} {
  const match = new URL(url).pathname.match(
    /^\/imessage\/card\/v1\/([A-Za-z0-9_-]+)\.png$/u,
  )
  if (match?.[1] === undefined) {
    throw new TypeError('Expected a canonical app card image URL.')
  }
  const envelope: unknown = JSON.parse(
    Buffer.from(match[1], 'base64url').toString('utf8'),
  )
  if (
    typeof envelope !== 'object'
    || envelope === null
    || !('schemaVersion' in envelope)
    || envelope.schemaVersion !== 5
    || !('card' in envelope)
  ) {
    throw new TypeError('Expected a schema-v5 app card image envelope.')
  }
  return {
    schemaVersion: 5,
    card: challengeStandingsResponseCardV1Schema.parse(envelope.card),
  }
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
      image_url: buildLinqIMessageAppCardImageUrl(COLLECTIVE_CARD),
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
      image_url: buildLinqIMessageAppCardImageUrl(INDIVIDUAL_CARD),
    })
  })

  it('keeps native and semantic labels while removing identity from image URLs', () => {
    const identityCard: ChallengeStandingsResponseCardV1 = {
      ...INDIVIDUAL_CARD,
      title: 'Private challenge title',
      subtitle: 'Private challenge subtitle',
      entries: INDIVIDUAL_CARD.entries.map((entry, index) => ({
        ...entry,
        label: `Private participant ${index + 1}`,
      })),
      footer: 'Private challenge footer',
    }
    const teamCard: ChallengeStandingsResponseCardV1 = {
      ...identityCard,
      format: 'teams',
      entries: identityCard.entries.map((entry, index) => ({
        ...entry,
        label: `Private team ${index + 1}`,
      })),
    }
    const collectiveCard: ChallengeStandingsResponseCardV1 = {
      ...COLLECTIVE_CARD,
      title: 'Private collective title',
      subtitle: 'Private collective subtitle',
      footer: 'Private collective footer',
    }

    for (const [card, expectedLabels] of [
      [identityCard, ['Participant 1', 'Participant 2', 'Participant 3']],
      [teamCard, ['Team 1', 'Team 2', 'Team 3']],
      [collectiveCard, null],
    ] as const) {
      const imageEnvelope = decodeImageAppCardUrl(
        buildLinqIMessageAppCardImageUrl(card),
      )
      expect(imageEnvelope.card.title).toBe('Challenge standings')
      expect(imageEnvelope.card.subtitle).toBeNull()
      expect(imageEnvelope.card.footer).toBeNull()
      if (imageEnvelope.card.format === 'collective') {
        expect(expectedLabels).toBeNull()
      } else {
        expect(imageEnvelope.card.entries.map((entry) => entry.label))
          .toEqual(expectedLabels)
      }

      const encodedImage = JSON.stringify(imageEnvelope)
      expect(encodedImage).not.toContain('Private')
      expect(decodeAppCardUrl(encodeChallengeStandingsAppCardUrl(card)))
        .toEqual({ schemaVersion: 5, card })
      expect(Object.values(buildLinqIMessageAppLayout(card)).join('\n'))
        .toContain(card.title)
    }
  })

  it('includes target context in ranked static previews', () => {
    expect(buildLinqIMessageAppLayout({
      ...INDIVIDUAL_CARD,
      objective: { kind: 'target', targetPoints: 150 },
    }).subcaption).toBe(
      '— Maya: 120 / 150 points\n— Jon: 90+ / 150 points',
    )
  })

  it('encodes the exact schema-v5 snapshot consumed by iOS', () => {
    const url = encodeChallengeStandingsAppCardUrl(INDIVIDUAL_CARD)
    expect(buildLinqIMessageAppCardUrl(INDIVIDUAL_CARD)).toBe(url)
    expect(url.length).toBeLessThan(2_048)
    expect(decodeAppCardUrl(url)).toEqual({
      schemaVersion: 5,
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
    const maximumImageUrl = buildLinqIMessageAppCardImageUrl(maximumRankedCard)
    expect(maximumImageUrl).toMatch(
      /^https:\/\/www\.withmurph\.ai\/imessage\/card\/v1\/[A-Za-z0-9_-]+\.png$/u,
    )
    expect(maximumImageUrl.length).toBeLessThan(2_048)
    const maximumLayout = buildLinqIMessageAppLayout(maximumRankedCard)
    const { image_url: _imageUrl, ...semanticLayout } = maximumLayout
    expect(Object.values(semanticLayout).every((value) => value.length <= 512))
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
    const acceptedBoundaryCard = makeBoundaryCard(78)
    expect(encodeChallengeStandingsAppCardUrl(acceptedBoundaryCard).length)
      .toBe(2_037)
    expect(buildLinqIMessageAppCardImageUrl(acceptedBoundaryCard).length)
      .toBeLessThan(2_048)
    expect(() => encodeChallengeStandingsAppCardUrl(makeBoundaryCard(79)))
      .toThrow('static image payload limit')
  })
})
