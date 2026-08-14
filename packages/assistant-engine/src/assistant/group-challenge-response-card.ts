import {
  challengeStandingsResponseCardV1Schema,
  type ChallengeStandingsCoverage,
  type ChallengeStandingsResponseCardV1,
} from '@murphai/contracts'

import {
  scoreGroupChallengeJson,
  type GroupChallengeScoreInput,
} from './group-challenge-scorecard-schema.js'
import type {
  GroupChallengeCoverageSummary,
  GroupChallengeScoreboard,
} from './group-challenge-scorecard.js'
import {
  groupChallengeResponseCardAuthoringInputSchema,
  type GroupChallengeResponseCardAuthoringInput,
} from './group-challenge-response-card-schema.js'

export function buildGroupChallengeResponseCard(
  value: unknown,
): ChallengeStandingsResponseCardV1 {
  const input = groupChallengeResponseCardAuthoringInputSchema.parse(value)
  const result = scoreGroupChallengeJson(input.scoreInput)
  return challengeStandingsResponseCardV1Schema.parse(
    mapScoreboardToCard({
      input,
      scoreboard: result.scoreboard,
    }),
  )
}

function mapScoreboardToCard(input: {
  input: GroupChallengeResponseCardAuthoringInput
  scoreboard: GroupChallengeScoreboard
}): ChallengeStandingsResponseCardV1 {
  const common = {
    footer: input.input.footer,
    kind: 'challenge_standings' as const,
    subtitle: input.input.subtitle,
    title: input.input.title,
    version: 1 as const,
  }

  switch (input.scoreboard.kind) {
    case 'individual': {
      if (input.input.scoreInput.format.kind !== 'individual') {
        throw new TypeError('Expected matching individual challenge input.')
      }
      const labelByParticipantId = readParticipantLabels({
        labels: input.input.participantLabels,
        scoreInput: input.input.scoreInput,
      })
      return {
        ...common,
        entries: input.scoreboard.entries.map((entry) => ({
          coverage: entry.coverage,
          detail: null,
          label: requireParticipantLabel(labelByParticipantId, entry.participantId),
          points: entry.coverage === 'unscored' ? null : entry.verifiedPoints,
        })),
        format: 'individual',
        objective: input.input.scoreInput.format.objective,
      }
    }
    case 'teams': {
      if (input.input.scoreInput.format.kind !== 'teams') {
        throw new TypeError('Expected matching team challenge input.')
      }
      requireNoParticipantLabels(input.input.participantLabels)
      return {
        ...common,
        entries: input.scoreboard.entries.map((entry) => {
          const coverage = entry.verifiedPoints === null
            ? 'unscored'
            : cardCoverageFromSummary(entry.coverage)
          return {
            coverage,
            detail: null,
            label: entry.name,
            points: coverage === 'unscored' ? null : entry.verifiedPoints,
          }
        }),
        format: 'teams',
        objective: input.input.scoreInput.format.objective,
      }
    }
    case 'collective': {
      if (input.input.scoreInput.format.kind !== 'collective') {
        throw new TypeError('Expected matching collective challenge input.')
      }
      requireNoParticipantLabels(input.input.participantLabels)
      const coverage = cardCoverageFromSummary(input.scoreboard.coverage)
      return {
        ...common,
        collectivePoints: coverage === 'unscored'
          ? null
          : input.scoreboard.verifiedPoints,
        coverage,
        coverageCounts: input.scoreboard.coverage,
        format: 'collective',
        objective: input.input.scoreInput.format.objective,
      }
    }
  }
}

function readParticipantLabels(input: {
  labels: readonly { label: string; participantId: string }[]
  scoreInput: GroupChallengeScoreInput
}): ReadonlyMap<string, string> {
  if (input.labels.length !== input.scoreInput.participants.length) {
    throw new TypeError('Expected one room-facing label per participant.')
  }
  const participantIds = new Set(
    input.scoreInput.participants.map((participant) => participant.participantId),
  )
  const labels = new Map<string, string>()
  for (const entry of input.labels) {
    if (
      !participantIds.has(entry.participantId)
      || labels.has(entry.participantId)
    ) {
      throw new TypeError('Expected exactly one label for each scored participant.')
    }
    labels.set(entry.participantId, entry.label)
  }
  return labels
}

function requireParticipantLabel(
  labels: ReadonlyMap<string, string>,
  participantId: string,
): string {
  const label = labels.get(participantId)
  if (!label) {
    throw new TypeError('Expected a room-facing label for every scored participant.')
  }
  return label
}

function requireNoParticipantLabels(
  labels: readonly { label: string; participantId: string }[],
): void {
  if (labels.length > 0) {
    throw new TypeError(
      'Participant labels are accepted only for individual challenge cards.',
    )
  }
}

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
