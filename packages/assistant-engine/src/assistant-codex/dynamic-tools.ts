import type { CodexRpcMessage } from './app-server-rpc.js'
import * as core from './dynamic-tools-core.js'
import {
  cancelPendingAssistantGeneratedVaultFileSends,
  listPendingAssistantGeneratedVaultFileSends,
} from '../assistant/pending-vault-file-cancellation.js'

export * from './dynamic-tools-core.js'

export const MURPH_PENDING_VAULT_FILES_TOOL = {
  namespace: 'murph',
  name: 'pending_vault_files',
  description:
    'List or cancel runtime-generated files that are still waiting for secure iMessage delivery approval. Use only for an explicit current-user request to inspect, withdraw, or delete pending generated attachments. Always list first, then cancel only exact intentIds returned by that list. Cancellation abandons the parked delivery before deleting its runtime-owned bytes, and a delayed approval cannot revive it. Canonical or user-owned vault files and already approved or sent deliveries are never deleted by this tool.',
  inputSchema: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['list'],
          },
        },
        required: ['action'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['cancel'],
          },
          intentIds: {
            type: 'array',
            minItems: 1,
            maxItems: 20,
            uniqueItems: true,
            items: {
              type: 'string',
              pattern: '^outbox_[0-9a-f]{32}$',
            },
          },
        },
        required: ['action', 'intentIds'],
      },
    ],
  },
} as const

const SEND_VAULT_FILE_TOOL_NAME = 'send_vault_file'
const OUTBOX_INTENT_ID_PATTERN = /^outbox_[0-9a-f]{32}$/u
const MAX_PENDING_GENERATED_VAULT_FILE_SENDS = 20

export const MURPH_DYNAMIC_TOOLS: readonly MurphDynamicTool[] =
  insertPendingVaultFilesTool(core.MURPH_DYNAMIC_TOOLS)

export type MurphDynamicTool =
  | core.MurphDynamicTool
  | typeof MURPH_PENDING_VAULT_FILES_TOOL

export type MurphDynamicToolAvailability = core.MurphDynamicToolAvailability

export type MurphDynamicToolRequest =
  | core.MurphDynamicToolRequest
  | PendingVaultFilesToolRequest

export function resolveMurphDynamicTools(
  availability: MurphDynamicToolAvailability,
): readonly MurphDynamicTool[] {
  const tools = core.resolveMurphDynamicTools(availability)
  return availability.vaultFileSendAvailable === true
    ? insertPendingVaultFilesTool(tools)
    : tools
}

export function listMurphDynamicToolNames(): string[] {
  return MURPH_DYNAMIC_TOOLS.map((tool) => `${tool.namespace}.${tool.name}`)
}

export function readMurphDynamicToolRequest(
  message: CodexRpcMessage,
): MurphDynamicToolRequest | null {
  const pendingRequest = readPendingVaultFilesToolRequest(message)
  return pendingRequest ?? core.readMurphDynamicToolRequest(message)
}

type CoreExecutionInput = Parameters<
  typeof core.executeMurphDynamicToolRequest
>[0]

type PendingVaultFilesToolRequest =
  | { kind: 'pending-vault-files-list' }
  | {
      intentIds: readonly string[]
      kind: 'pending-vault-files-cancel'
    }
  | { kind: 'invalid-pending-vault-files-arguments' }

export async function executeMurphDynamicToolRequest(
  input: Omit<CoreExecutionInput, 'request'> & {
    request: MurphDynamicToolRequest
  },
): Promise<core.MurphDynamicToolExecutionResult> {
  if (!isPendingVaultFilesToolRequest(input.request)) {
    return core.executeMurphDynamicToolRequest({
      ...input,
      request: input.request,
    })
  }

  if (input.request.kind === 'invalid-pending-vault-files-arguments') {
    return toolTextResult(false, 'invalid pending vault-file arguments')
  }

  const hostedToolContext = input.hostedToolContext ?? null
  const vaultRoot = input.vaultRoot?.trim() ?? ''
  if (!hostedToolContext?.vaultFileSendAvailable || !vaultRoot) {
    return toolTextResult(
      false,
      'pending vault-file management is unavailable for this turn',
    )
  }
  if (!hostedToolContext.currentAssistantInputId?.()) {
    return toolTextResult(
      false,
      'pending vault-file management requires current user-sourced input',
    )
  }

  try {
    const result = input.request.kind === 'pending-vault-files-list'
      ? await listPendingAssistantGeneratedVaultFileSends({ vault: vaultRoot })
      : await cancelPendingAssistantGeneratedVaultFileSends({
          intentIds: input.request.intentIds,
          vault: vaultRoot,
        })
    return toolTextResult(true, JSON.stringify(result))
  } catch {
    return toolTextResult(
      false,
      'pending vault-file management failed safely',
    )
  }
}

function insertPendingVaultFilesTool(
  tools: readonly core.MurphDynamicTool[],
): readonly MurphDynamicTool[] {
  if (tools.some((tool) => tool.name === MURPH_PENDING_VAULT_FILES_TOOL.name)) {
    return tools
  }
  const sendIndex = tools.findIndex(
    (tool) => tool.name === SEND_VAULT_FILE_TOOL_NAME,
  )
  if (sendIndex < 0) {
    return [...tools, MURPH_PENDING_VAULT_FILES_TOOL]
  }
  return [
    ...tools.slice(0, sendIndex + 1),
    MURPH_PENDING_VAULT_FILES_TOOL,
    ...tools.slice(sendIndex + 1),
  ]
}

function readPendingVaultFilesToolRequest(
  message: CodexRpcMessage,
): PendingVaultFilesToolRequest | null {
  if (message.method !== 'item/tool/call') {
    return null
  }
  const params = asRecord(message.params)
  if (
    params?.namespace !== MURPH_PENDING_VAULT_FILES_TOOL.namespace
    || params.tool !== MURPH_PENDING_VAULT_FILES_TOOL.name
  ) {
    return null
  }
  const args = asRecord(params.arguments)
  if (!args || typeof args.action !== 'string') {
    return { kind: 'invalid-pending-vault-files-arguments' }
  }
  if (args.action === 'list') {
    return Object.keys(args).length === 1
      ? { kind: 'pending-vault-files-list' }
      : { kind: 'invalid-pending-vault-files-arguments' }
  }
  if (args.action !== 'cancel' || Object.keys(args).length !== 2) {
    return { kind: 'invalid-pending-vault-files-arguments' }
  }
  const intentIds = args.intentIds
  if (
    !Array.isArray(intentIds)
    || intentIds.length === 0
    || intentIds.length > MAX_PENDING_GENERATED_VAULT_FILE_SENDS
    || intentIds.some(
      (intentId) =>
        typeof intentId !== 'string'
        || !OUTBOX_INTENT_ID_PATTERN.test(intentId),
    )
    || new Set(intentIds).size !== intentIds.length
  ) {
    return { kind: 'invalid-pending-vault-files-arguments' }
  }
  return {
    intentIds,
    kind: 'pending-vault-files-cancel',
  }
}

function isPendingVaultFilesToolRequest(
  request: MurphDynamicToolRequest,
): request is PendingVaultFilesToolRequest {
  return request.kind === 'pending-vault-files-list'
    || request.kind === 'pending-vault-files-cancel'
    || request.kind === 'invalid-pending-vault-files-arguments'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

function toolTextResult(
  success: boolean,
  text: string,
): core.MurphDynamicToolExecutionResult {
  return {
    rpcResult: {
      success,
      contentItems: [{
        type: 'inputText',
        text,
      }],
    },
  }
}
