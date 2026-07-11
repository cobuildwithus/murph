import {
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingSchema,
} from '@murphai/contracts'
import { z } from 'zod'

export {
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingSchema,
}

export const assistantPersonalitySettingSourceSchema = z.enum([
  'default',
  'custom',
])

export const assistantPersonalitySettingResultSchema = z
  .object({
    value: assistantPersonalityScoreSchema,
    source: assistantPersonalitySettingSourceSchema,
  })
  .strict()

export const assistantPersonalitySettingsResultSchema = z
  .object({
    humor: assistantPersonalitySettingResultSchema,
    push: assistantPersonalitySettingResultSchema,
    detail: assistantPersonalitySettingResultSchema,
  })
  .strict()

export const assistantPersonalityResultSchema = z
  .object({
    vault: z.string().min(1).describe('Vault root operated against.'),
    preferencesPath: z
      .string()
      .min(1)
      .describe('Canonical vault-relative preferences document path.'),
    updated: z.boolean(),
    recordedAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .describe('Canonical preference update timestamp, or null before the first write.'),
    settings: assistantPersonalitySettingsResultSchema,
  })
  .strict()

export type AssistantPersonalitySettingSource = z.infer<
  typeof assistantPersonalitySettingSourceSchema
>
export type AssistantPersonalitySettingResult = z.infer<
  typeof assistantPersonalitySettingResultSchema
>
export type AssistantPersonalitySettingsResult = z.infer<
  typeof assistantPersonalitySettingsResultSchema
>
export type AssistantPersonalityResult = z.infer<
  typeof assistantPersonalityResultSchema
>
