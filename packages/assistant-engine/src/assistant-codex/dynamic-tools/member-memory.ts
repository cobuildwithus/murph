import type { MurphDynamicToolExecutionResult } from '../dynamic-tools.js'
import { toolTextResult as memberMemoryTextResult } from '../tool-failure-diagnostics.js'
import {
  memorySectionSchema,
} from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'
import {
  forgetMemory,
  MemoryRecordConflictError,
  readMemoryDocument,
  updateMemory,
  upsertMemory,
} from '@murphai/core'

import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const memberMemoryArgumentsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('show') }).strict(),
  z.object({
    action: z.literal('upsert'),
    section: memorySectionSchema,
    text: z.string().trim().min(1),
  }).strict(),
  z.object({
    action: z.literal('update'),
    expectedUpdatedAt: z.string().trim().min(1),
    memoryId: z.string().trim().min(1),
    section: memorySectionSchema.optional(),
    text: z.string().trim().min(1),
  }).strict(),
  z.object({
    action: z.literal('forget'),
    expectedUpdatedAt: z.string().trim().min(1),
    memoryId: z.string().trim().min(1),
  }).strict(),
])

export const MURPH_MEMBER_MEMORY_TOOL = {
  namespace: 'murph',
  name: 'member_memory',
  description: [
    'Read, add, update, or forget canonical saved memory during engine-authorized silent member-memory consolidation.',
    'Call show exactly once per maintenance turn and use that one result for deduplication and mutation targeting. Upsert one concise supported fact at a time. Update or forget only by an id returned by show, and pass that record\'s exact updatedAt as expectedUpdatedAt.',
    'A successful mutation result is authoritative. If a record changed after show, leave the newer value unchanged and end the write attempt; never call show again in the same turn merely to retry or verify.',
  ].join(' '),
  inputSchema: z.toJSONSchema(memberMemoryArgumentsSchema, { io: 'input' }),
} as const

type MemberMemoryArguments = z.infer<typeof memberMemoryArgumentsSchema>

export type MemberMemoryDynamicToolRequest =
  | {
      args: MemberMemoryArguments
      kind: 'member-memory'
    }
  | {
      kind: 'invalid-member-memory-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readMemberMemoryDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): MemberMemoryDynamicToolRequest | null {
  if (input.tool !== MURPH_MEMBER_MEMORY_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: memberMemoryArgumentsSchema,
    schemaRootKeys: [
      'action',
      'expectedUpdatedAt',
      'memoryId',
      'section',
      'text',
    ],
    toolName: 'murph.member_memory',
    value: input.arguments,
  })

  return parsed.ok
    ? { args: parsed.args, kind: 'member-memory' }
    : {
        kind: 'invalid-member-memory-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeMemberMemoryDynamicTool(input: {
  abortSignal?: AbortSignal | null
  managedMaintenanceAuthorized: boolean
  request: Extract<MemberMemoryDynamicToolRequest, { kind: 'member-memory' }>
  vaultRoot: string | null
}): Promise<MurphDynamicToolExecutionResult> {
  if (!input.managedMaintenanceAuthorized) {
    return memberMemoryTextResult(
      false,
      'member-memory maintenance is unavailable for this turn',
      'authority_rejected',
    )
  }
  if (!input.vaultRoot) {
    return memberMemoryTextResult(
      false,
      'member-memory maintenance requires a vault',
      'unavailable',
    )
  }

  try {
    if (input.request.args.action === 'show') {
      input.abortSignal?.throwIfAborted()
      const document = await readMemoryDocument(input.vaultRoot)
      return memberMemoryTextResult(
        true,
        JSON.stringify({
          document: {
            exists: document.exists,
            records: document.records.map(({ id, section, text, updatedAt }) => ({
              id,
              section,
              text,
              updatedAt,
            })),
          },
          memory: null,
        }),
      )
    }

    if (input.request.args.action === 'upsert') {
      input.abortSignal?.throwIfAborted()
      const result = await upsertMemory(input.vaultRoot, {
        section: input.request.args.section,
        text: input.request.args.text,
      })
      return memberMemoryTextResult(
        true,
        JSON.stringify({
          created: result.created,
          memory: {
            id: result.record.id,
            section: result.record.section,
            text: result.record.text,
            updatedAt: result.record.updatedAt,
          },
        }),
      )
    }

    if (input.request.args.action === 'update') {
      input.abortSignal?.throwIfAborted()
      const result = await updateMemory(input.vaultRoot, {
        expectedUpdatedAt: input.request.args.expectedUpdatedAt,
        recordId: input.request.args.memoryId,
        section: input.request.args.section ?? null,
        text: input.request.args.text,
      })
      return memberMemoryTextResult(
        true,
        JSON.stringify({
          created: false,
          memory: {
            id: result.record.id,
            section: result.record.section,
            text: result.record.text,
            updatedAt: result.record.updatedAt,
          },
        }),
      )
    }

    input.abortSignal?.throwIfAborted()
    const result = await forgetMemory(input.vaultRoot, {
      expectedUpdatedAt: input.request.args.expectedUpdatedAt,
      recordId: input.request.args.memoryId,
    })
    return memberMemoryTextResult(
      true,
      JSON.stringify({
        forgotten: result.existed,
        memory: null,
      }),
    )
  } catch (error) {
    if (error instanceof MemoryRecordConflictError) {
      return memberMemoryTextResult(
        false,
        'saved memory changed after show; leave the newer value unchanged and end this maintenance write attempt',
        'conflict',
      )
    }
    return memberMemoryTextResult(
      false,
      'member-memory maintenance could not be completed',
      'handler_exception', error,
    )
  }
}
