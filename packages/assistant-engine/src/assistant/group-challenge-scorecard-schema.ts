import * as z from '@murphai/contracts/zod-runtime'

import {
  GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS,
  scoreGroupChallenge,
  type GroupChallengeScoreResult,
} from './group-challenge-scorecard.js'

export type GroupChallengeScoreInput = Parameters<typeof scoreGroupChallenge>[0]

const MAX_GROUP_CHALLENGE_PARTICIPANTS = 32
const MAX_GROUP_CHALLENGE_TEAMS = 16
const MAX_STABLE_ID_LENGTH = 80
const MAX_TEXT_LENGTH = 160
const MAX_OPAQUE_ID_LENGTH = 200

const stableIdSchema = z
  .string()
  .min(1)
  .max(MAX_STABLE_ID_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)

const trimmedTextSchema = (maxLength: number) => z
  .string()
  .min(1)
  .max(maxLength)
  .refine((value) => value.trim() === value, 'Expected trimmed text.')

export const groupChallengeParticipantIdSchema = trimmedTextSchema(
  MAX_OPAQUE_ID_LENGTH,
)
const nonNegativeSafeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
const positiveSafeIntegerSchema = nonNegativeSafeIntegerSchema.min(1)

export const groupChallengeScorecardComponentSchema = z.object({
  id: stableIdSchema,
  label: trimmedTextSchema(MAX_TEXT_LENGTH),
  maxPoints: nonNegativeSafeIntegerSchema.optional(),
  perQuantity: positiveSafeIntegerSchema,
  points: positiveSafeIntegerSchema,
  quantityUnit: trimmedTextSchema(MAX_TEXT_LENGTH),
}).strict()

const rankingObjectiveSchema = z.object({
  kind: z.literal('ranking'),
}).strict()

const targetObjectiveSchema = z.object({
  kind: z.literal('target'),
  targetPoints: positiveSafeIntegerSchema,
}).strict()

const objectiveSchema = z.discriminatedUnion('kind', [
  rankingObjectiveSchema,
  targetObjectiveSchema,
])

const teamSchema = z.object({
  captainParticipantId: groupChallengeParticipantIdSchema.optional(),
  id: stableIdSchema,
  name: trimmedTextSchema(MAX_TEXT_LENGTH),
  participantIds: z
    .array(groupChallengeParticipantIdSchema)
    .min(1)
    .max(MAX_GROUP_CHALLENGE_PARTICIPANTS),
}).strict()

export const groupChallengeFormatSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('collective'),
    objective: targetObjectiveSchema,
  }).strict(),
  z.object({
    kind: z.literal('individual'),
    objective: objectiveSchema,
  }).strict(),
  z.object({
    aggregation: z.enum(['average', 'sum']),
    kind: z.literal('teams'),
    objective: objectiveSchema,
    teams: z.array(teamSchema).min(2).max(MAX_GROUP_CHALLENGE_TEAMS),
  }).strict(),
])

const componentObservationSchema = z.discriminatedUnion('status', [
  z.object({
    componentId: stableIdSchema,
    quantity: nonNegativeSafeIntegerSchema,
    status: z.literal('available'),
  }).strict(),
  z.object({
    componentId: stableIdSchema,
    status: z.enum(['missing', 'not_granted', 'pending']),
  }).strict(),
])

export const groupChallengeParticipantObservationSchema = z.object({
  components: z
    .array(componentObservationSchema)
    .min(1)
    .max(GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS),
  participantId: groupChallengeParticipantIdSchema,
}).strict()

export const groupChallengeParticipantObservationsSchema = z
  .array(groupChallengeParticipantObservationSchema)
  .min(1)
  .max(MAX_GROUP_CHALLENGE_PARTICIPANTS)

export const groupChallengeScorecardSchema = z.object({
  components: z
    .array(groupChallengeScorecardComponentSchema)
    .min(1)
    .max(GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS),
}).strict()

export const groupChallengeScoreInputSchema: z.ZodType<GroupChallengeScoreInput> = z
  .object({
    format: groupChallengeFormatSchema,
    participants: groupChallengeParticipantObservationsSchema,
    scorecard: groupChallengeScorecardSchema,
  })
  .strict()

const coverageSchema = z.enum(['complete', 'partial', 'unscored'])
const componentStatusSchema = z.enum([
  'available',
  'missing',
  'not_granted',
  'pending',
])
const coverageSummarySchema = z.object({
  completeParticipants: nonNegativeSafeIntegerSchema,
  partialParticipants: nonNegativeSafeIntegerSchema,
  totalParticipants: nonNegativeSafeIntegerSchema,
  unscoredParticipants: nonNegativeSafeIntegerSchema,
}).strict()
const objectiveProgressSchema = z.object({
  remainingPoints: nonNegativeSafeIntegerSchema,
  targetPoints: positiveSafeIntegerSchema,
  targetReached: z.boolean(),
  verifiedProgressBasisPoints: nonNegativeSafeIntegerSchema.max(10_000),
}).strict()
const participantScoreSchema = z.object({
  components: z.array(z.object({
    componentId: stableIdSchema,
    points: nonNegativeSafeIntegerSchema,
    quantity: nonNegativeSafeIntegerSchema.nullable(),
    status: componentStatusSchema,
  }).strict()),
  coverage: coverageSchema,
  participantId: groupChallengeParticipantIdSchema,
  verifiedPoints: nonNegativeSafeIntegerSchema,
}).strict()
const individualEntrySchema = z.object({
  coverage: coverageSchema,
  objectiveProgress: objectiveProgressSchema.optional(),
  participantId: groupChallengeParticipantIdSchema,
  verifiedPoints: nonNegativeSafeIntegerSchema,
}).strict()
const teamEntrySchema = z.object({
  coverage: coverageSummarySchema,
  name: trimmedTextSchema(MAX_TEXT_LENGTH),
  objectiveProgress: objectiveProgressSchema.optional(),
  participantIds: z.array(groupChallengeParticipantIdSchema),
  teamId: stableIdSchema,
  verifiedPoints: nonNegativeSafeIntegerSchema.nullable(),
  verifiedSubtotalPoints: nonNegativeSafeIntegerSchema,
}).strict()
const scoreboardSchema = z.discriminatedUnion('kind', [
  z.object({
    coverage: coverageSummarySchema,
    entries: z.array(individualEntrySchema),
    kind: z.literal('individual'),
    rankingComplete: z.boolean(),
  }).strict(),
  z.object({
    coverage: coverageSummarySchema,
    entries: z.array(teamEntrySchema),
    kind: z.literal('teams'),
    rankingComplete: z.boolean(),
  }).strict(),
  z.object({
    coverage: coverageSummarySchema,
    kind: z.literal('collective'),
    objectiveProgress: objectiveProgressSchema,
    verifiedPoints: nonNegativeSafeIntegerSchema,
  }).strict(),
])

export const groupChallengeScoreResultSchema: z.ZodType<GroupChallengeScoreResult> = z
  .object({
    participantScores: z.array(participantScoreSchema),
    scoreboard: scoreboardSchema,
  })
  .strict()

export function scoreGroupChallengeJson(value: unknown): GroupChallengeScoreResult {
  const input = groupChallengeScoreInputSchema.parse(value)
  return groupChallengeScoreResultSchema.parse(scoreGroupChallenge(input))
}
