import { z } from 'zod'
import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantCronPresetSchema,
  assistantSandboxValues,
} from './assistant-cli-contracts.js'
import { inboxBootstrapResultSchema } from './inbox-cli-contracts.js'
import {
  setupAssistantProviderPresetValues,
} from './assistant/openai-compatible-provider-presets.js'
import {
  isoTimestampSchema,
  pathSchema,
  requestIdSchema,
} from './vault-cli-contracts.js'

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

export const setupChannelValues = ['imessage', 'telegram', 'linq', 'email'] as const
export const setupChannelSchema = z.enum(setupChannelValues)

export const setupWearableValues = ['oura', 'whoop'] as const
export const setupWearableSchema = z.enum(setupWearableValues)

export const setupAssistantPresetValues = [
  'codex',
  'openai-compatible',
  'skip',
] as const
export const setupAssistantPresetSchema = z.enum(setupAssistantPresetValues)
export const setupAssistantProviderPresetSchema = z.enum(
  setupAssistantProviderPresetValues,
)
export const setupAssistantAccountKindValues = [
  'account',
  'api-key',
  'unknown',
] as const
export const setupAssistantAccountKindSchema = z.enum(
  setupAssistantAccountKindValues,
)

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
})

export const setupConfiguredChannelSchema = z.object({
  channel: setupChannelSchema,
  enabled: z.boolean(),
  configured: z.boolean(),
  autoReply: z.boolean(),
  connectorId: z.string().min(1).nullable(),
  detail: z.string().min(1),
  missingEnv: z.array(z.string().min(1)),
})

export const setupConfiguredWearableSchema = z.object({
  wearable: setupWearableSchema,
  enabled: z.boolean(),
  ready: z.boolean(),
  detail: z.string().min(1),
  missingEnv: z.array(z.string().min(1)),
})

export const setupAssistantQuotaWindowSchema = z
  .object({
    usedPercent: z.number().min(0).max(100),
    remainingPercent: z.number().min(0).max(100),
    windowMinutes: z.number().int().positive().nullable(),
    resetsAt: isoTimestampSchema.nullable(),
  })
  .strict()

export const setupAssistantQuotaSchema = z
  .object({
    creditsRemaining: z.number().finite().nullable(),
    creditsUnlimited: z.boolean().nullable(),
    primaryWindow: setupAssistantQuotaWindowSchema.nullable(),
    secondaryWindow: setupAssistantQuotaWindowSchema.nullable(),
  })
  .strict()

export const setupAssistantAccountSchema = z
  .object({
    source: z.string().min(1),
    kind: setupAssistantAccountKindSchema,
    planCode: z.string().min(1).nullable(),
    planName: z.string().min(1).nullable(),
    quota: setupAssistantQuotaSchema.nullable(),
  })
  .strict()

export const setupConfiguredAssistantSchema = z.object({
  preset: setupAssistantPresetSchema,
  enabled: z.boolean(),
  provider: z.enum(assistantChatProviderValues).nullable(),
  model: z.string().min(1).nullable(),
  baseUrl: z.string().min(1).nullable(),
  apiKeyEnv: z.string().min(1).nullable(),
  providerName: z.string().min(1).nullable(),
  codexCommand: z.string().min(1).nullable(),
  profile: z.string().min(1).nullable(),
  reasoningEffort: z.string().min(1).nullable(),
  sandbox: z.enum(assistantSandboxValues).nullable(),
  approvalPolicy: z.enum(assistantApprovalPolicyValues).nullable(),
  oss: z.boolean().nullable(),
  account: setupAssistantAccountSchema.nullable().optional(),
  detail: z.string().min(1),
})

export const setupScheduledUpdateSchema = z.object({
  preset: assistantCronPresetSchema,
  jobName: z.string().min(1),
  status: setupStepStatusSchema,
})

export const setupCommandOptionsSchema = z.object({
  vault: pathSchema
    .default('./vault')
    .describe('Vault root to initialize and bootstrap. Defaults to ./vault.'),
  requestId: requestIdSchema,
  dryRun: z
    .boolean()
    .optional()
    .describe('Describe the host setup plan without mutating the machine or vault.'),
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
    .describe('Override the local machine toolchain root. Defaults to ~/.murph/toolchain.'),
  whisperModel: whisperModelSchema
    .default('base.en')
    .describe('whisper.cpp model to download for local transcription.'),
  assistantPreset: setupAssistantPresetSchema
    .optional()
    .describe('Optional onboarding assistant preset: Codex, OpenAI-compatible endpoint, or skip.'),
  assistantProviderPreset: setupAssistantProviderPresetSchema
    .optional()
    .describe('Optional named OpenAI-compatible provider preset to save during setup, such as openrouter, venice, groq, ollama, or custom.'),
  assistantModel: z
    .string()
    .min(1)
    .optional()
    .describe('Optional default assistant model to save during setup.'),
  assistantBaseUrl: z
    .string()
    .min(1)
    .optional()
    .describe('Optional OpenAI-compatible base URL to save during setup, such as http://127.0.0.1:11434/v1 for Ollama.'),
  assistantApiKeyEnv: z
    .string()
    .min(1)
    .optional()
    .describe('Optional environment variable name that should hold the OpenAI-compatible API key.'),
  assistantProviderName: z
    .string()
    .min(1)
    .optional()
    .describe('Optional label for the saved OpenAI-compatible assistant provider.'),
  assistantCodexCommand: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Codex CLI executable path to save during setup. Defaults to codex.'),
  assistantProfile: z
    .string()
    .min(1)
    .optional()
    .describe('Optional Codex profile name to save during setup.'),
  assistantReasoningEffort: z
    .string()
    .min(1)
    .optional()
    .describe('Optional assistant reasoning effort default to save during setup.'),
  assistantOss: z
    .boolean()
    .optional()
    .describe('Optional Codex backend flag to save a local model target instead of the signed-in Codex cloud path.'),
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
  assistant: setupConfiguredAssistantSchema.nullable(),
  scheduledUpdates: z.array(setupScheduledUpdateSchema),
  channels: z.array(setupConfiguredChannelSchema),
  wearables: z.array(setupConfiguredWearableSchema),
})

export type WhisperModel = z.infer<typeof whisperModelSchema>
export type SetupChannel = z.infer<typeof setupChannelSchema>
export type SetupWearable = z.infer<typeof setupWearableSchema>
export type SetupAssistantPreset = z.infer<typeof setupAssistantPresetSchema>
export type SetupAssistantProviderPreset = z.infer<
  typeof setupAssistantProviderPresetSchema
>
export type SetupAssistantAccountKind = z.infer<
  typeof setupAssistantAccountKindSchema
>
export type SetupAssistantQuotaWindow = z.infer<
  typeof setupAssistantQuotaWindowSchema
>
export type SetupAssistantQuota = z.infer<typeof setupAssistantQuotaSchema>
export type SetupAssistantAccount = z.infer<typeof setupAssistantAccountSchema>
export type SetupConfiguredAssistant = z.infer<
  typeof setupConfiguredAssistantSchema
>
export type SetupScheduledUpdate = z.infer<typeof setupScheduledUpdateSchema>
export type SetupCommandOptions = z.infer<typeof setupCommandOptionsSchema>
export type SetupStepKind = z.infer<typeof setupStepKindSchema>
export type SetupStepStatus = z.infer<typeof setupStepStatusSchema>
export type SetupStepResult = z.infer<typeof setupStepResultSchema>
export type SetupTools = z.infer<typeof setupToolsSchema>
export type SetupConfiguredChannel = z.infer<typeof setupConfiguredChannelSchema>
export type SetupConfiguredWearable = z.infer<typeof setupConfiguredWearableSchema>
export type SetupResult = z.infer<typeof setupResultSchema>
