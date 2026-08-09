import * as z from '@murphai/contracts/zod-runtime'

import type {
  AssistantHostedUserActionScope,
} from '../../assistant/hosted-tool-context.js'
import {
  deleteAssistantGroupRoomModel,
  readAssistantGroupRoomModelState,
  replaceAssistantGroupRoomModel,
} from '../../assistant/group-room-model.js'
import { assistantConversationHistoryUtf8Bytes } from '../../assistant/shared.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const groupRoomModelBodySchema = z
  .string()
  .trim()
  .min(1)

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

const GROUP_ROOM_MODEL_TOOL_DESCRIPTION = [
  'Read, fully replace, or delete the one advisory room-model page owned by the current authenticated group chat. Ordinary group turns may use it only for an explicit current-room request to remember, correct, retire, or forget social context; silent consolidation receives separate immutable automation authority.',
  'During engine-authorized silent consolidation, the page may keep an optional `Photo references` subsection under `People` when supplied evidence explicitly associates a familiar conversational name with an exact `raw/captures/**` or `raw/inbox/**` image ref. Keep the exact ref and only the minimum multi-person disambiguator needed, such as "far left". Prefer `raw/captures/**`; for transient `raw/inbox/**` refs, also keep the evidence date and retire the entry after 14 days. Keep at most three useful non-duplicate refs per person, and prune contradicted or superseded entries. Never invent a ref or infer identity from facial similarity; use only explicit captions, positions, labels, and corrections.',
  'For an ordinary image-generation or image-edit request involving a named person, check current attachments, recent visible conversation, and injected `Photo references` before asking for another upload. The current page or its runtime status is already injected into ordinary group turns, so do not call show merely to reread it. Use an exact usable ref when available. If a multi-person mapping is incomplete, ask only for the missing photo or position; ask for a new photo only when no usable ref exists. Current participant corrections override the page.',
  'Show first, then pass the returned expectedDigest to upsert or delete. Upsert must contain the complete compact Markdown page, must keep the serialized fixed page within its defensive 64 KiB file-read ceiling, and must not contain raw participant handles. If show fails or a write reports stale state, stop. This tool is unavailable in group email and never changes participant identity, permissions, health sharing, or personal memory.',
].join(' ')

export const MURPH_GROUP_ROOM_MODEL_TOOL = {
  namespace: 'murph',
  name: 'group_room_model',
  description: GROUP_ROOM_MODEL_TOOL_DESCRIPTION,
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
                bodyUtf8Bytes: assistantConversationHistoryUtf8Bytes(
                  state.body,
                ),
                digest: state.digest,
                status: state.status,
              }
            : {
                body: null,
                bodyUtf8Bytes: 0,
                digest: state.digest,
                status: 'missing',
              },
        ),
      )
    }

    if (
      input.request.args.action === 'upsert' &&
      input.managedMaintenanceAuthorized === true &&
      state.kind === 'present' &&
      state.status !== 'active'
    ) {
      return groupRoomModelTextResult(
        false,
        'silent maintenance must not reactivate inactive group room-model state; no update was made',
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
