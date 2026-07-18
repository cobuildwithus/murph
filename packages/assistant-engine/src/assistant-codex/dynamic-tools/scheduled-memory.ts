import { z } from 'zod'

import {
  memoryRecordMetadataSchema,
  memorySectionSchema,
} from '@murphai/contracts'
import {
  updateMemory,
  upsertMemory,
} from '@murphai/core'

import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import {
  resolveAssistantScheduledTaskAuthority,
  type AssistantScheduledTaskAuthority,
  type AssistantScheduledTaskSourceCurrentAssertion,
} from '../../assistant/scheduled-task-authority.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const memoryIdSchema = memoryRecordMetadataSchema.shape.id
const memoryTextSchema = z.string().trim().min(1).max(4_000)

// One maintenance wake consolidates at most seven days of bounded evidence.
// Eight mutations leave room for a small set of independently supported facts
// and corrections without granting an unattended turn open-ended memory writes.
export const MAX_MAINTENANCE_MEMORY_MUTATIONS_PER_TURN = 8

export interface MaintenanceMemoryMutationClaimState {
  mutationsClaimed: number
}

export function claimMaintenanceMemoryMutation(
  state: MaintenanceMemoryMutationClaimState,
): boolean {
  if (state.mutationsClaimed >= MAX_MAINTENANCE_MEMORY_MUTATIONS_PER_TURN) {
    return false
  }
  state.mutationsClaimed += 1
  return true
}

const maintenanceMemoryUpsertSchema = z.object({
  action: z.literal('upsert'),
  section: memorySectionSchema,
  text: memoryTextSchema,
}).strict()

const maintenanceMemoryUpdateSchema = z.object({
  action: z.literal('update'),
  memoryId: memoryIdSchema,
  section: memorySectionSchema.optional(),
  text: memoryTextSchema,
}).strict()

const maintenanceMemoryArgumentsSchema = z.discriminatedUnion('action', [
  maintenanceMemoryUpsertSchema,
  maintenanceMemoryUpdateSchema,
])

export const MURPH_MAINTENANCE_MEMORY_TOOL = {
  namespace: 'murph',
  name: 'maintenance_memory',
  description:
    `Persist one bounded canonical memory change during the dedicated memory-maintenance turn, up to ${MAX_MAINTENANCE_MEMORY_MUTATIONS_PER_TURN} mutations per turn. Only upsert and update are supported. The trusted parent selects the active vault; this tool accepts no paths, commands, delete action, or credentials.`,
  inputSchema: z.toJSONSchema(maintenanceMemoryArgumentsSchema, { io: 'input' }),
} as const

export type ScheduledMemoryDynamicToolRequest =
  | {
      kind: 'maintenance-memory'
      request: z.infer<typeof maintenanceMemoryArgumentsSchema>
    }
  | {
      kind: 'invalid-maintenance-memory-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readScheduledMemoryDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ScheduledMemoryDynamicToolRequest | null {
  if (input.tool === MURPH_MAINTENANCE_MEMORY_TOOL.name) {
    const parsed = parseDynamicToolArguments({
      schema: maintenanceMemoryArgumentsSchema,
      schemaRootKeys: ['action', 'memoryId', 'section', 'text'],
      toolName: 'murph.maintenance_memory',
      value: input.arguments,
    })
    return parsed.ok
      ? { kind: 'maintenance-memory', request: parsed.args }
      : {
          kind: 'invalid-maintenance-memory-arguments',
          validationDigest: parsed.validationDigest,
        }
  }

  return null
}

export async function executeScheduledMemoryDynamicTool(input: {
  assertSourceCurrent: AssistantScheduledTaskSourceCurrentAssertion
  authority: AssistantScheduledTaskAuthority | null
  claimMaintenanceMemoryMutation?: (() => boolean) | null
  request: Extract<ScheduledMemoryDynamicToolRequest, {
    kind: 'maintenance-memory'
  }>
  vaultRoot: string | null
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (!input.vaultRoot) {
    return memoryTextResult(false, 'scheduled memory is unavailable')
  }

  const authority = resolveAssistantScheduledTaskAuthority(input.authority)

  try {
    if (authority.kind !== 'memory_maintenance') {
      return memoryTextResult(false, JSON.stringify({
        code: 'scheduled_memory_unauthorized',
      }))
    }

    if (!input.claimMaintenanceMemoryMutation) {
      return memoryTextResult(false, JSON.stringify({
        code: 'scheduled_memory_claim_unavailable',
      }))
    }

    await input.assertSourceCurrent(input.authority)

    if (!input.claimMaintenanceMemoryMutation()) {
      return memoryTextResult(false, JSON.stringify({
        code: 'scheduled_memory_limit_reached',
      }))
    }

    if (input.request.request.action === 'upsert') {
      const result = await upsertMemory(input.vaultRoot, {
        section: input.request.request.section,
        text: input.request.request.text,
      })
      return memoryTextResult(true, JSON.stringify({
        action: 'upsert',
        created: result.created,
        memoryId: result.record.id,
        section: result.record.section,
      }))
    }

    const result = await updateMemory(input.vaultRoot, {
      recordId: input.request.request.memoryId,
      section: input.request.request.section,
      text: input.request.request.text,
    })
    return memoryTextResult(true, JSON.stringify({
      action: 'update',
      memoryId: result.record.id,
      section: result.record.section,
    }))
  } catch {
    return memoryTextResult(false, JSON.stringify({
      code: 'scheduled_memory_unavailable',
    }))
  }
}

function memoryTextResult(success: boolean, text: string): {
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
} {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' }],
      success,
    },
  }
}
