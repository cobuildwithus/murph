import { createHash } from 'node:crypto'

import { z } from 'zod'
import {
  hostedPhysicalNoteRecipientSchema,
  normalizeHostedPhysicalNoteRecipient,
  type HostedPhysicalNoteRecipient,
} from '@murphai/hosted-execution/physical-notes'

import type {
  AssistantConversationScope,
} from '../../assistant/conversation-policy.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const PHYSICAL_NOTE_ARGUMENT_ROOT_KEYS = [
  'image_ref',
  'image_sha256',
  'message_ref',
  'to',
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
    state: z.string().trim().length(2),
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

export const MURPH_SEND_PHYSICAL_NOTE_TOOL = {
  namespace: 'murph',
  name: 'send_physical_note',
  description: [
    'Before creating or mailing a physical note, read $MURPH_ASSISTANT_SKILLS_ROOT/physical-notes/SKILL.md.',
    'On a trusted hosted image-completion turn whose generation was launched with the exact authorizing message_ref, omit image_ref, image_sha256, and message_ref so runtime code binds the exact generated image and request automatically.',
    'When a generated note was intentionally shown first and a person later says to send it, provide the exact image_ref and image_sha256 from that trusted completion plus the exact message_ref approving the send in the current turn. Runtime code re-reads and verifies the private vault bytes and exact accepted input.',
    'When the originating user already explicitly asked Murph to mail the note and supplied a complete US address, call this tool automatically after generation finishes; showing or attaching the image first is optional, not required.',
    'Do not call for a draft-only request, an incomplete address, bulk mail, an international address, impersonation, threats, harassment, fraud, or illegal content.',
    'The server decides whether the note is complimentary and computes any Murph-time cost. Never claim acceptance until this tool reports accepted.',
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
          'Optional exact private vault image ref from an earlier trusted hosted image completion. Omit on the completion turn. Supply only together with image_sha256 after a later explicit send request.',
      },
      image_sha256: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
        description:
          'Optional exact SHA-256 paired with image_ref from an earlier trusted hosted image completion.',
      },
      message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description:
          'Exact current Message ref approving a later send of previously previewed artwork. Required whenever image_ref and image_sha256 are supplied; omit on the automatic image-completion turn.',
      },
      to: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 40 },
          address_line1: { type: 'string', minLength: 1, maxLength: 64 },
          address_line2: { type: 'string', minLength: 1, maxLength: 64 },
          city: { type: 'string', minLength: 1, maxLength: 200 },
          state: { type: 'string', minLength: 2, maxLength: 2 },
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

export type PhysicalNoteDynamicToolRequest =
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
  const recipient = normalizeHostedPhysicalNoteRecipient({
    addressLine1: parsed.args.to.address_line1,
    ...(parsed.args.to.address_line2
      ? { addressLine2: parsed.args.to.address_line2 }
      : {}),
    city: parsed.args.to.city,
    name: parsed.args.to.name,
    postalCode: parsed.args.to.postal_code,
    state: parsed.args.to.state.toUpperCase(),
  })
  hostedPhysicalNoteRecipientSchema.parse(recipient)
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
  const digest = createHash('sha256')
    .update(JSON.stringify({
      originAssistantInputId: input.originAssistantInputId,
      schema: 'murph.send-physical-note.request-key.v2',
    }))
    .digest('hex')
  return `physical_note_${digest}`
}
