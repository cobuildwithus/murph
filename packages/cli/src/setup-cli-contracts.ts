import { z } from 'incur'
import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantSandboxValues,
} from './assistant-cli-contracts.js'
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

export const setupChannelValues = ['imessage', 'telegram', 'email'] as const
export const setupChannelSchema = z.enum(setupChannelValues)

export const setupWearableValues = ['oura', 'whoop'] as const
export const setupWearableSchema = z.enum(setupWearableValues)

export const setupAssistantPresetValues = [
  'codex-cli',
  'codex-oss',
  'openai-compatible',
  'skip',
] as const
export const setupAssistantPresetSchema = z.enum(setupAssistantPresetValues)

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
  missingEnv: z.array(z.string().min(1)),
})

export const setupConfiguredWearableSchema = z.object({
  wearable: setupWearableSchema,
  enabled: z.boolean(),
  ready: z.boolean(),
  detail: z.string().min(1),
  missingEnv: z.array(z.string().min(1)),
})

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
  assistantPreset: setupAssistantPresetSchema
    .optional()
    .describe('Optional onboarding assistant preset: Codex CLI, Codex OSS/local model, OpenAI-compatible endpoint, or skip.'),
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
  channels: z.array(setupConfiguredChannelSchema),
  wearables: z.array(setupConfiguredWearableSchema),
})

export type WhisperModel = z.infer<typeof whisperModelSchema>
export type SetupChannel = z.infer<typeof setupChannelSchema>
export type SetupWearable = z.infer<typeof setupWearableSchema>
export type SetupAssistantPreset = z.infer<typeof setupAssistantPresetSchema>
export type SetupConfiguredAssistant = z.infer<
  typeof setupConfiguredAssistantSchema
>
export type SetupCommandOptions = z.infer<typeof setupCommandOptionsSchema>
export type SetupStepKind = z.infer<typeof setupStepKindSchema>
export type SetupStepStatus = z.infer<typeof setupStepStatusSchema>
export type SetupStepResult = z.infer<typeof setupStepResultSchema>
export type SetupTools = z.infer<typeof setupToolsSchema>
export type SetupConfiguredChannel = z.infer<typeof setupConfiguredChannelSchema>
export type SetupConfiguredWearable = z.infer<typeof setupConfiguredWearableSchema>
export type SetupResult = z.infer<typeof setupResultSchema>
