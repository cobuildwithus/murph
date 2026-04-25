import { z } from 'zod'
import {
  listAssistantSelfDeliveryTargets,
  resolveAssistantSelfDeliveryTarget,
} from '@murphai/operator-config/operator-config'
import type {
  AssistantToolCatalogOptions,
  AssistantToolContext,
} from './shared.js'
import {
  assistantCliExecutorToolName,
  assistantCliMaxTimeoutMs,
  assistantToolTextReadMaxChars,
} from './shared.js'
import {
  executeAssistantCliCommand,
  readAssistantTextFile,
} from './execution-adapters.js'
import {
  defineCliBackedTool,
  defineHandAuthoredHelperTool,
  defineNativeLocalOnlyTool,
} from './definition-factory.js'
import { createHealthCommonsToolDefinitions } from './definitions/health-commons.js'
import {
  createAssistantKnowledgeReadToolDefinitions,
  createAssistantKnowledgeWriteToolDefinitions,
} from './definitions/knowledge.js'
import { createVaultQueryToolDefinitions } from './definitions/vault-query.js'
import {
  createWebFetchToolDefinitions,
  createWebPdfReadToolDefinitions,
  createWebSearchToolDefinitions,
} from './definitions/web-read.js'

export {
  defineAssistantCapabilityTool,
  defineCliBackedTool,
  defineConfiguredWebReadTool,
  defineDescriptorGeneratedTool,
  defineHandAuthoredHelperTool,
  defineHostedApiBackedTool,
  defineNativeLocalOnlyTool,
  defineVaultServiceBackedTool,
  type AssistantCapabilityToolDefinitionInput,
} from './definition-factory.js'
export {
  createAssistantKnowledgeReadToolDefinitions,
  createAssistantKnowledgeWriteToolDefinitions,
} from './definitions/knowledge.js'
export { createHealthCommonsToolDefinitions } from './definitions/health-commons.js'
export { createInboxPromotionToolDefinitions } from './definitions/inbox-promotion.js'
export { createOutwardSideEffectToolDefinitions } from './definitions/outward-side-effects.js'
export { createVaultQueryToolDefinitions } from './definitions/vault-query.js'
export {
  createCanonicalVaultWriteToolDefinitions,
  createHealthUpsertToolDefinitions,
} from './definitions/vault-write.js'
export {
  createWebFetchToolDefinitions,
  createWebPdfReadToolDefinitions,
  createWebSearchToolDefinitions,
} from './definitions/web-read.js'

const vaultFilePathSchema = z.string().min(1)

export function createAssistantCliExecutorToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineCliBackedTool({
      name: assistantCliExecutorToolName,
      description:
        'Run the local `vault-cli` directly inside the active Murph workspace. This is the primary Murph runtime surface for provider turns. Pass only the tokens that come after `vault-cli`. The active vault is injected automatically when the command path normally needs `--vault`. Use `--help`, `--schema --format json`, `--llms`, and `--llms-full` for discovery.',
      inputSchema: z.object({
        args: z.array(z.string().min(1)).min(1),
        stdin: z.string().optional(),
        timeoutMs: z.number().int().positive().max(assistantCliMaxTimeoutMs).optional(),
      }),
      inputExample: {
        args: ['device', 'provider', 'list'],
      },
      execute: async ({ args, stdin, timeoutMs }) => {
        const result = await executeAssistantCliCommand({
          args,
          stdin,
          timeoutMs,
          input,
        })

        if (result.json !== null) {
          return result.json
        }

        return result.stdout.length > 0 ? result.stdout : null
      },
    }),
  ]
}

export function createVaultTextReadToolDefinitions(
  input: AssistantToolContext,
) {
  return [
    defineNativeLocalOnlyTool({
      name: 'vault.fs.readText',
      description:
        'Read one UTF-8 text file inside the active vault with bounded truncation. Use this for targeted inspection of parser outputs, markdown notes, or attachment-derived text artifacts when canonical query tools are not enough.',
      inputSchema: z.object({
        path: vaultFilePathSchema,
        maxChars: z.number().int().positive().max(assistantToolTextReadMaxChars).optional(),
      }),
      inputExample: {
        path: 'raw/inbox/captures/cap_123/attachments/1/parser/plain-text.txt',
      },
      execute: ({ path: candidatePath, maxChars }) =>
        readAssistantTextFile(input.vault, candidatePath, maxChars),
    }),
  ]
}

export function createAssistantRuntimeToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  const readOnlyTools = [
    ...createAssistantKnowledgeReadToolDefinitions(input),
    defineHandAuthoredHelperTool({
      name: 'assistant.selfTarget.list',
      description:
        'List saved outbound self-target routes such as iMessage (internal channel `linq`), Telegram, or email delivery settings.',
      inputSchema: z.object({}),
      inputExample: {},
      execute: () => listAssistantSelfDeliveryTargets(),
    }),
    defineHandAuthoredHelperTool({
      name: 'assistant.selfTarget.show',
      description:
        'Show the saved outbound self-target route for one channel. Use `linq` or `iMessage` for iMessage routes.',
      inputSchema: z.object({
        channel: z.string().min(1),
      }),
      inputExample: {
        channel: 'linq',
      },
      execute: ({ channel }) => resolveAssistantSelfDeliveryTarget(channel),
    }),
  ]

  if (!(options.includeStatefulWriteTools ?? true)) {
    return readOnlyTools
  }

  return [
    ...readOnlyTools,
    ...createAssistantKnowledgeWriteToolDefinitions(input),
  ]
}

export function createQueryAndReadToolDefinitions(
  input: AssistantToolContext,
  options: AssistantToolCatalogOptions = {},
) {
  return [
    ...(options.includeVaultTextReadTool ?? true
      ? createVaultTextReadToolDefinitions(input)
      : []),
    ...(options.includeHealthCommonsTools ?? true
      ? createHealthCommonsToolDefinitions()
      : []),
    ...(options.includeQueryTools ?? true
      ? createVaultQueryToolDefinitions(input)
      : []),
    ...(options.includeWebSearchTools ?? true
      ? [
          ...createWebFetchToolDefinitions(),
          ...createWebPdfReadToolDefinitions(),
          ...createWebSearchToolDefinitions(),
        ]
      : []),
  ]
}
