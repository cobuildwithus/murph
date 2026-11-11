import * as z from '@murphai/contracts/zod-runtime'
import {
  createHostedPhysicalNoteRequestKey,
  normalizeHostedPhysicalNoteRecipient,
  type HostedPhysicalNoteFailureReason,
  type HostedPhysicalNoteRecipient,
} from '@murphai/hosted-execution/physical-notes'

import type {
  AssistantConversationScope,
} from '../../assistant/conversation-policy.js'
import {
  buildSafeToolCallValidationDigest,
  type SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const PHYSICAL_NOTE_ARGUMENT_ROOT_KEYS = [
  'image_ref',
  'image_sha256',
  'message_ref',
  'to',
] as const
const PHYSICAL_NOTE_RECOVERY_ARGUMENT_ROOT_KEYS = [
  'message_ref',
  'target_kind',
  'target_message_ref',
] as const
const ACCEPTED_INPUT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u

const physicalNoteArgumentsSchema = z.object({
  image_ref: z.string().trim().min(1).max(1024).optional(),
  image_sha256: z.string().trim().regex(/^[0-9a-f]{64}$/u).optional(),
  message_ref: z.string().trim().regex(ACCEPTED_INPUT_ID_PATTERN).optional(),
  to: z.object({
    address_line1: z.string().trim().min(1).max(64),
    address_line2: z.string().trim().min(1).max(64).optional(),
    city: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(40),
    postal_code: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/u),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/u),
  }).strict(),
}).strict().superRefine((value, context) => {
  if ((value.image_ref === undefined) !== (value.image_sha256 === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'image_ref and image_sha256 must be supplied together.',
      path: ['image_ref'],
    })
  }
  if (value.message_ref !== undefined && value.image_ref === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'message_ref is only valid with an earlier generated image.',
      path: ['message_ref'],
    })
  }
  if (value.image_ref !== undefined && value.message_ref === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'message_ref is required with an earlier generated image.',
      path: ['message_ref'],
    })
  }
})

const physicalNoteRecoveryArgumentsSchema = z.object({
  message_ref: z.string().trim().regex(ACCEPTED_INPUT_ID_PATTERN),
  target_kind: z.enum(['recovery', 'send']).optional(),
  target_message_ref: z
    .string()
    .trim()
    .regex(ACCEPTED_INPUT_ID_PATTERN)
    .optional(),
}).strict().superRefine((value, context) => {
  if ((value.target_kind === undefined) !== (value.target_message_ref === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'target_kind and target_message_ref must be supplied together.',
      path: value.target_kind === undefined ? ['target_kind'] : ['target_message_ref'],
    })
  }
})

export const MURPH_RESOLVE_PHYSICAL_NOTE_TOOL = {
  namespace: 'murph',
  name: 'resolve_physical_note',
  deferLoading: true,
  description: [
    'Check one earlier physical-note submission whose outcome is unknown, when the person asks to check, clear, or cancel it.',
    'Read $MURPH_ASSISTANT_SKILLS_ROOT/physical-notes/SKILL.md first.',
    "Pass the current request's Message ref as message_ref. When you know which earlier send or recovery it concerns, also pass target_message_ref and target_kind.",
    'This reads printer records and may clear a blocker. It never sends a new note and never recalls an accepted one.',
    'Call it once per request, and report the returned status and remainingUnresolved as given.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description:
          'Message ref of the current request asking for this check.',
      },
      target_message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description:
          'Message ref of the earlier send or recovery result being checked. It only identifies the target.',
      },
      target_kind: {
        type: 'string',
        enum: ['send', 'recovery'],
        description:
          'Required with target_message_ref. Use send for an original physical-note send and recovery for an earlier resolve_physical_note result.',
      },
    },
    required: ['message_ref'],
  },
} as const

export const MURPH_SEND_PHYSICAL_NOTE_TOOL = {
  namespace: 'murph',
  name: 'send_physical_note',
  deferLoading: true,
  description: [
    'Mail one printed note to one US address, using artwork from murph.generate_image.',
    'Read $MURPH_ASSISTANT_SKILLS_ROOT/physical-notes/SKILL.md first. It owns address lookup, artwork, and how to report results.',
    'When the user already asked to mail the note and the address is complete or resolved, call this on the image-completion turn with only `to`. The runtime binds the generated image and the request.',
    "To send artwork that was shown first and approved in a later message, also pass image_ref and image_sha256 from that image completion and the approving message's Message ref as message_ref.",
    "The server adds Murph's return address, so never ask for one or pass one.",
    'Say the note is headed to print only after this tool returns accepted.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      image_ref: {
        type: 'string',
        minLength: 1,
        maxLength: 1024,
        description:
          'Vault image ref from an earlier image completion. Omit it on the image-completion turn. Pass it with image_sha256 and message_ref when sending artwork approved in a later message.',
      },
      image_sha256: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
        description:
          'SHA-256 returned with image_ref by that image completion.',
      },
      message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description:
          'Message ref of the current message approving the send of artwork shown earlier. Required with image_ref and image_sha256. Omit it on the image-completion turn.',
      },
      to: {
        type: 'object',
        additionalProperties: false,
        description:
          'The one recipient address.',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 40 },
          address_line1: { type: 'string', minLength: 1, maxLength: 64 },
          address_line2: { type: 'string', minLength: 1, maxLength: 64 },
          city: { type: 'string', minLength: 1, maxLength: 200 },
          state: { type: 'string', pattern: '^[A-Za-z]{2}$' },
          postal_code: {
            type: 'string',
            pattern: '^\\d{5}(?:-\\d{4})?$',
          },
        },
        required: ['name', 'address_line1', 'city', 'state', 'postal_code'],
      },
    },
    required: ['to'],
  },
} as const

type PhysicalNoteRecoveryDynamicToolRequest =
  | {
      kind: 'resolve-physical-note'
      messageRef: string
      targetKind: 'recovery' | 'send'
      targetMessageRef: string
    }
  | {
      kind: 'resolve-physical-note'
      messageRef: string
      targetKind?: undefined
      targetMessageRef?: undefined
    }

export type PhysicalNoteDynamicToolRequest =
  | PhysicalNoteRecoveryDynamicToolRequest
  | {
      imageRef?: string
      imageSha256?: string
      kind: 'send-physical-note'
      messageRef?: string
      recipient: HostedPhysicalNoteRecipient
    }
  | {
      kind: 'invalid-physical-note-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readPhysicalNoteDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): PhysicalNoteDynamicToolRequest | null {
  if (input.tool === MURPH_RESOLVE_PHYSICAL_NOTE_TOOL.name) {
    const parsed = parseDynamicToolArguments({
      schema: physicalNoteRecoveryArgumentsSchema,
      schemaRootKeys: PHYSICAL_NOTE_RECOVERY_ARGUMENT_ROOT_KEYS,
      toolName: 'murph.resolve_physical_note',
      value: input.arguments,
    })
    if (!parsed.ok) {
      return {
        kind: 'invalid-physical-note-arguments',
        validationDigest: parsed.validationDigest,
      }
    }
    if (parsed.args.target_message_ref) {
      return {
        kind: 'resolve-physical-note',
        messageRef: parsed.args.message_ref,
        targetKind: parsed.args.target_kind!,
        targetMessageRef: parsed.args.target_message_ref,
      }
    }
    return {
      kind: 'resolve-physical-note',
      messageRef: parsed.args.message_ref,
    }
  }
  if (input.tool !== MURPH_SEND_PHYSICAL_NOTE_TOOL.name) {
    return null
  }
  const parsed = parseDynamicToolArguments({
    schema: physicalNoteArgumentsSchema,
    schemaRootKeys: PHYSICAL_NOTE_ARGUMENT_ROOT_KEYS,
    toolName: 'murph.send_physical_note',
    value: input.arguments,
  })
  if (!parsed.ok) {
    return {
      kind: 'invalid-physical-note-arguments',
      validationDigest: parsed.validationDigest,
    }
  }
  // Model arguments stay untrusted after the schema parse above; a hosted
  // recipient-normalization failure must degrade to the same safe digest
  // result instead of throwing into the codex stdout listener.
  let recipient: HostedPhysicalNoteRecipient
  try {
    recipient = normalizeHostedPhysicalNoteRecipient({
      addressLine1: parsed.args.to.address_line1,
      ...(parsed.args.to.address_line2
        ? { addressLine2: parsed.args.to.address_line2 }
        : {}),
      city: parsed.args.to.city,
      name: parsed.args.to.name,
      postalCode: parsed.args.to.postal_code,
      state: parsed.args.to.state.toUpperCase(),
    })
  } catch (error) {
    return {
      kind: 'invalid-physical-note-arguments',
      validationDigest: buildSafeToolCallValidationDigest({
        error,
        rawInput: input.arguments,
        requestedToolName: 'murph.send_physical_note',
        schemaName: 'murph.send_physical_note.recipient',
        schemaRootKeys: PHYSICAL_NOTE_ARGUMENT_ROOT_KEYS,
        toolName: 'murph.send_physical_note',
      }),
    }
  }
  return {
    ...(parsed.args.image_ref && parsed.args.image_sha256
      ? {
          imageRef: parsed.args.image_ref,
          imageSha256: parsed.args.image_sha256,
        }
      : {}),
    kind: 'send-physical-note',
    ...(parsed.args.message_ref
      ? { messageRef: parsed.args.message_ref }
      : {}),
    recipient,
  }
}

export function resolvePhysicalNoteExplicitOriginInputId(input: {
  acceptedInputIds: readonly string[]
  conversationScope: AssistantConversationScope
  messageRef?: string
}): string | null {
  if (input.conversationScope === 'unverified-external') {
    return null
  }
  return input.messageRef
    && input.acceptedInputIds.includes(input.messageRef)
    ? input.messageRef
    : null
}

export function createPhysicalNoteRequestKey(input: {
  originAssistantInputId: string
}): string {
  return createHostedPhysicalNoteRequestKey(input)
}

export function buildPhysicalNoteFailureInstruction(
  reason: HostedPhysicalNoteFailureReason | null | undefined,
): string {
  switch (reason) {
    case 'recipient_address':
      return 'The printer could not verify or accept the recipient address, so nothing was sent. Ask the person to check the street and unit, city, state, and ZIP. Sending again needs a new request from them, and nothing retries on its own.'
    case 'artwork':
      return 'The printer could not render the generated artwork, so nothing was sent. Tell the person Murph needs to regenerate the image. Sending again needs a new request from them, and nothing retries on its own.'
    case 'service_unavailable':
      return "Murph's printing service or account setup was unavailable, so nothing was sent. Tell the person the problem is on Murph's side and the recipient address was not the cause. Nothing retries or follows up on its own, and another attempt needs a new request from them later."
    case 'request_invalid':
      return "The printer rejected Murph's print request, so nothing was sent. Tell the person Murph needs to correct the printing request, and do not ask them to change a confirmed address. Nothing retries or follows up on its own, and another attempt needs a new request from them later."
    case 'prior_note_unresolved':
      return 'An earlier physical-note submission is still unresolved, so the current physical-note request was not sent. Tell the person both facts without claiming the earlier and current requests share a recipient. Nothing investigates, retries, notifies, or follows up on its own. A later explicit physical-note request may recheck the earlier outcome, and no note can be sent while it stays unresolved.'
    case 'prior_note_accepted':
      return 'An earlier physical note was accepted for printing, so the current physical-note request was not sent. Tell the person both facts without claiming the earlier and current requests share a recipient. Nothing retries, notifies, or follows up on its own. This request is finished. A future request from the person is a separate note.'
    case 'unknown':
    case null:
    case undefined:
      return 'Murph could not complete the physical-note request and has no known safe correction. Nothing was sent for this request. Do not guess that the address or artwork was wrong. Tell the person Murph needs to investigate. Nothing retries or follows up on its own, and another attempt needs a new request from them later.'
  }
}
