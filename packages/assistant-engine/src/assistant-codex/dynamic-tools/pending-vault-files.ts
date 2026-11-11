import type { MurphDynamicToolExecutionResult } from '../dynamic-tools.js'
import { toolTextResult as pendingVaultFilesTextResult } from '../tool-failure-diagnostics.js'
import * as z from '@murphai/contracts/zod-runtime'

import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  isAssistantGeneratedDeliveryRef,
} from '../../assistant/generated-delivery-files.js'
import type {
  AssistantHostedUserActionScope,
} from '../../assistant/hosted-tool-context.js'
import {
  listAssistantOutboxIntents,
  saveAssistantOutboxIntentIfUnchanged,
} from '../../assistant/outbox.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  readAssistantVaultFileMedia,
} from '../../assistant/vault-file-send.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const MAX_PENDING_GENERATED_VAULT_FILE_SENDS = 20
const VAULT_FILE_SEND_CANCELLED_CODE = 'ASSISTANT_VAULT_FILE_SEND_CANCELLED'

const pendingVaultFileIntentIdSchema = z.string()
  .regex(/^outbox_[0-9a-f]{32}$/u)

const pendingVaultFilesListArgumentsSchema = z.object({
  action: z.literal('list'),
}).strict()

const pendingVaultFilesCancelArgumentsSchema = z.object({
  action: z.literal('cancel'),
  intentIds: z.array(pendingVaultFileIntentIdSchema)
    .min(1)
    .max(MAX_PENDING_GENERATED_VAULT_FILE_SENDS)
    .refine(
      (intentIds) => new Set(intentIds).size === intentIds.length,
      'Intent ids must be unique.',
    ),
}).strict()

const pendingVaultFilesArgumentsSchema = z.discriminatedUnion('action', [
  pendingVaultFilesListArgumentsSchema,
  pendingVaultFilesCancelArgumentsSchema,
])

export const MURPH_PENDING_VAULT_FILES_TOOL = {
  namespace: 'murph',
  name: 'pending_vault_files',
  description: [
    "List or cancel files Murph generated that are still waiting for the member's delivery approval in this private conversation.",
    'Use it only when the member asks.',
    'list returns the oldest 20 pending files plus totalCount.',
    'cancel takes intentIds from that list and returns one status per id: cancelled, already_cancelled, not_found, not_pending, or failed.',
    'not_pending means delivery already started or finished, and it does not show that the file arrived.',
    'A failed id may be retried once.',
    'For a request to cancel everything, repeat list then cancel up to five times, stop when the list is empty or nothing changes, and report what remains.',
    'Cancelling stops the delivery, and an old approval link cannot revive it. Say so when you confirm a cancellation.',
    'The file itself is removed later by cleanup.',
    'Files the member saved to their vault are not affected.',
  ].join(' '),
  inputSchema: z.toJSONSchema(pendingVaultFilesArgumentsSchema, { io: 'input' }),
} as const

export type PendingVaultFilesDynamicToolRequest =
  | { kind: 'pending-vault-files-list' }
  | {
      intentIds: readonly string[]
      kind: 'pending-vault-files-cancel'
    }
  | {
      kind: 'invalid-pending-vault-files-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export interface AssistantPendingGeneratedVaultFileSend {
  createdAt: string
  filename: string
  intentId: string
  sizeBytes: number
}

export type AssistantPendingGeneratedVaultFileCancellation =
  | (AssistantPendingGeneratedVaultFileSend & {
      status: 'already_cancelled' | 'cancelled'
    })
  | {
      intentId: string
      status: 'failed' | 'not_found' | 'not_pending'
    }

export function readPendingVaultFilesDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): PendingVaultFilesDynamicToolRequest | null {
  if (input.tool !== MURPH_PENDING_VAULT_FILES_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: pendingVaultFilesArgumentsSchema,
    schemaRootKeys: ['action', 'intentIds'],
    toolName: 'murph.pending_vault_files',
    value: input.arguments,
  })
  if (!parsed.ok) {
    return {
      kind: 'invalid-pending-vault-files-arguments',
      validationDigest: parsed.validationDigest,
    }
  }
  return parsed.args.action === 'list'
    ? { kind: 'pending-vault-files-list' }
    : {
        intentIds: parsed.args.intentIds,
        kind: 'pending-vault-files-cancel',
      }
}

export async function executePendingVaultFilesDynamicTool(input: {
  request: Exclude<
    PendingVaultFilesDynamicToolRequest,
    { kind: 'invalid-pending-vault-files-arguments' }
  >
  userActionScope: AssistantHostedUserActionScope | null
  vaultRoot: string | null
}): Promise<MurphDynamicToolExecutionResult> {
  if (
    !input.vaultRoot
    || !input.userActionScope
    || input.userActionScope.conversationScope !== 'direct'
  ) {
    return pendingVaultFilesTextResult(
      false,
      'pending vault-file management requires current user input in a direct conversation',
      'authority_rejected',
    )
  }

  try {
    const result = input.request.kind === 'pending-vault-files-list'
      ? await listPendingAssistantGeneratedVaultFileSends({
          originSessionId: input.userActionScope.originSessionId,
          vault: input.vaultRoot,
        })
      : await cancelPendingAssistantGeneratedVaultFileSends({
          intentIds: input.request.intentIds,
          originSessionId: input.userActionScope.originSessionId,
          vault: input.vaultRoot,
        })
    return pendingVaultFilesTextResult(true, JSON.stringify(result))
  } catch (error) {
    return pendingVaultFilesTextResult(
      false,
      'pending vault-file management is temporarily unavailable',
      'handler_exception', error,
    )
  }
}

export async function listPendingAssistantGeneratedVaultFileSends(input: {
  originSessionId: string
  vault: string
}): Promise<{
  pending: AssistantPendingGeneratedVaultFileSend[]
  totalCount: number
}> {
  const candidates = (await listAssistantOutboxIntents(input.vault))
    .filter((intent) => intent.sessionId === input.originSessionId)
    .map(readPendingGeneratedVaultFileSend)
    .filter((candidate): candidate is AssistantPendingGeneratedVaultFileSend =>
      candidate !== null)
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
      || left.intentId.localeCompare(right.intentId)
    )

  return {
    pending: candidates.slice(0, MAX_PENDING_GENERATED_VAULT_FILE_SENDS),
    totalCount: candidates.length,
  }
}

export async function cancelPendingAssistantGeneratedVaultFileSends(input: {
  intentIds: readonly string[]
  now?: Date
  originSessionId: string
  vault: string
}): Promise<{
  results: AssistantPendingGeneratedVaultFileCancellation[]
}> {
  const request = pendingVaultFilesCancelArgumentsSchema.parse({
    action: 'cancel',
    intentIds: input.intentIds,
  })
  const intents = await listAssistantOutboxIntents(input.vault)
  const intentsById = new Map(
    intents
      .filter((intent) => intent.sessionId === input.originSessionId)
      .map((intent) => [intent.intentId, intent] as const),
  )
  const now = input.now ?? new Date()
  const results: AssistantPendingGeneratedVaultFileCancellation[] = []

  for (const intentId of request.intentIds) {
    const intent = intentsById.get(intentId)
    const file = intent ? readGeneratedVaultFileMedia(intent) : null
    if (!intent || !file) {
      results.push({ intentId, status: 'not_found' })
      continue
    }
    if (isCancelledGeneratedVaultFileSend(intent)) {
      results.push({
        ...buildPendingGeneratedVaultFileSend(intent, file),
        status: 'already_cancelled',
      })
      continue
    }
    if (intent.status !== 'awaiting_approval') {
      results.push({ intentId, status: 'not_pending' })
      continue
    }

    results.push(await cancelPendingGeneratedVaultFileSend({
      file,
      intent,
      now,
      vault: input.vault,
    }))
  }

  return { results }
}

async function cancelPendingGeneratedVaultFileSend(input: {
  file: AssistantVaultFileResponseMedia
  intent: AssistantOutboxIntent
  now: Date
  vault: string
}): Promise<AssistantPendingGeneratedVaultFileCancellation> {
  let current = input.intent
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const cancelledIntent = assistantOutboxIntentSchema.parse({
        ...current,
        lastError: {
          code: VAULT_FILE_SEND_CANCELLED_CODE,
          message: 'Pending generated-file delivery was cancelled.',
        },
        nextAttemptAt: null,
        status: 'abandoned',
        updatedAt: nextCancellationTimestamp(current.updatedAt, input.now),
      })
      const persistence = await saveAssistantOutboxIntentIfUnchanged({
        expectedDedupeKey: current.dedupeKey,
        expectedStatus: current.status,
        expectedUpdatedAt: current.updatedAt,
        intent: cancelledIntent,
        vault: input.vault,
      })
      const persisted = persistence.intent
      if (persistence.applied) {
        return {
          ...buildPendingGeneratedVaultFileSend(
            persisted,
            readGeneratedVaultFileMedia(persisted) ?? input.file,
          ),
          status: 'cancelled',
        }
      }
      if (isCancelledGeneratedVaultFileSend(persisted)) {
        return {
          ...buildPendingGeneratedVaultFileSend(
            persisted,
            readGeneratedVaultFileMedia(persisted) ?? input.file,
          ),
          status: 'already_cancelled',
        }
      }
      if (persisted.status !== 'awaiting_approval') {
        return { intentId: current.intentId, status: 'not_pending' }
      }
      current = persisted
    } catch {
      return { intentId: current.intentId, status: 'failed' }
    }
  }
  return { intentId: current.intentId, status: 'failed' }
}

function readPendingGeneratedVaultFileSend(
  intent: AssistantOutboxIntent,
): AssistantPendingGeneratedVaultFileSend | null {
  if (intent.status !== 'awaiting_approval') {
    return null
  }
  const file = readGeneratedVaultFileMedia(intent)
  return file ? buildPendingGeneratedVaultFileSend(intent, file) : null
}

function readGeneratedVaultFileMedia(
  intent: AssistantOutboxIntent,
): AssistantVaultFileResponseMedia | null {
  try {
    const file = readAssistantVaultFileMedia(intent)
    return file && isAssistantGeneratedDeliveryRef(file.ref) ? file : null
  } catch {
    return null
  }
}

function buildPendingGeneratedVaultFileSend(
  intent: AssistantOutboxIntent,
  file: AssistantVaultFileResponseMedia,
): AssistantPendingGeneratedVaultFileSend {
  return {
    createdAt: intent.createdAt,
    filename: file.filename,
    intentId: intent.intentId,
    sizeBytes: file.sizeBytes,
  }
}

function isCancelledGeneratedVaultFileSend(
  intent: AssistantOutboxIntent,
): boolean {
  return intent.status === 'abandoned'
    && intent.lastError?.code === VAULT_FILE_SEND_CANCELLED_CODE
}

function nextCancellationTimestamp(current: string, now: Date): string {
  const currentMs = Date.parse(current)
  return new Date(
    Number.isFinite(currentMs)
      ? Math.max(now.getTime(), currentMs + 1)
      : now.getTime(),
  ).toISOString()
}
