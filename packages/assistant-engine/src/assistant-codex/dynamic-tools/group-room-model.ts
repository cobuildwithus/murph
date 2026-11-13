import type { MurphDynamicToolExecutionResult } from '../dynamic-tools.js'
import { toolTextResult as groupRoomModelTextResult } from '../tool-failure-diagnostics.js'
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

/**
 * Upkeep rules for the optional `Photo references` subsection. They apply only
 * during silent room-model consolidation, so the consolidation prompt owns
 * them. Keeping them out of the tool description means ordinary group turns do
 * not pay for them.
 */
export const GROUP_ROOM_MODEL_PHOTO_REFERENCES_MAINTENANCE_GUIDANCE = [
  'The page may keep an optional `Photo references` subsection under `People` when supplied evidence explicitly associates a familiar conversational name with an exact `raw/captures/**` or `raw/inbox/**` image ref.',
  'Keep the exact ref and only the minimum multi-person disambiguator needed, such as "far left".',
  'Prefer `raw/captures/**`; for transient `raw/inbox/**` refs, also keep the evidence date and retire the entry after 14 days.',
  'Keep at most three useful non-duplicate refs per person, and prune contradicted or superseded entries.',
  'Never invent a ref or infer identity from facial similarity; use only explicit captions, positions, labels, and corrections.',
].join(' ')

const GROUP_ROOM_MODEL_TOOL_DESCRIPTION = [
  "Read, replace, or delete this group chat's room-model page, which holds Murph's rough notes about the room.",
  'On an ordinary turn, use it only when someone in the room asks Murph to remember, correct, or forget something about the room.',
  'That turn already has the current page, or a note that there is none, in context, so call show only to get the digest before a write.',
  'Pass that digest as expectedDigest to upsert or delete.',
  'upsert replaces the whole page: send the complete Markdown page, under 64 KiB, with no raw participant handles.',
  'If show fails or a write reports stale state, stop.',
  "This page never changes anyone's identity, permissions, health sharing, or personal memory.",
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
  /** Digest of the page body already in this turn's context, if any. */
  injectedDigest?: string | null
  request: Extract<
    GroupRoomModelDynamicToolRequest,
    { kind: 'group-room-model' }
  >
  userActionScope: AssistantHostedUserActionScope | null
  vaultRoot: string | null
  managedMaintenanceAuthorized?: boolean
  readGroupRoomModelState?: typeof readAssistantGroupRoomModelState
}): Promise<MurphDynamicToolExecutionResult> {
  if (
    input.managedMaintenanceAuthorized !== true &&
    (
      input.userActionScope?.conversationScope !== 'group' ||
      input.userActionScope.acceptedInputIds.length === 0
    )
  ) {
    return groupRoomModelTextResult(
      false,
      'group room-model updates are unavailable for this conversation',
      'authority_rejected',
    )
  }
  if (!input.vaultRoot) {
    return groupRoomModelTextResult(
      false,
      'group room-model updates require a vault',
      'unavailable',
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
        'unavailable',
      )
    }

    if (input.request.args.action === 'show') {
      // An ordinary group turn already carries the active page. While it is
      // unchanged, show returns only the digest a write needs, not a second
      // copy of the body that would stay in context for the rest of the turn.
      const bodyInContext = state.kind === 'present'
        && input.injectedDigest === state.digest
      return groupRoomModelTextResult(
        true,
        JSON.stringify(
          state.kind === 'present'
            ? {
                ...(bodyInContext ? { bodyInContext } : { body: state.body }),
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
        'authority_rejected',
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
  } catch (error) {
    return groupRoomModelTextResult(
      false,
      'group room-model update could not be completed',
      'handler_exception', error,
    )
  }
}
