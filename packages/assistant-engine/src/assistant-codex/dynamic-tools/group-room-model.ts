import { z } from 'zod'

import type {
  AssistantHostedUserActionScope,
} from '../../assistant/hosted-tool-context.js'
import {
  ASSISTANT_GROUP_ROOM_MODEL_PAGE_MAX_BYTES,
  deleteAssistantGroupRoomModel,
  readAssistantGroupRoomModelState,
  replaceAssistantGroupRoomModel,
} from '../../assistant/group-room-model.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
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
    expectedDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
  z.object({
    action: z.literal('delete'),
    expectedDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
])

export const MURPH_GROUP_ROOM_MODEL_TOOL = {
  namespace: 'murph',
  name: 'group_room_model',
  description:
    'Read, fully replace, or delete the one advisory room-model page owned by the current authenticated group chat. Ordinary group turns may use it only for an explicit current-room request to remember, correct, retire, or forget social context; silent consolidation receives separate immutable automation authority. Show first, then pass the returned expectedDigest to upsert or delete. Upsert must contain the complete compact Markdown page, must fit the complete advisory prompt, and must not contain raw participant handles. If show fails or a write reports stale state, stop. This tool is unavailable in group email and never changes participant identity, permissions, health sharing, or personal memory.',
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
    schemaRootKeys: ['action', 'body', 'expectedDigest'],
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
  managedMaintenanceAuthorized?: boolean
  readGroupRoomModelState?: typeof readAssistantGroupRoomModelState
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (
    !input.available ||
    (
      input.managedMaintenanceAuthorized !== true &&
      (
        input.userActionScope?.conversationScope !== 'group' ||
        input.userActionScope.acceptedInputIds.length === 0
      )
    )
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
            ? {
                body: state.body,
                digest: state.digest,
                status: state.status,
              }
            : {
                body: null,
                digest: state.digest,
                status: 'missing',
              },
        ),
      )
    }

    if (input.request.args.action === 'delete') {
      await deleteAssistantGroupRoomModel({
        expectedDigest: input.request.args.expectedDigest,
        vaultRoot: input.vaultRoot,
      })
      return groupRoomModelTextResult(
        true,
        JSON.stringify({ status: 'deleted' }),
      )
    }

    await replaceAssistantGroupRoomModel({
      body: input.request.args.body,
      expectedDigest: input.request.args.expectedDigest,
      vaultRoot: input.vaultRoot,
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
