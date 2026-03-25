import { z } from 'incur'
import { isoTimestampSchema, pathSchema } from './vault-cli-contracts.js'

export const researchExecutionModeValues = ['deep-research', 'gpt-pro'] as const

export const researchRunResultSchema = z.object({
  vault: pathSchema,
  mode: z.enum(researchExecutionModeValues),
  title: z.string().min(1),
  prompt: z.string().min(1),
  notePath: pathSchema,
  savedAt: isoTimestampSchema,
  response: z.string().min(1),
  responseLength: z.number().int().positive(),
  chat: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  thinking: z.string().min(1).nullable(),
  warnings: z.array(z.string().min(1)),
})

export type ResearchExecutionMode =
  (typeof researchExecutionModeValues)[number]
export type ResearchRunResult = z.infer<typeof researchRunResultSchema>
