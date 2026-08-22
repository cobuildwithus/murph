import {
  memorySectionSchema,
} from '@murphai/contracts'
import * as z from '@murphai/contracts/zod-runtime'
import {
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
    memoryId: z.string().trim().min(1),
    section: memorySectionSchema.optional(),
    text: z.string().trim().min(1),
  }).strict(),
])

export const MURPH_MEMBER_MEMORY_TOOL = {
  namespace: 'murph',
  name: 'member_memory',
  description: [
    'Read, add, or update canonical saved memory during engine-authorized silent member-memory consolidation.',
    'Call show first. Existing memory is only for deduplication and update targeting. Upsert one concise supported fact at a time; update only by an id returned by show. This tool cannot delete memory and is unavailable outside the exact managed maintenance turn.',
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
    schemaRootKeys: ['action', 'memoryId', 'section', 'text'],
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
  available: boolean
  managedMaintenanceAuthorized: boolean
  request: Extract<MemberMemoryDynamicToolRequest, { kind: 'member-memory' }>
  vaultRoot: string | null
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (!input.available || !input.managedMaintenanceAuthorized) {
    return memberMemoryTextResult(
      false,
      'member-memory maintenance is unavailable for this turn',
    )
  }
  if (!input.vaultRoot) {
    return memberMemoryTextResult(
      false,
      'member-memory maintenance requires a vault',
    )
  }

  try {
    if (input.request.args.action === 'show') {
      const document = await readMemoryDocument(input.vaultRoot)
      return memberMemoryTextResult(
        true,
        JSON.stringify({ document, memory: null }),
      )
    }

    if (input.request.args.action === 'upsert') {
      const result = await upsertMemory(input.vaultRoot, {
        section: input.request.args.section,
        text: input.request.args.text,
      })
      return memberMemoryTextResult(
        true,
        JSON.stringify({
          created: result.created,
          document: result.document,
          memory: result.record,
        }),
      )
    }

    const result = await updateMemory(input.vaultRoot, {
      recordId: input.request.args.memoryId,
      section: input.request.args.section ?? null,
      text: input.request.args.text,
    })
    return memberMemoryTextResult(
      true,
      JSON.stringify({
        created: false,
        document: result.document,
        memory: result.record,
      }),
    )
  } catch {
    return memberMemoryTextResult(
      false,
      'member-memory maintenance could not be completed',
    )
  }
}

function memberMemoryTextResult(
  success: boolean,
  text: string,
): {
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
