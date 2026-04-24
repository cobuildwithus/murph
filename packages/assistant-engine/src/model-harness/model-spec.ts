import {
  generateObject,
  generateText,
  Output,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantExecutionDriver } from '@murphai/operator-config/assistant-cli-contracts'

import {
  createAssistantResponsesFetch,
  resolveAssistantApiKey,
  type AssistantResponsesRequestPolicy,
} from './responses-policy.js'

export interface AssistantModelTextPart {
  type: 'text'
  text: string
}

export interface AssistantModelImagePart {
  type: 'image'
  image: string | Uint8Array | Buffer | ArrayBuffer | URL
  mediaType?: string
  mimeType?: string
}

export interface AssistantModelFilePart {
  type: 'file'
  data: string | Uint8Array | Buffer | ArrayBuffer | URL
  mediaType: string
  filename?: string
}

export type AssistantModelContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | AssistantModelFilePart
  | Record<string, unknown>

export type AssistantUserMessageContentPart =
  | AssistantModelTextPart
  | AssistantModelImagePart
  | AssistantModelFilePart

export interface AssistantModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | AssistantModelContentPart[]
}

export interface AssistantModelSpec {
  apiKey?: string
  apiKeyEnv?: string
  apiKeyEnvValue?: string | null
  baseUrl?: string
  executionDriver?: AssistantExecutionDriver
  headers?: Record<string, string>
  model: string
  providerName?: string
  responsesRequestPolicy?: AssistantResponsesRequestPolicy
}

export const ASSISTANT_MODEL_CONFIG_INVALID_CODE =
  'assistant_model_config_invalid' as const

export function isAssistantModelConfigurationError(
  error: unknown,
): error is VaultCliError {
  return (
    error instanceof VaultCliError &&
    error.code === ASSISTANT_MODEL_CONFIG_INVALID_CODE
  )
}

type ValidatedAssistantModelSpec =
  | {
      baseUrl?: string
      executionDriver: 'responses'
    }
  | {
      baseUrl: string
      executionDriver: 'openai-compatible'
    }

function validateAssistantModelSpecForExecution(
  spec: AssistantModelSpec,
  mode: 'assert',
): {
  baseUrl?: string
  executionDriver: 'openai-compatible' | 'responses'
}
function validateAssistantModelSpecForExecution(
  spec: AssistantModelSpec,
  mode: 'resolve',
): ValidatedAssistantModelSpec
function validateAssistantModelSpecForExecution(
  spec: AssistantModelSpec,
  mode: 'assert' | 'resolve',
): {
  baseUrl?: string
  executionDriver: 'openai-compatible' | 'responses'
} {
  const configuredExecutionDriver =
    typeof spec.executionDriver === 'string' && spec.executionDriver.trim().length > 0
      ? spec.executionDriver.trim()
      : 'openai-compatible'

  if (spec.model.trim().length === 0) {
    throw new VaultCliError(
      ASSISTANT_MODEL_CONFIG_INVALID_CODE,
      'Assistant model configuration is invalid: model id is required.',
      {
        executionDriver: configuredExecutionDriver,
      },
    )
  }

  if (configuredExecutionDriver === 'responses') {
    return {
      baseUrl: spec.baseUrl,
      executionDriver: 'responses',
    }
  }

  if (configuredExecutionDriver === 'codex-app-server') {
    throw new VaultCliError(
      ASSISTANT_MODEL_CONFIG_INVALID_CODE,
      'Assistant model configuration is invalid: Codex app-server models cannot be resolved through the AI SDK model harness.',
      {
        executionDriver: configuredExecutionDriver,
      },
    )
  }

  if (
    mode === 'resolve'
    || configuredExecutionDriver === 'openai-compatible'
  ) {
    if (!spec.baseUrl) {
      throw new VaultCliError(
        ASSISTANT_MODEL_CONFIG_INVALID_CODE,
        'Assistant model configuration is invalid: OpenAI-compatible routing requires a base URL.',
        {
          executionDriver: configuredExecutionDriver,
        },
      )
    }
  }

  return {
    baseUrl: spec.baseUrl ?? '',
    executionDriver: 'openai-compatible',
  }
}

export function assertAssistantModelSpecReadyForExecution(
  spec: AssistantModelSpec,
): void {
  validateAssistantModelSpecForExecution(spec, 'assert')
}

export interface GenerateAssistantObjectInput<TSchema extends z.ZodTypeAny> {
  maxSteps?: number
  messages?: AssistantModelMessage[]
  model: LanguageModel
  prompt?: string
  schema: TSchema
  schemaName?: string
  system?: string
  temperature?: number
  tools?: ToolSet
}

export async function generateAssistantObject<TSchema extends z.ZodTypeAny>(
  input: GenerateAssistantObjectInput<TSchema>,
): Promise<z.infer<TSchema>> {
  const promptOrMessages = resolveAssistantPromptOrMessages(input)

  if (input.tools || 'messages' in promptOrMessages) {
    const result = await generateText({
      model: input.model,
      system: input.system,
      temperature: input.temperature,
      ...(input.tools
        ? {
            tools: input.tools,
            stopWhen: stepCountIs(input.maxSteps ?? 6),
          }
        : {}),
      ...promptOrMessages,
      experimental_output: Output.object({
        schema: input.schema,
      }),
    } as Parameters<typeof generateText>[0])

    return input.schema.parse(
      (result as { experimental_output?: unknown; output?: unknown }).experimental_output ??
        (result as { output?: unknown }).output,
    )
  }

  const result = await generateObject({
    model: input.model,
    system: input.system,
    prompt: promptOrMessages.prompt,
    temperature: input.temperature,
    schema: input.schema,
    schemaName: input.schemaName,
  })

  return input.schema.parse(result.object)
}

export function resolveAssistantLanguageModel(
  spec: AssistantModelSpec,
): LanguageModel {
  const { baseUrl, executionDriver } =
    validateAssistantModelSpecForExecution(spec, 'resolve')

  switch (executionDriver) {
    case 'responses': {
      const provider = createOpenAI({
        name: normalizeAssistantProviderName(spec.providerName),
        apiKey: resolveAssistantApiKey(spec),
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        ...(spec.headers ? { headers: spec.headers } : {}),
        fetch: createAssistantResponsesFetch(spec.responsesRequestPolicy),
      })

      return provider.responses(spec.model)
    }

    case 'openai-compatible':
    default: {
      const provider = createOpenAICompatible({
        name: normalizeAssistantProviderName(spec.providerName),
        apiKey: resolveAssistantApiKey(spec),
        baseURL: baseUrl,
        ...(spec.headers ? { headers: spec.headers } : {}),
      })

      return provider(spec.model)
    }
  }
}

function resolveAssistantPromptOrMessages(
  input: Pick<GenerateAssistantObjectInput<z.ZodTypeAny>, 'messages' | 'prompt'>,
): { messages: AssistantModelMessage[] } | { prompt: string } {
  if (Array.isArray(input.messages) && input.messages.length > 0) {
    return {
      messages: input.messages,
    }
  }

  if (typeof input.prompt === 'string' && input.prompt.trim().length > 0) {
    return {
      prompt: input.prompt,
    }
  }

  throw new Error('Assistant generation requires either a prompt string or at least one message.')
}

function normalizeAssistantProviderName(value: string | null | undefined): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length > 0) {
      return trimmed
    }
  }

  return 'murph-assistant'
}
