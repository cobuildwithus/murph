import { createHash } from 'node:crypto'

import * as z from '@murphai/contracts/zod-runtime'
import {
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
const PHYSICAL_NOTE_RECOVERY_ARGUMENT_ROOT_KEYS = ['message_ref'] as const
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
}).strict()

export const MURPH_RESOLVE_PHYSICAL_NOTE_TOOL = {
  namespace: 'murph',
  name: 'resolve_physical_note',
  description: [
    'Read $MURPH_ASSISTANT_SKILLS_ROOT/physical-notes/SKILL.md before using this tool.',
    'Call exactly once only when a person explicitly asks to check, clear, resolve, or cancel an earlier unresolved physical-note submission.',
    'Supply the exact current Message ref that authorizes the check.',
    'This checks provider records and may safely clear a blocker; it never sends a new note or recalls an accepted one.',
    'Report accepted, clear, pending, permission_denied, or unavailable literally. Never retry automatically.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description:
          'Exact current Message ref explicitly authorizing this recovery check.',
      },
    },
    required: ['message_ref'],
  },
} as const

export const MURPH_SEND_PHYSICAL_NOTE_TOOL = {
  namespace: 'murph',
  name: 'send_physical_note',
  description: [
    'Before creating or mailing a physical note, read $MURPH_ASSISTANT_SKILLS_ROOT/physical-notes/SKILL.md.',
    'On a trusted hosted image-completion turn whose generation was launched with the exact authorizing message_ref, omit image_ref, image_sha256, and message_ref so runtime code binds the exact generated image and request automatically.',
    'When a generated note was intentionally shown first and a person later says to send it, provide the exact image_ref and image_sha256 from that trusted completion plus the exact message_ref approving the send in the current turn. Runtime code re-reads and verifies the private vault bytes and exact accepted input.',
    'Before treating omitted city, state, or ZIP fields as an incomplete address, follow the skill\'s narrow temporary address-resolution step. Lookup results complete a destination only; they never identify a recipient or authorize a send.',
    'When the originating user already explicitly asked Murph to mail the note and supplied a complete or reliably resolved US address, call this tool automatically after generation finishes; showing or attaching the image first is optional, not required.',
    "The server supplies Murph's fixed return address. Never ask the person for a return address, invent one, or include one in the tool arguments or artwork.",
    'Do not call for a draft-only request, an unresolved or ambiguous address, bulk mail, an international address, impersonation, threats, harassment, fraud, or illegal content.',
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
        description:
          "One recipient address only. Trusted server code supplies Murph's fixed return address.",
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

export type PhysicalNoteDynamicToolRequest =
  | {
      kind: 'resolve-physical-note'
      messageRef: string
    }
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
    return parsed.ok
      ? {
          kind: 'resolve-physical-note',
          messageRef: parsed.args.message_ref,
        }
      : {
          kind: 'invalid-physical-note-arguments',
          validationDigest: parsed.validationDigest,
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
  const digest = createHash('sha256')
    .update(JSON.stringify({
      originAssistantInputId: input.originAssistantInputId,
      schema: 'murph.send-physical-note.request-key.v2',
    }))
    .digest('hex')
  return `physical_note_${digest}`
}

export function buildPhysicalNoteFailureInstruction(
  reason: HostedPhysicalNoteFailureReason | null | undefined,
): string {
  switch (reason) {
    case 'recipient_address':
      return 'The printer could not verify or accept the recipient address. Nothing was sent. Ask the person to check the street and unit, city, state, and ZIP before making a new explicit send request. Do not retry automatically.'
    case 'artwork':
      return 'The printer could not render the generated artwork. Nothing was sent. Explain that Murph needs to regenerate the image, and require a new explicit send request before trying again. Do not retry automatically.'
    case 'service_unavailable':
      return 'Murph\'s printing service or account setup was unavailable. Nothing was sent. Explain that the problem is on Murph\'s side, not the recipient address. No automatic retry or follow-up is running; another attempt requires a new explicit send request later. Do not retry automatically.'
    case 'request_invalid':
      return 'The printer rejected Murph\'s print request. Nothing was sent. Explain that Murph needs to correct the printing request. Do not ask the person to change a confirmed address. No automatic retry or follow-up is running; another attempt requires a new explicit send request later. Do not retry automatically.'
    case 'prior_note_unresolved':
      return 'An earlier physical-note submission is still unresolved, so the current physical-note request was not sent. Tell the person both facts without claiming the earlier and current requests share a recipient. No automatic investigation, retry, notification, or follow-up is running. A later explicit physical-note request may recheck the earlier outcome, but do not send while it remains unresolved. Do not retry automatically.'
    case 'prior_note_accepted':
      return 'An earlier physical note was accepted for printing, so the current physical-note request was not sent. Tell the person both facts without claiming the earlier and current requests share a recipient. No automatic retry, notification, or follow-up is running. Do not retry automatically; that applies only to this request. A separately authorized future request is distinct.'
    case 'unknown':
    case null:
    case undefined:
      return 'Murph could not complete the physical-note request with a recognized safe correction. Nothing was sent for this request. Do not guess that the address or artwork was wrong. Explain that Murph needs to investigate. No automatic retry or follow-up is running; another attempt requires a new explicit send request later. Do not retry automatically.'
  }
}
