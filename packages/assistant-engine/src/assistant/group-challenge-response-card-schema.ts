import {
  challengeStandingsCardV1Bounds,
} from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'

import {
  groupChallengeFormatSchema,
  groupChallengeParticipantIdSchema,
  groupChallengeParticipantObservationsSchema,
  groupChallengeScorecardComponentSchema,
  groupChallengeScoreInputSchema,
  groupChallengeScoreResultSchema,
} from './group-challenge-scorecard-schema.js'
import {
  GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS,
} from './group-challenge-scorecard.js'

const singleLineCardText = (maxLength: number) => z
  .string()
  .min(1)
  .max(maxLength)
  .refine((value) => value === value.trim(), 'Expected trimmed text.')
  .regex(
    /^[^\u0000-\u001F\u007F\u0085\u2028\u2029\uFEFF\r\n]+$/u,
    'Expected one printable line of text.',
  )

const participantLabelSchema = z.object({
  label: singleLineCardText(challengeStandingsCardV1Bounds.entryLabel),
  participantId: z.string().trim().min(1).max(200),
}).strict()

export const groupChallengeResponseCardAuthoringInputSchema = z.object({
  footer: singleLineCardText(challengeStandingsCardV1Bounds.footer).nullable(),
  participantLabels: z
    .array(participantLabelSchema)
    .max(challengeStandingsCardV1Bounds.participants),
  scoreInput: groupChallengeScoreInputSchema,
  subtitle: singleLineCardText(challengeStandingsCardV1Bounds.subtitle).nullable(),
  title: singleLineCardText(challengeStandingsCardV1Bounds.title),
}).strict()

export type GroupChallengeResponseCardAuthoringInput = z.infer<
  typeof groupChallengeResponseCardAuthoringInputSchema
>

const challengeSlugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)

const projectionScopeKeySchema = z.string().trim().min(1).max(500)

const componentProjectionScopeKeysSchema = z.object({
  componentId: z.string().trim().min(1).max(80),
  projectionScopeKeys: z.array(projectionScopeKeySchema).min(1).max(3),
}).strict()

export const groupChallengeResponseCardToolInputSchema = z.object({
  challengeSlug: challengeSlugSchema,
  participantObservations: groupChallengeParticipantObservationsSchema,
}).strict()

export type GroupChallengeResponseCardToolInput = z.infer<
  typeof groupChallengeResponseCardToolInputSchema
>

export const groupChallengeResponseCardToolInputJsonSchema = (() => {
  const {
    $schema: _dialect,
    ...portableSchema
  } = z.toJSONSchema(groupChallengeResponseCardToolInputSchema)
  return portableSchema
})()

const groupChallengeStandingsSnapshotSchema = z.object({
  componentProjectionScopeKeys: z.array(componentProjectionScopeKeysSchema),
  readProjectionScopeKeyBatches: z
    .array(z.array(projectionScopeKeySchema).min(1).max(3))
    .min(1),
  scoreInput: groupChallengeScoreInputSchema,
  scoreResult: groupChallengeScoreResultSchema,
  rulesRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  version: z.literal(1),
}).strict()

const persistedChallengeComponentSchema = groupChallengeScorecardComponentSchema
  .extend({
    evaluationRule: z.string().trim().min(1).max(2_000),
    projectionScopeKeys: z.array(projectionScopeKeySchema).min(1).max(3),
    settlementMode: z.enum(['daily-additive', 'window-total']),
  })
  .strict()

const persistedChallengeParticipantSchema = z.object({
  participantId: groupChallengeParticipantIdSchema,
  state: z.enum(['declined', 'in', 'pending', 'withdrawn']),
}).strict()

export const groupChallengeDefinitionSchema = z.object({
  format: groupChallengeFormatSchema,
  participants: z.array(persistedChallengeParticipantSchema).min(1).max(32),
  rulesRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  scorecard: z.object({
    components: z
      .array(persistedChallengeComponentSchema)
      .min(1)
      .max(GROUP_CHALLENGE_SCORECARD_MAX_COMPONENTS),
  }).strict(),
  version: z.literal(1),
}).strict().refine(
  (definition) => new Set(
    definition.participants.map((participant) => participant.participantId),
  ).size === definition.participants.length,
  'Challenge definition participant ids must be unique.',
).refine(
  (definition) => definition.scorecard.components.every(
    (component) => new Set(component.projectionScopeKeys).size
      === component.projectionScopeKeys.length,
  ),
  'Challenge definition component scope keys must be unique.',
)

export type GroupChallengeDefinition = z.infer<
  typeof groupChallengeDefinitionSchema
>

const DEFINITION_START = '<!-- murph:group-challenge-definition:v1:start -->'
const DEFINITION_END = '<!-- murph:group-challenge-definition:v1:end -->'

const SNAPSHOT_START = '<!-- murph:challenge-standings-snapshot:v1:start -->'
const SNAPSHOT_END = '<!-- murph:challenge-standings-snapshot:v1:end -->'

export function renderGroupChallengeDefinitionSection(value: unknown): string {
  const definition = groupChallengeDefinitionSchema.parse(value)
  return [
    DEFINITION_START,
    '## Challenge definition',
    '',
    '```json',
    JSON.stringify(definition, null, 2),
    '```',
    DEFINITION_END,
  ].join('\n')
}

export function readGroupChallengeDefinition(body: string): GroupChallengeDefinition {
  const start = body.indexOf(DEFINITION_START)
  const end = body.indexOf(DEFINITION_END)
  if (
    start === -1
    || end < start
    || body.indexOf(DEFINITION_START, start + DEFINITION_START.length) !== -1
    || body.indexOf(DEFINITION_END, end + DEFINITION_END.length) !== -1
  ) {
    throw new TypeError('Expected exactly one complete challenge definition section.')
  }
  const section = body.slice(start + DEFINITION_START.length, end).trim()
  const match = /^## Challenge definition\n\n```json\n([\s\S]+)\n```$/u.exec(section)
  if (!match?.[1]) {
    throw new TypeError('Expected one closed JSON challenge definition block.')
  }
  let value: unknown
  try {
    value = JSON.parse(match[1])
  } catch {
    throw new TypeError('Expected valid JSON in the challenge definition section.')
  }
  return groupChallengeDefinitionSchema.parse(value)
}

export function upsertGroupChallengeStandingsSnapshot(
  body: string,
  value: unknown,
): string {
  const snapshot = groupChallengeStandingsSnapshotSchema.parse(value)
  const section = [
    SNAPSHOT_START,
    '## Current standings snapshot',
    '',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
    SNAPSHOT_END,
  ].join('\n')
  const start = body.indexOf(SNAPSHOT_START)
  const end = body.indexOf(SNAPSHOT_END)
  if (start === -1 && end === -1) {
    return `${body.trimEnd()}\n\n${section}\n`
  }
  if (
    start === -1
    || end < start
    || body.indexOf(SNAPSHOT_START, start + SNAPSHOT_START.length) !== -1
    || body.indexOf(SNAPSHOT_END, end + SNAPSHOT_END.length) !== -1
  ) {
    throw new TypeError('Expected at most one complete challenge snapshot section.')
  }
  const suffix = body.slice(end + SNAPSHOT_END.length).trim()
  return [
    body.slice(0, start).trimEnd(),
    section,
    suffix,
  ].filter((part) => part.length > 0).join('\n\n') + '\n'
}
