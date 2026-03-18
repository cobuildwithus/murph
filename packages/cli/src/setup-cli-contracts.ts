import { z } from 'incur'
import { inboxBootstrapResultSchema } from './inbox-cli-contracts.js'
import { pathSchema, requestIdSchema } from './vault-cli-contracts.js'

export const whisperModelValues = [
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'large-v3-turbo',
] as const

export const whisperModelSchema = z.enum(whisperModelValues)

export const setupChannelValues = ['imessage', 'telegram'] as const
export const setupChannelSchema = z.enum(setupChannelValues)

export const setupStepKindSchema = z.enum(['install', 'download', 'configure'])

export const setupStepStatusSchema = z.enum([
  'planned',
  'completed',
  'reused',
  'skipped',
])

export const setupStepResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: setupStepKindSchema,
  status: setupStepStatusSchema,
  detail: z.string().min(1),
})

export const setupToolsSchema = z.object({
  ffmpegCommand: pathSchema.nullable(),
  pdftotextCommand: pathSchema.nullable(),
  whisperCommand: pathSchema.nullable(),
  whisperModelPath: pathSchema,
  paddleocrCommand: pathSchema.nullable(),
})

export const setupConfiguredChannelSchema = z.object({
  channel: setupChannelSchema,
  enabled: z.boolean(),
  configured: z.boolean(),
  autoReply: z.boolean(),
  connectorId: z.string().min(1).nullable(),
  detail: z.string().min(1),
})

export const setupCommandOptionsSchema = z.object({
  vault: pathSchema
    .default('./vault')
    .describe('Vault root to initialize and bootstrap. Defaults to ./vault.'),
  requestId: requestIdSchema,
  dryRun: z
    .boolean()
    .optional()
    .describe('Describe the macOS setup plan without mutating the machine or vault.'),
  rebuild: z
    .boolean()
    .optional()
    .describe('Rebuild inbox runtime indexes from existing raw inbox envelopes after init.'),
  strict: z
    .boolean()
    .default(true)
    .describe('Fail if the final inbox bootstrap doctor still reports blocking local runtime issues.'),
  toolchainRoot: pathSchema
    .optional()
    .describe('Override the local machine toolchain root. Defaults to ~/.healthybob/toolchain.'),
  whisperModel: whisperModelSchema
    .default('base.en')
    .describe('whisper.cpp model to download for local transcription.'),
  skipOcr: z
    .boolean()
    .optional()
    .describe('Skip PaddleX OCR installation even when the host supports it.'),
})

export const setupResultSchema = z.object({
  vault: pathSchema,
  platform: z.string().min(1),
  arch: z.string().min(1),
  dryRun: z.boolean(),
  toolchainRoot: pathSchema,
  whisperModel: whisperModelSchema,
  notes: z.array(z.string().min(1)),
  tools: setupToolsSchema,
  steps: z.array(setupStepResultSchema).min(1),
  bootstrap: inboxBootstrapResultSchema.nullable(),
  channels: z.array(setupConfiguredChannelSchema),
})

export type WhisperModel = z.infer<typeof whisperModelSchema>
export type SetupChannel = z.infer<typeof setupChannelSchema>
export type SetupCommandOptions = z.infer<typeof setupCommandOptionsSchema>
export type SetupStepKind = z.infer<typeof setupStepKindSchema>
export type SetupStepStatus = z.infer<typeof setupStepStatusSchema>
export type SetupStepResult = z.infer<typeof setupStepResultSchema>
export type SetupTools = z.infer<typeof setupToolsSchema>
export type SetupConfiguredChannel = z.infer<typeof setupConfiguredChannelSchema>
export type SetupResult = z.infer<typeof setupResultSchema>
