import { describe, expect, it } from 'vitest'

import {
  challengeStandingsResponseCardV1Schema,
  type ChallengeStandingsCoverage,
  type ChallengeStandingsResponseCardV1,
} from '@murphai/contracts'

import {
  GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS,
  scoreGroupChallenge,
  type GroupChallengeCoverageSummary,
  type GroupChallengeParticipantObservation,
  type GroupChallengeScorecard,
  type GroupChallengeScoreboard,
} from '../src/assistant/group-challenge-scorecard.js'

const weightedScorecard = {
  components: [
    {
      id: 'steps',
      label: 'Steps',
      perQuantity: 1_000,
      points: 30,
      quantityUnit: 'steps',
    },
    {
      id: 'logged-protein',
      label: 'Logged protein',
      perQuantity: 100,
      points: 1_000,
      quantityUnit: 'grams',
    },
    {
      id: 'late-workouts',
      label: 'Workouts after 9 PM',
      perQuantity: 1,
      points: 100,
      quantityUnit: 'workouts',
    },
  ],
} as const satisfies GroupChallengeScorecard

const weightedParticipants = [
  {
    participantId: 'participant_alpha',
    components: [
      { componentId: 'steps', quantity: 10_000, status: 'available' },
      { componentId: 'logged-protein', quantity: 100, status: 'available' },
      { componentId: 'late-workouts', quantity: 1, status: 'available' },
    ],
  },
  {
    participantId: 'participant_beta',
    components: [
      { componentId: 'steps', quantity: 8_500, status: 'available' },
      { componentId: 'logged-protein', status: 'missing' },
      { componentId: 'late-workouts', quantity: 2, status: 'available' },
    ],
  },
] as const satisfies readonly GroupChallengeParticipantObservation[]

const zeroTieScorecard = {
  components: [{
    id: 'steps',
    label: 'Steps',
    perQuantity: 1,
    points: 1,
    quantityUnit: 'steps',
  }],
} as const satisfies GroupChallengeScorecard

const zeroTieParticipants = [
  {
    participantId: 'participant_alpha_unscored',
    components: [{ componentId: 'steps', status: 'missing' }],
  },
  {
    participantId: 'participant_zulu_zero',
    components: [{ componentId: 'steps', quantity: 0, status: 'available' }],
  },
] as const satisfies readonly GroupChallengeParticipantObservation[]

function cardCoverageFromSummary(
  coverage: GroupChallengeCoverageSummary,
): ChallengeStandingsCoverage {
  if (coverage.completeParticipants === coverage.totalParticipants) {
    return 'complete'
  }
  if (coverage.unscoredParticipants === coverage.totalParticipants) {
    return 'unscored'
  }
  return 'partial'
}

function mapScoreboardToCard(
  scoreboard: GroupChallengeScoreboard,
  participantLabels: ReadonlyMap<string, string> = new Map(),
): ChallengeStandingsResponseCardV1 {
  const common = {
    kind: 'challenge_standings' as const,
    version: 1 as const,
    title: 'Canonical challenge title',
    subtitle: null,
    footer: null,
  }
  switch (scoreboard.kind) {
    case 'individual':
      return {
        ...common,
        format: 'individual',
        objective: { kind: 'ranking' },
        entries: scoreboard.entries.map((entry) => {
          const label = participantLabels.get(entry.participantId)
          if (!label) {
            throw new TypeError('Expected a room-facing participant label.')
          }
          return {
            label,
            points: entry.coverage === 'unscored' ? null : entry.verifiedPoints,
            coverage: entry.coverage,
            detail: null,
          }
        }),
      }
    case 'teams':
      return {
        ...common,
        format: 'teams',
        objective: { kind: 'ranking' },
        entries: scoreboard.entries.map((entry) => {
          const coverage = entry.verifiedPoints === null
            ? 'unscored'
            : cardCoverageFromSummary(entry.coverage)
          return {
            label: entry.name,
            points: coverage === 'unscored' ? null : entry.verifiedPoints,
            coverage,
            detail: null,
          }
        }),
      }
    case 'collective': {
      const coverage = cardCoverageFromSummary(scoreboard.coverage)
      return {
        ...common,
        format: 'collective',
        objective: {
          kind: 'target',
          targetPoints: scoreboard.objectiveProgress.targetPoints,
        },
        collectivePoints: coverage === 'unscored'
          ? null
          : scoreboard.verifiedPoints,
        coverage,
        coverageCounts: scoreboard.coverage,
      }
    }
  }
}

describe('group challenge additive scorecards', () => {
  it('scores model-normalized quantities while keeping missing components explicit', () => {
    const result = scoreGroupChallenge({
      format: { kind: 'individual', objective: { kind: 'ranking' } },
      participants: weightedParticipants,
      scorecard: weightedScorecard,
    })

    expect(result.participantScores).toEqual([
      {
        participantId: 'participant_alpha',
        coverage: 'complete',
        verifiedPoints: 1_400,
        components: [
          { componentId: 'steps', points: 300, quantity: 10_000, status: 'available' },
          { componentId: 'logged-protein', points: 1_000, quantity: 100, status: 'available' },
          { componentId: 'late-workouts', points: 100, quantity: 1, status: 'available' },
        ],
      },
      {
        participantId: 'participant_beta',
        coverage: 'partial',
        verifiedPoints: 455,
        components: [
          { componentId: 'steps', points: 255, quantity: 8_500, status: 'available' },
          { componentId: 'logged-protein', points: 0, quantity: null, status: 'missing' },
          { componentId: 'late-workouts', points: 200, quantity: 2, status: 'available' },
        ],
      },
    ])
    expect(result.scoreboard).toMatchObject({
      kind: 'individual',
      rankingComplete: false,
      coverage: {
        completeParticipants: 1,
        partialParticipants: 1,
        totalParticipants: 2,
        unscoredParticipants: 0,
      },
      entries: [
        { participantId: 'participant_alpha', verifiedPoints: 1_400 },
        { participantId: 'participant_beta', verifiedPoints: 455 },
      ],
    })
  })

  it('orders a verified zero before an unscored zero for a valid standings card', () => {
    const result = scoreGroupChallenge({
      format: { kind: 'individual', objective: { kind: 'ranking' } },
      participants: zeroTieParticipants,
      scorecard: zeroTieScorecard,
    })

    expect(result.scoreboard).toMatchObject({
      kind: 'individual',
      entries: [
        {
          participantId: 'participant_zulu_zero',
          coverage: 'complete',
          verifiedPoints: 0,
        },
        {
          participantId: 'participant_alpha_unscored',
          coverage: 'unscored',
          verifiedPoints: 0,
        },
      ],
    })
    if (result.scoreboard.kind !== 'individual') {
      throw new TypeError('Expected an individual challenge scoreboard.')
    }
    const roomFacingLabels = new Map([
      ['participant_alpha_unscored', 'Alpha'],
      ['participant_zulu_zero', 'Zulu'],
    ])
    const card = mapScoreboardToCard(result.scoreboard, roomFacingLabels)
    expect(challengeStandingsResponseCardV1Schema.parse(card)).toEqual(card)
  })

  it('accepts five components, floors exact integer rates, and applies caps', () => {
    const scorecard = {
      components: Array.from(
        { length: GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS },
        (_, index) => ({
          id: `component-${index + 1}`,
          label: `Component ${index + 1}`,
          ...(index === 0 ? { maxPoints: 7 } : {}),
          perQuantity: 3,
          points: 2,
          quantityUnit: 'units',
        }),
      ),
    } satisfies GroupChallengeScorecard
    const result = scoreGroupChallenge({
      format: { kind: 'individual', objective: { kind: 'ranking' } },
      participants: [
        {
          participantId: 'participant_1',
          components: scorecard.components.map((component) => ({
            componentId: component.id,
            quantity: 12,
            status: 'available' as const,
          })),
        },
      ],
      scorecard,
    })

    expect(result.participantScores[0]?.components.map((component) => component.points))
      .toEqual([7, 8, 8, 8, 8])
    expect(result.participantScores[0]?.verifiedPoints).toBe(39)
  })

  it('applies a point cap before converting an otherwise oversized product', () => {
    const result = scoreGroupChallenge({
      format: { kind: 'individual', objective: { kind: 'ranking' } },
      participants: [
        {
          participantId: 'participant_1',
          components: [{
            componentId: 'bounded',
            quantity: Number.MAX_SAFE_INTEGER,
            status: 'available',
          }],
        },
      ],
      scorecard: {
        components: [{
          id: 'bounded',
          label: 'Bounded',
          maxPoints: 7,
          perQuantity: 1,
          points: Number.MAX_SAFE_INTEGER,
          quantityUnit: 'units',
        }],
      },
    })

    expect(result.participantScores[0]?.verifiedPoints).toBe(7)
  })

  it('caps target progress safely after a participant exceeds the target', () => {
    const result = scoreGroupChallenge({
      format: {
        kind: 'collective',
        objective: { kind: 'target', targetPoints: 1 },
      },
      participants: [
        {
          participantId: 'participant_1',
          components: [{
            componentId: 'large-score',
            quantity: 1,
            status: 'available',
          }],
        },
      ],
      scorecard: {
        components: [{
          id: 'large-score',
          label: 'Large score',
          perQuantity: 1,
          points: Number.MAX_SAFE_INTEGER,
          quantityUnit: 'units',
        }],
      },
    })

    expect(result.scoreboard).toMatchObject({
      kind: 'collective',
      objectiveProgress: {
        remainingPoints: 0,
        targetPoints: 1,
        targetReached: true,
        verifiedProgressBasisPoints: 10_000,
      },
      verifiedPoints: Number.MAX_SAFE_INTEGER,
    })
  })

  it('rejects a sixth component instead of growing an open-ended formula surface', () => {
    const components = Array.from({ length: 6 }, (_, index) => ({
      id: `component-${index + 1}`,
      label: `Component ${index + 1}`,
      perQuantity: 1,
      points: 1,
      quantityUnit: 'units',
    }))

    expect(() => scoreGroupChallenge({
      format: { kind: 'individual', objective: { kind: 'ranking' } },
      participants: [
        {
          participantId: 'participant_1',
          components: components.map((component) => ({
            componentId: component.id,
            quantity: 1,
            status: 'available' as const,
          })),
        },
      ],
      scorecard: { components },
    })).toThrow('require 1-5 components')
  })

  it('rejects unbounded stable ids before they become durable scorecard keys', () => {
    expect(() => scoreGroupChallenge({
      format: { kind: 'individual', objective: { kind: 'ranking' } },
      participants: [
        {
          participantId: 'participant_1',
          components: [{
            componentId: 'a'.repeat(81),
            quantity: 1,
            status: 'available',
          }],
        },
      ],
      scorecard: {
        components: [{
          id: 'a'.repeat(81),
          label: 'Too long',
          perQuantity: 1,
          points: 1,
          quantityUnit: 'units',
        }],
      },
    })).toThrow('1-80 characters in lowercase kebab-case')
  })

  it('reuses participant scores for team sums without hiding partial coverage', () => {
    const result = scoreGroupChallenge({
      format: {
        aggregation: 'sum',
        kind: 'teams',
        objective: { kind: 'ranking' },
        teams: [
          {
            captainParticipantId: 'participant_alpha',
            id: 'north',
            name: 'North',
            participantIds: ['participant_alpha'],
          },
          {
            id: 'south',
            name: 'South',
            participantIds: ['participant_beta'],
          },
        ],
      },
      participants: weightedParticipants,
      scorecard: weightedScorecard,
    })

    expect(result.scoreboard).toMatchObject({
      kind: 'teams',
      rankingComplete: false,
      entries: [
        {
          teamId: 'north',
          verifiedPoints: 1_400,
          verifiedSubtotalPoints: 1_400,
          coverage: { completeParticipants: 1, totalParticipants: 1 },
        },
        {
          teamId: 'south',
          verifiedPoints: 455,
          verifiedSubtotalPoints: 455,
          coverage: { partialParticipants: 1, totalParticipants: 1 },
        },
      ],
    })
  })

  it('orders a verified-zero team before an unscored-zero team', () => {
    const result = scoreGroupChallenge({
      format: {
        aggregation: 'sum',
        kind: 'teams',
        objective: { kind: 'ranking' },
        teams: [
          {
            id: 'alpha-unscored',
            name: 'Alpha unscored',
            participantIds: ['participant_alpha_unscored'],
          },
          {
            id: 'zulu-zero',
            name: 'Zulu zero',
            participantIds: ['participant_zulu_zero'],
          },
        ],
      },
      participants: zeroTieParticipants,
      scorecard: zeroTieScorecard,
    })

    expect(result.scoreboard).toMatchObject({
      kind: 'teams',
      entries: [
        {
          teamId: 'zulu-zero',
          verifiedPoints: 0,
          coverage: { completeParticipants: 1, totalParticipants: 1 },
        },
        {
          teamId: 'alpha-unscored',
          verifiedPoints: 0,
          coverage: { unscoredParticipants: 1, totalParticipants: 1 },
        },
      ],
    })
    if (result.scoreboard.kind !== 'teams') {
      throw new TypeError('Expected a team challenge scoreboard.')
    }
    const card = mapScoreboardToCard(result.scoreboard)
    expect(challengeStandingsResponseCardV1Schema.parse(card)).toEqual(card)
    if (card.format !== 'teams') {
      throw new TypeError('Expected a team challenge card.')
    }
    expect(card.entries).toMatchObject([
      { label: 'Zulu zero', points: 0, coverage: 'complete' },
      { label: 'Alpha unscored', points: null, coverage: 'unscored' },
    ])
  })

  it('withholds an unequal-team average until every included score is complete', () => {
    const result = scoreGroupChallenge({
      format: {
        aggregation: 'average',
        kind: 'teams',
        objective: { kind: 'ranking' },
        teams: [
          { id: 'north', name: 'North', participantIds: ['participant_alpha'] },
          { id: 'south', name: 'South', participantIds: ['participant_beta'] },
        ],
      },
      participants: weightedParticipants,
      scorecard: weightedScorecard,
    })

    expect(result.scoreboard).toMatchObject({
      kind: 'teams',
      rankingComplete: false,
      entries: [
        { teamId: 'north', verifiedPoints: 1_400 },
        { teamId: 'south', verifiedPoints: null, verifiedSubtotalPoints: 455 },
      ],
    })
    const card = mapScoreboardToCard(result.scoreboard)
    expect(challengeStandingsResponseCardV1Schema.parse(card)).toEqual(card)
    if (card.format !== 'teams') {
      throw new TypeError('Expected a team challenge card.')
    }
    expect(card.entries[1]).toMatchObject({
      label: 'South',
      points: null,
      coverage: 'unscored',
    })
  })

  it('turns the same participant scores into conservative collective target progress', () => {
    const result = scoreGroupChallenge({
      format: {
        kind: 'collective',
        objective: { kind: 'target', targetPoints: 2_000 },
      },
      participants: weightedParticipants,
      scorecard: weightedScorecard,
    })

    expect(result.scoreboard).toEqual({
      coverage: {
        completeParticipants: 1,
        partialParticipants: 1,
        totalParticipants: 2,
        unscoredParticipants: 0,
      },
      kind: 'collective',
      objectiveProgress: {
        remainingPoints: 145,
        targetPoints: 2_000,
        targetReached: false,
        verifiedProgressBasisPoints: 9_275,
      },
      verifiedPoints: 1_855,
    })
    if (result.scoreboard.kind !== 'collective') {
      throw new TypeError('Expected a collective challenge scoreboard.')
    }
    const card = mapScoreboardToCard(result.scoreboard)
    expect(challengeStandingsResponseCardV1Schema.parse(card)).toEqual(card)

    const unscored = scoreGroupChallenge({
      format: {
        kind: 'collective',
        objective: { kind: 'target', targetPoints: 2_000 },
      },
      participants: zeroTieParticipants.map((participant) => ({
        ...participant,
        components: [{ componentId: 'steps', status: 'missing' as const }],
      })),
      scorecard: zeroTieScorecard,
    })
    const unscoredCard = mapScoreboardToCard(unscored.scoreboard)
    expect(challengeStandingsResponseCardV1Schema.parse(unscoredCard)).toEqual(
      unscoredCard,
    )
    expect(unscoredCard).toMatchObject({
      collectivePoints: null,
      coverage: 'unscored',
      coverageCounts: {
        completeParticipants: 0,
        partialParticipants: 0,
        totalParticipants: 2,
        unscoredParticipants: 2,
      },
    })
  })
})
