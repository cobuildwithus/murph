import type { MurphDynamicToolExecutionResult } from '../dynamic-tools.js'
import { toolTextResult as memberMemoryTextResult } from '../tool-failure-diagnostics.js'
import { memoryRecordMetadataSchema, memorySectionSchema, type MemoryDocumentSnapshot } from '@murphai/contracts'
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
  z.object({ action: z.literal('show'), cursor: memoryRecordMetadataSchema.shape.id.optional() }).strict(),
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
    'Read, add, update, or forget saved member memory during silent memory consolidation.',
    'show returns a page of records with id, section, text, and updatedAt. Pass nextCursor as cursor to read the next page. Leave any oversizedRecordId unchanged.',
    'upsert adds one fact.',
    "update and forget take a memoryId from show and that record's updatedAt as expectedUpdatedAt.",
    'A successful write result is final and needs no second show.',
    'A conflict means the record changed after show. Leave the newer value and stop.',
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
      'cursor',
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
        JSON.stringify(memoryPage(document, input.request.args.cursor)),
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
          memory: projectWrittenMemory(result.record, input.request.args),
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
          memory: projectWrittenMemory(result.record, input.request.args),
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

// Leave room for the envelope and cursor below the app-server's 48 KB text limit.
const MEMORY_PAGE_RECORD_BYTES = 47_000

function memoryPage(document: MemoryDocumentSnapshot, cursor?: string) {
  const records = []
  let bytes = 0
  const sorted = document.records.sort((a, b) => a.id.localeCompare(b.id))
  for (const { id, section, text, updatedAt } of sorted) {
    if (cursor && id.localeCompare(cursor) <= 0) continue
    const record = { id, section, text, updatedAt }
    const size = Buffer.byteLength(JSON.stringify(record)) + 1
    if (size + bytes > MEMORY_PAGE_RECORD_BYTES) {
      if (records.length) return { document: { exists: document.exists, records }, nextCursor: records[records.length - 1]!.id }
      // One oversized fact must not hide later records or be returned as editable partial text.
      return { document: { exists: document.exists, records }, oversizedRecordId: id,
        ...(id !== sorted.at(-1)?.id && { nextCursor: id }) }
    }
    records.push(record)
    bytes += size
  }
  return { document: { exists: document.exists, records } }
}

// A write reports the stored id and version. Section and text are echoed only
// when the stored record differs from what was sent, such as normalized text,
// a canonical demographic fact, or an existing record the upsert matched.
function projectWrittenMemory(
  record: { id: string; section: string; text: string; updatedAt: string },
  request: { section?: string; text: string },
) {
  return {
    id: record.id,
    ...(request.section !== undefined && record.section !== request.section ? { section: record.section } : {}),
    ...(record.text === request.text ? {} : { text: record.text }),
    updatedAt: record.updatedAt,
  }
}
