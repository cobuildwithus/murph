import {
  challengeStandingsCardV1Bounds,
} from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'

import {
  groupChallengeScoreInputSchema,
  groupChallengeScoreResultSchema,
} from './group-challenge-scorecard-schema.js'

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
  componentProjectionScopeKeys: z
    .array(componentProjectionScopeKeysSchema)
    .min(1)
    .max(5),
  scoreInput: groupChallengeScoreInputSchema,
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
  version: z.literal(1),
}).strict()

const SNAPSHOT_START = '<!-- murph:challenge-standings-snapshot:v1:start -->'
const SNAPSHOT_END = '<!-- murph:challenge-standings-snapshot:v1:end -->'

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
