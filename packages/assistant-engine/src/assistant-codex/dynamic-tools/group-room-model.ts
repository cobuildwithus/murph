import { z } from 'zod'

import type {
  AssistantHostedUserActionScope,
} from '../../assistant/hosted-tool-context.js'
import {
  ASSISTANT_GROUP_ROOM_MODEL_PAGE_MAX_BYTES,
  ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
  ASSISTANT_GROUP_ROOM_MODEL_SLUG,
  readAssistantGroupRoomModelState,
} from '../../assistant/group-room-model.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { upsertKnowledgePage } from '../../knowledge/service.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const groupRoomModelBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(ASSISTANT_GROUP_ROOM_MODEL_PAGE_MAX_BYTES)
  .refine(
    (body) =>
      new TextEncoder().encode(body).byteLength <=
        ASSISTANT_GROUP_ROOM_MODEL_PAGE_MAX_BYTES,
    { message: 'body exceeds the UTF-8 byte limit' },
  )

const groupRoomModelArgumentsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('show') }).strict(),
  z.object({
    action: z.literal('upsert'),
    body: groupRoomModelBodySchema,
  }).strict(),
])

export const MURPH_GROUP_ROOM_MODEL_TOOL = {
  namespace: 'murph',
  name: 'group_room_model',
  description:
    'Read or fully replace the one advisory room-model page for the current authenticated group chat. Use only for an explicit current-room request to remember, correct, retire, or forget social context. Show first, then upsert the complete compact Markdown page. If show fails, stop and do not upsert. This tool is unavailable in group email and never changes participant identity, permissions, health sharing, or personal memory.',
  inputSchema: z.toJSONSchema(groupRoomModelArgumentsSchema, { io: 'input' }),
} as const

type GroupRoomModelArguments = z.infer<
  typeof groupRoomModelArgumentsSchema
>

export type GroupRoomModelDynamicToolRequest =
  | {
      args: GroupRoomModelArguments
      kind: 'group-room-model'
    }
  | {
      kind: 'invalid-group-room-model-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readGroupRoomModelDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): GroupRoomModelDynamicToolRequest | null {
  if (input.tool !== MURPH_GROUP_ROOM_MODEL_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: groupRoomModelArgumentsSchema,
    schemaRootKeys: ['action', 'body'],
    toolName: 'murph.group_room_model',
    value: input.arguments,
  })

  return parsed.ok
    ? { args: parsed.args, kind: 'group-room-model' }
    : {
        kind: 'invalid-group-room-model-arguments',
        validationDigest: parsed.validationDigest,
      }
}

export async function executeGroupRoomModelDynamicTool(input: {
  available: boolean
  request: Extract<
    GroupRoomModelDynamicToolRequest,
    { kind: 'group-room-model' }
  >
  userActionScope: AssistantHostedUserActionScope | null
  vaultRoot: string | null
  readGroupRoomModelState?: typeof readAssistantGroupRoomModelState
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (
    !input.available ||
    input.userActionScope?.conversationScope !== 'group' ||
    input.userActionScope.acceptedInputIds.length === 0
  ) {
    return groupRoomModelTextResult(
      false,
      'group room-model updates are unavailable for this conversation',
    )
  }
  if (!input.vaultRoot) {
    return groupRoomModelTextResult(
      false,
      'group room-model updates require a vault',
    )
  }

  try {
    const state = await (
      input.readGroupRoomModelState ?? readAssistantGroupRoomModelState
    )({
      vaultRoot: input.vaultRoot,
    })
    if (state.kind === 'unavailable') {
      return groupRoomModelTextResult(
        false,
        'group room-model state could not be read; no update was made',
      )
    }

    if (input.request.args.action === 'show') {
      return groupRoomModelTextResult(
        true,
        JSON.stringify(
          state.kind === 'present'
            ? { body: state.body, status: state.status }
            : { body: null, status: 'missing' },
        ),
      )
    }

    await upsertKnowledgePage({
      body: input.request.args.body,
      pageType: ASSISTANT_GROUP_ROOM_MODEL_PAGE_TYPE,
      slug: ASSISTANT_GROUP_ROOM_MODEL_SLUG,
      status: 'active',
      title: 'Group room model',
      vault: input.vaultRoot,
    })
    return groupRoomModelTextResult(
      true,
      JSON.stringify({ status: 'updated' }),
    )
  } catch {
    return groupRoomModelTextResult(
      false,
      'group room-model update could not be completed',
    )
  }
}

function groupRoomModelTextResult(
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
