import {
  challengeStandingsCardV1Bounds,
} from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'

import {
  groupChallengeScoreInputSchema,
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

export const groupChallengeResponseCardAuthoringJsonSchema = (() => {
  const {
    $schema: _dialect,
    ...portableSchema
  } = z.toJSONSchema(groupChallengeResponseCardAuthoringInputSchema)
  return portableSchema
})()
