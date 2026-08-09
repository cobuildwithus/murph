export const GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS = 5 as const

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MAX_STABLE_ID_LENGTH = 80
const MAX_TEXT_LENGTH = 160
const TARGET_PROGRESS_COMPLETE_BASIS_POINTS = 10_000n

export type GroupChallengeComponentStatus =
  | 'available'
  | 'missing'
  | 'not_granted'
  | 'pending'

export type GroupChallengeCoverage = 'complete' | 'partial' | 'unscored'

export interface GroupChallengeScorecardComponent {
  id: string
  label: string
  maxPoints?: number
  perQuantity: number
  points: number
  quantityUnit: string
}

export interface GroupChallengeScorecard {
  components: readonly GroupChallengeScorecardComponent[]
}

export type GroupChallengeObjective =
  | { kind: 'ranking' }
  | { kind: 'target'; targetPoints: number }

export interface GroupChallengeTeam {
  captainParticipantId?: string
  id: string
  name: string
  participantIds: readonly string[]
}

export type GroupChallengeFormat =
  | {
      kind: 'collective'
      objective: Extract<GroupChallengeObjective, { kind: 'target' }>
    }
  | {
      kind: 'individual'
      objective: GroupChallengeObjective
    }
  | {
      aggregation: 'average' | 'sum'
      kind: 'teams'
      objective: GroupChallengeObjective
      teams: readonly GroupChallengeTeam[]
    }

export type GroupChallengeComponentObservation =
  | {
      componentId: string
      quantity: number
      status: 'available'
    }
  | {
      componentId: string
      status: Exclude<GroupChallengeComponentStatus, 'available'>
    }

export interface GroupChallengeParticipantObservation {
  components: readonly GroupChallengeComponentObservation[]
  participantId: string
}

export interface GroupChallengeComponentScore {
  componentId: string
  points: number
  quantity: number | null
  status: GroupChallengeComponentStatus
}

export interface GroupChallengeParticipantScore {
  components: readonly GroupChallengeComponentScore[]
  coverage: GroupChallengeCoverage
  participantId: string
  verifiedPoints: number
}

export interface GroupChallengeCoverageSummary {
  completeParticipants: number
  partialParticipants: number
  totalParticipants: number
  unscoredParticipants: number
}

export interface GroupChallengeObjectiveProgress {
  remainingPoints: number
  targetPoints: number
  targetReached: boolean
  verifiedProgressBasisPoints: number
}

export interface GroupChallengeIndividualScoreboardEntry {
  coverage: GroupChallengeCoverage
  objectiveProgress?: GroupChallengeObjectiveProgress
  participantId: string
  verifiedPoints: number
}

export interface GroupChallengeTeamScoreboardEntry {
  coverage: GroupChallengeCoverageSummary
  name: string
  objectiveProgress?: GroupChallengeObjectiveProgress
  participantIds: readonly string[]
  teamId: string
  verifiedPoints: number | null
  verifiedSubtotalPoints: number
}

export type GroupChallengeScoreboard =
  | {
      coverage: GroupChallengeCoverageSummary
      entries: readonly GroupChallengeIndividualScoreboardEntry[]
      kind: 'individual'
      rankingComplete: boolean
    }
  | {
      coverage: GroupChallengeCoverageSummary
      entries: readonly GroupChallengeTeamScoreboardEntry[]
      kind: 'teams'
      rankingComplete: boolean
    }
  | {
      coverage: GroupChallengeCoverageSummary
      kind: 'collective'
      objectiveProgress: GroupChallengeObjectiveProgress
      verifiedPoints: number
    }

export interface GroupChallengeScoreResult {
  participantScores: readonly GroupChallengeParticipantScore[]
  scoreboard: GroupChallengeScoreboard
}

/**
 * Scores normalized non-negative integer quantities without knowing how the model
 * derived them from consented challenge data. Metric interpretation remains model-
 * owned; this helper owns only validation, exact point arithmetic, coverage, and
 * participant/team/collective aggregation.
 */
export function scoreGroupChallenge(input: {
  format: GroupChallengeFormat
  participants: readonly GroupChallengeParticipantObservation[]
  scorecard: GroupChallengeScorecard
}): GroupChallengeScoreResult {
  const components = validateScorecard(input.scorecard)
  const participantScores = scoreParticipants({
    components,
    participants: input.participants,
  })

  return {
    participantScores,
    scoreboard: buildScoreboard({
      format: input.format,
      participantScores,
    }),
  }
}

function validateScorecard(
  scorecard: GroupChallengeScorecard,
): readonly GroupChallengeScorecardComponent[] {
  if (
    scorecard.components.length < 1
    || scorecard.components.length > GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS
  ) {
    throw new TypeError(
      `Group challenge scorecards require 1-${GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS} components.`,
    )
  }

  const seenIds = new Set<string>()
  return scorecard.components.map((component) => {
    assertStableId(component.id, 'component id')
    if (seenIds.has(component.id)) {
      throw new TypeError(`Duplicate group challenge component id: ${component.id}.`)
    }
    seenIds.add(component.id)
    assertBoundedText(component.label, 'component label')
    assertBoundedText(component.quantityUnit, 'component quantity unit')
    assertPositiveSafeInteger(component.points, 'component points')
    assertPositiveSafeInteger(component.perQuantity, 'component perQuantity')
    if (component.maxPoints !== undefined) {
      assertNonNegativeSafeInteger(component.maxPoints, 'component maxPoints')
    }
    return component
  })
}

function scoreParticipants(input: {
  components: readonly GroupChallengeScorecardComponent[]
  participants: readonly GroupChallengeParticipantObservation[]
}): GroupChallengeParticipantScore[] {
  if (input.participants.length === 0) {
    throw new TypeError('Group challenges require at least one participant.')
  }
  const componentById = new Map(
    input.components.map((component) => [component.id, component] as const),
  )
  const seenParticipantIds = new Set<string>()

  return input.participants.map((participant) => {
    assertOpaqueId(participant.participantId, 'participant id')
    if (seenParticipantIds.has(participant.participantId)) {
      throw new TypeError(
        `Duplicate group challenge participant id: ${participant.participantId}.`,
      )
    }
    seenParticipantIds.add(participant.participantId)

    const observationByComponentId = new Map<
      string,
      GroupChallengeComponentObservation
    >()
    for (const observation of participant.components) {
      if (!componentById.has(observation.componentId)) {
        throw new TypeError(
          `Unknown group challenge component observation: ${observation.componentId}.`,
        )
      }
      if (observationByComponentId.has(observation.componentId)) {
        throw new TypeError(
          `Duplicate group challenge component observation: ${observation.componentId}.`,
        )
      }
      observationByComponentId.set(observation.componentId, observation)
    }

    const componentScores = input.components.map((component) => {
      const observation = observationByComponentId.get(component.id)
      if (!observation) {
        throw new TypeError(
          `Participant ${participant.participantId} is missing an explicit observation for component ${component.id}.`,
        )
      }
      if (observation.status !== 'available') {
        return {
          componentId: component.id,
          points: 0,
          quantity: null,
          status: observation.status,
        } satisfies GroupChallengeComponentScore
      }

      assertNonNegativeSafeInteger(
        observation.quantity,
        `quantity for component ${component.id}`,
      )
      const points = computeComponentPoints(component, observation.quantity)
      return {
        componentId: component.id,
        points,
        quantity: observation.quantity,
        status: observation.status,
      } satisfies GroupChallengeComponentScore
    })

    const availableCount = componentScores.filter(
      (component) => component.status === 'available',
    ).length
    const coverage: GroupChallengeCoverage = availableCount === input.components.length
      ? 'complete'
      : availableCount === 0
        ? 'unscored'
        : 'partial'
    const verifiedPoints = sumSafeIntegers(
      componentScores.map((component) => component.points),
      `participant ${participant.participantId} points`,
    )

    return {
      components: componentScores,
      coverage,
      participantId: participant.participantId,
      verifiedPoints,
    }
  })
}

function computeComponentPoints(
  component: GroupChallengeScorecardComponent,
  quantity: number,
): number {
  const uncapped =
    (BigInt(quantity) * BigInt(component.points)) / BigInt(component.perQuantity)
  const capped = component.maxPoints === undefined
    ? uncapped
    : minBigInt(uncapped, BigInt(component.maxPoints))
  return bigIntToSafeInteger(capped, `points for component ${component.id}`)
}

function buildScoreboard(input: {
  format: GroupChallengeFormat
  participantScores: readonly GroupChallengeParticipantScore[]
}): GroupChallengeScoreboard {
  const coverage = summarizeCoverage(input.participantScores)
  switch (input.format.kind) {
    case 'individual': {
      const entries = input.participantScores
        .map((participant) => ({
          coverage: participant.coverage,
          ...(input.format.objective.kind === 'target'
            ? {
                objectiveProgress: buildObjectiveProgress(
                  participant.verifiedPoints,
                  input.format.objective.targetPoints,
                ),
              }
            : {}),
          participantId: participant.participantId,
          verifiedPoints: participant.verifiedPoints,
        }))
        .sort(compareScoreboardEntries)
      return {
        coverage,
        entries,
        kind: input.format.kind,
        rankingComplete: coverage.completeParticipants === coverage.totalParticipants,
      }
    }
    case 'teams': {
      const entries = buildTeamEntries({
        format: input.format,
        participantScores: input.participantScores,
      })
      return {
        coverage,
        entries,
        kind: input.format.kind,
        rankingComplete: entries.every(
          (entry) => entry.verifiedPoints !== null
            && entry.coverage.completeParticipants === entry.coverage.totalParticipants,
        ),
      }
    }
    case 'collective': {
      const verifiedPoints = sumSafeIntegers(
        input.participantScores.map((participant) => participant.verifiedPoints),
        'collective points',
      )
      return {
        coverage,
        kind: input.format.kind,
        objectiveProgress: buildObjectiveProgress(
          verifiedPoints,
          input.format.objective.targetPoints,
        ),
        verifiedPoints,
      }
    }
  }
}

function buildTeamEntries(input: {
  format: Extract<GroupChallengeFormat, { kind: 'teams' }>
  participantScores: readonly GroupChallengeParticipantScore[]
}): GroupChallengeTeamScoreboardEntry[] {
  if (input.format.teams.length < 2) {
    throw new TypeError('Team challenges require at least two teams.')
  }
  const participantById = new Map(
    input.participantScores.map((participant) => [participant.participantId, participant] as const),
  )
  const seenTeamIds = new Set<string>()
  const assignedParticipantIds = new Set<string>()

  const entries = input.format.teams.map((team) => {
    assertStableId(team.id, 'team id')
    if (seenTeamIds.has(team.id)) {
      throw new TypeError(`Duplicate group challenge team id: ${team.id}.`)
    }
    seenTeamIds.add(team.id)
    assertBoundedText(team.name, 'team name')
    if (team.participantIds.length === 0) {
      throw new TypeError(`Group challenge team ${team.id} has no participants.`)
    }

    const teamParticipants = team.participantIds.map((participantId) => {
      if (assignedParticipantIds.has(participantId)) {
        throw new TypeError(
          `Participant ${participantId} belongs to more than one challenge team.`,
        )
      }
      const participant = participantById.get(participantId)
      if (!participant) {
        throw new TypeError(
          `Challenge team ${team.id} references unknown participant ${participantId}.`,
        )
      }
      assignedParticipantIds.add(participantId)
      return participant
    })

    if (
      team.captainParticipantId !== undefined
      && !team.participantIds.includes(team.captainParticipantId)
    ) {
      throw new TypeError(
        `Challenge team ${team.id} captain must belong to that team.`,
      )
    }

    const coverage = summarizeCoverage(teamParticipants)
    const verifiedSubtotalPoints = sumSafeIntegers(
      teamParticipants.map((participant) => participant.verifiedPoints),
      `team ${team.id} points`,
    )
    const complete = coverage.completeParticipants === coverage.totalParticipants
    const verifiedPoints = input.format.aggregation === 'sum'
      ? verifiedSubtotalPoints
      : complete
        ? divideSafeInteger(
            verifiedSubtotalPoints,
            teamParticipants.length,
            `team ${team.id} average points`,
          )
        : null

    return {
      coverage,
      name: team.name,
      ...(input.format.objective.kind === 'target' && verifiedPoints !== null
        ? {
            objectiveProgress: buildObjectiveProgress(
              verifiedPoints,
              input.format.objective.targetPoints,
            ),
          }
        : {}),
      participantIds: [...team.participantIds],
      teamId: team.id,
      verifiedPoints,
      verifiedSubtotalPoints,
    }
  })

  if (assignedParticipantIds.size !== participantById.size) {
    const unassigned = [...participantById.keys()].filter(
      (participantId) => !assignedParticipantIds.has(participantId),
    )
    throw new TypeError(
      `Team challenge participants must belong to exactly one team; unassigned: ${unassigned.join(', ')}.`,
    )
  }

  return entries.sort((left, right) => {
    if (left.verifiedPoints === null && right.verifiedPoints === null) {
      return left.teamId.localeCompare(right.teamId)
    }
    if (left.verifiedPoints === null) {
      return 1
    }
    if (right.verifiedPoints === null) {
      return -1
    }
    return compareSafeIntegersDescending(left.verifiedPoints, right.verifiedPoints)
      || compareUnscoredLast(
        left.coverage.unscoredParticipants === left.coverage.totalParticipants,
        right.coverage.unscoredParticipants === right.coverage.totalParticipants,
      )
      || left.teamId.localeCompare(right.teamId)
  })
}

function summarizeCoverage(
  participants: readonly GroupChallengeParticipantScore[],
): GroupChallengeCoverageSummary {
  return participants.reduce<GroupChallengeCoverageSummary>(
    (summary, participant) => ({
      completeParticipants: summary.completeParticipants
        + (participant.coverage === 'complete' ? 1 : 0),
      partialParticipants: summary.partialParticipants
        + (participant.coverage === 'partial' ? 1 : 0),
      totalParticipants: summary.totalParticipants + 1,
      unscoredParticipants: summary.unscoredParticipants
        + (participant.coverage === 'unscored' ? 1 : 0),
    }),
    {
      completeParticipants: 0,
      partialParticipants: 0,
      totalParticipants: 0,
      unscoredParticipants: 0,
    },
  )
}

function buildObjectiveProgress(
  verifiedPoints: number,
  targetPoints: number,
): GroupChallengeObjectiveProgress {
  assertPositiveSafeInteger(targetPoints, 'target points')
  const uncappedProgressBasisPoints =
    (BigInt(verifiedPoints) * TARGET_PROGRESS_COMPLETE_BASIS_POINTS)
      / BigInt(targetPoints)
  const verifiedProgressBasisPoints = Number(minBigInt(
    uncappedProgressBasisPoints,
    TARGET_PROGRESS_COMPLETE_BASIS_POINTS,
  ))
  return {
    remainingPoints: Math.max(0, targetPoints - verifiedPoints),
    targetPoints,
    targetReached: verifiedPoints >= targetPoints,
    verifiedProgressBasisPoints,
  }
}

function compareScoreboardEntries(
  left: GroupChallengeIndividualScoreboardEntry,
  right: GroupChallengeIndividualScoreboardEntry,
): number {
  return compareSafeIntegersDescending(left.verifiedPoints, right.verifiedPoints)
    || compareUnscoredLast(
      left.coverage === 'unscored',
      right.coverage === 'unscored',
    )
    || left.participantId.localeCompare(right.participantId)
}

function compareUnscoredLast(
  leftUnscored: boolean,
  rightUnscored: boolean,
): number {
  if (leftUnscored === rightUnscored) {
    return 0
  }
  return leftUnscored ? 1 : -1
}

function compareSafeIntegersDescending(left: number, right: number): number {
  if (left === right) {
    return 0
  }
  return left > right ? -1 : 1
}

function assertStableId(value: string, label: string): void {
  if (value.length > MAX_STABLE_ID_LENGTH || !STABLE_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${label} must be 1-${MAX_STABLE_ID_LENGTH} characters in lowercase kebab-case.`,
    )
  }
}

function assertOpaqueId(value: string, label: string): void {
  if (value.trim() !== value || value.length < 1 || value.length > 200) {
    throw new TypeError(`${label} must be 1-200 trimmed characters.`)
  }
}

function assertBoundedText(value: string, label: string): void {
  if (value.trim() !== value || value.length < 1 || value.length > MAX_TEXT_LENGTH) {
    throw new TypeError(`${label} must be 1-${MAX_TEXT_LENGTH} trimmed characters.`)
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`)
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`)
  }
}

function divideSafeInteger(
  dividend: number,
  divisor: number,
  label: string,
): number {
  assertPositiveSafeInteger(divisor, `${label} divisor`)
  return bigIntToSafeInteger(BigInt(dividend) / BigInt(divisor), label)
}

function sumSafeIntegers(values: readonly number[], label: string): number {
  return bigIntToSafeInteger(
    values.reduce((total, value) => total + BigInt(value), 0n),
    label,
  )
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right
}

function bigIntToSafeInteger(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError(`${label} exceeds the maximum safe integer.`)
  }
  return Number(value)
}
