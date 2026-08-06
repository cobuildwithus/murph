import { readFile, writeFile } from 'node:fs/promises'

async function read(path) {
  return await readFile(path, 'utf8')
}

async function write(path, text) {
  await writeFile(path, text, 'utf8')
}

function replaceOnce(text, search, replacement, label) {
  const index = text.indexOf(search)
  if (index < 0) {
    throw new Error(`missing ${label}`)
  }
  if (text.indexOf(search, index + search.length) >= 0) {
    throw new Error(`multiple matches for ${label}`)
  }
  return text.slice(0, index) + replacement + text.slice(index + search.length)
}

function replaceBetween(text, start, end, replacement, label) {
  const startIndex = text.indexOf(start)
  if (startIndex < 0) {
    throw new Error(`missing start for ${label}`)
  }
  const endIndex = text.indexOf(end, startIndex + start.length)
  if (endIndex < 0) {
    throw new Error(`missing end for ${label}`)
  }
  if (text.indexOf(start, startIndex + start.length) >= 0) {
    throw new Error(`multiple starts for ${label}`)
  }
  return text.slice(0, startIndex) + replacement + text.slice(endIndex)
}

const dynamicToolsPath = 'packages/assistant-engine/src/assistant-codex/dynamic-tools.ts'
let dynamicTools = await read(dynamicToolsPath)
dynamicTools = replaceOnce(
  dynamicTools,
  `import {\n  readAssistantHostedImageCompletion,\n} from '../assistant/hosted-image-completion.js'\n`,
  '',
  'hosted image completion import',
)
dynamicTools = dynamicTools.replace(
  'Hosted runs start generation in the background and return immediately; when generation finishes, private media is provided in a later trusted system input. Local runs remain synchronous and also save the image under CODEX_HOME/generated_images.',
  'Image generation completes inside the active tool call. Hosted runs return an exact private vault_image descriptor that can be passed unchanged to murph.attach_response_media or another compatible tool in the same turn; local runs save the image under CODEX_HOME/generated_images.',
)
const generateImageCase = `    case 'generate-image': {
      if (input.currentResponseCard !== null && input.currentResponseCard !== undefined) {
        return toolTextResult(false, 'image generation cannot be combined with a response card')
      }
      if (hasVoiceMemoResponseMedia(input.currentResponseMedia ?? [])) {
        return toolTextResult(false, 'image generation cannot be combined with a voice memo')
      }

      const captureIdempotencyKey = buildGeneratedImageCaptureIdempotencyKey({
        toolCallId: readGeneratedImageToolCallId(input.request),
        scope: 'generate-image',
      })
      const userActionScope =
        input.hostedToolContext?.currentUserActionScope?.() ?? null
      const explicitOriginAssistantInputId = input.request.messageRef
        && userActionScope?.acceptedInputIds.includes(input.request.messageRef)
        ? await authorizeDynamicToolEffectOrigin({
            authorizer: input.authorizeAcceptedMessageTarget ?? null,
            conversationScope: userActionScope.conversationScope,
            deliveryContextOrdinal: input.deliveryContextOrdinal ?? null,
            messageRef: input.request.messageRef,
          })
        : null
      if (input.request.messageRef && !explicitOriginAssistantInputId) {
        return toolTextResult(
          false,
          'image generation for a later irreversible effect requires the exact accepted Message ref authorizing that effect',
        )
      }

      const result = await executeGenerateImageTool({
        abortSignal: input.abortSignal ?? null,
        args: input.request.args,
        captureIdempotencyKey,
        codexHome: input.codexHome ?? null,
        env: input.env,
        fetchImpl: input.fetchImpl,
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
        persistGeneratedImageCapture:
          input.hostedToolContext?.persistGeneratedImageCapture ?? null,
        providerRequestOrdinal: input.nextUsageOrdinal(),
        requireHostedPrivateImageDelivery:
          input.requireHostedPrivateImageDelivery ?? false,
        vaultRoot: input.vaultRoot ?? null,
      })
      return {
        rpcResult: {
          success: result.rpcSuccess,
          contentItems: [
            {
              type: 'inputText',
              text: result.rpcText,
            },
          ],
        },
        usageDraft: result.usageDraft ?? null,
      }
    }
`
dynamicTools = replaceBetween(
  dynamicTools,
  `    case 'generate-image': {`,
  `    case 'generate-voice-memo': {`,
  generateImageCase,
  'generate-image case',
)
const physicalNoteCase = `    case 'send-physical-note': {
      const hostedToolContext = input.hostedToolContext ?? null
      const physicalNotes = hostedToolContext?.physicalNotes ?? null
      const publisher = hostedToolContext?.privateImageUrlPublisher ?? null
      const vaultRoot = input.vaultRoot?.trim() ?? ''
      if (!hostedToolContext || !physicalNotes || !publisher || !vaultRoot) {
        return toolTextResult(
          false,
          'physical-note sending is unavailable without hosted mail transport and the owning vault',
        )
      }

      const userActionScope =
        hostedToolContext.currentUserActionScope?.() ?? null
      const originCandidate = userActionScope
        ? resolvePhysicalNoteExplicitOriginInputId({
            acceptedInputIds: userActionScope.acceptedInputIds,
            conversationScope: userActionScope.conversationScope,
            messageRef: input.request.messageRef,
          })
        : null
      const originAssistantInputId = originCandidate && userActionScope
        ? await authorizeDynamicToolEffectOrigin({
            authorizer: input.authorizeAcceptedMessageTarget ?? null,
            conversationScope: userActionScope.conversationScope,
            deliveryContextOrdinal: input.deliveryContextOrdinal ?? null,
            messageRef: originCandidate,
          })
        : null
      if (
        !originAssistantInputId
        || !input.request.imageRef.startsWith('raw/captures/')
      ) {
        return toolTextResult(
          false,
          'physical-note sending requires the exact generated-image ref and SHA-256 plus the exact accepted Message ref authorizing this send',
        )
      }

      let artwork: ResolvedGenerateImageReference
      try {
        const [resolvedArtwork] = await resolveGenerateImageReferences({
          materializeWorkspaceArtifacts:
            input.materializeWorkspaceArtifacts ?? null,
          refs: [input.request.imageRef],
          vaultRoot,
        })
        if (
          !resolvedArtwork
          || resolvedArtwork.sha256 !== input.request.imageSha256
        ) {
          return toolTextResult(
            false,
            'the selected physical-note artwork no longer matches its trusted saved image',
          )
        }
        artwork = resolvedArtwork
      } catch {
        return toolTextResult(
          false,
          'the selected physical-note artwork could not be read from the private vault',
        )
      }

      let published: Awaited<
        ReturnType<typeof publisher.publishPrivateImageUrl>
      >
      try {
        published = await publisher.publishPrivateImageUrl({
          bytes: artwork.bytes,
          contentType: artwork.mediaType,
        })
      } catch {
        return toolTextResult(
          false,
          'the physical-note artwork could not be prepared for private printing',
        )
      }

      try {
        const result = await physicalNotes.send({
          artwork: {
            expiresAt: published.expiresAt,
            sha256: artwork.sha256,
            url: published.url,
          },
          originAssistantInputId,
          recipient: input.request.recipient,
          requestKey: createPhysicalNoteRequestKey({ originAssistantInputId }),
        }, {
          signal: input.abortSignal ?? null,
        })
        switch (result.status) {
          case 'accepted':
            return toolTextResult(
              true,
              JSON.stringify({
                complimentary: result.complimentary,
                costUsdMicros: result.costUsdMicros,
                note:
                  'Lob accepted the exact generated artwork for printing. Say it is headed to print, not delivered.',
                physicalNoteId: result.physicalNoteId,
                status: result.status,
              }),
            )
          case 'pending':
            return toolTextResult(
              true,
              JSON.stringify({
                note:
                  'The provider outcome is not certain. Do not retry this note automatically or claim that it was mailed.',
                physicalNoteId: result.physicalNoteId,
                status: result.status,
              }),
            )
          case 'insufficient_usage':
            return toolTextResult(
              false,
              JSON.stringify({
                costUsdMicros: result.costUsdMicros,
                note:
                  'The complimentary note was already used and this conversation does not currently have enough Murph time for the configured print-and-mail cost.',
                status: result.status,
              }),
            )
          case 'permission_denied':
            return toolTextResult(
              false,
              JSON.stringify({
                note:
                  'The physical note was not sent because this action is not available to the current participant right now.',
                status: result.status,
              }),
            )
          case 'unavailable':
            return toolTextResult(
              false,
              JSON.stringify({
                note:
                  'Physical-note mailing is currently unavailable, so nothing was sent. Do not regenerate the artwork or retry automatically.',
                status: result.status,
              }),
            )
          case 'failed':
            return toolTextResult(
              false,
              'The physical note was not accepted for printing.',
            )
        }
      } catch {
        return toolTextResult(
          false,
          JSON.stringify({
            note:
              'Murph could not confirm whether this physical note was accepted. Do not regenerate or retry it automatically, and do not claim that it was mailed.',
            status: 'pending',
          }),
        )
      }
    }
`
dynamicTools = replaceBetween(
  dynamicTools,
  `    case 'send-physical-note': {`,
  `    case 'create-phone-call': {`,
  physicalNoteCase,
  'send-physical-note case',
)
await write(dynamicToolsPath, dynamicTools)

const generateToolPath = 'packages/assistant-engine/src/assistant-codex/generate-image-tool.ts'
let generateTool = await read(generateToolPath)
const privateDeliveryStart = `  if (requireHostedPrivateImageDelivery) {`
const privateDeliveryEnd = `\n\n  try {\n    const localPath = await writeLocalGeneratedImage({`
const privateDeliveryBlock = `  if (requireHostedPrivateImageDelivery) {
    if (!savedCapture) {
      return {
        rpcSuccess: false,
        rpcText: 'image generated but private vault capture failed',
        usageDraft,
      }
    }
    const media: AssistantResponseMedia = {
      alt: input.args.alt ?? 'Generated image',
      contentType: generatedImageContentType(input.args.outputFormat),
      filename: path.posix.basename(savedCapture.imageRef),
      kind: 'vault_image',
      ref: savedCapture.imageRef,
      sha256: createHash('sha256').update(generatedImageBytes).digest('hex'),
      sizeBytes: generatedImageBytes.byteLength,
      source: OPENAI_IMAGE_GENERATION_MODEL,
    }
    return {
      responseMedia: [media],
      rpcSuccess: true,
      rpcText: JSON.stringify({
        image: media,
        status: 'ready',
      }),
      savedCaptureId: savedCapture.captureId,
      savedImageRef: savedCapture.imageRef,
      usageDraft,
    }
  }`
generateTool = replaceBetween(
  generateTool,
  privateDeliveryStart,
  privateDeliveryEnd,
  privateDeliveryBlock,
  'hosted private image result',
)
await write(generateToolPath, generateTool)

const physicalToolPath = 'packages/assistant-engine/src/assistant-codex/dynamic-tools/physical-notes.ts'
await write(physicalToolPath, `import { createHash } from 'node:crypto'

import { z } from 'zod'
import {
  normalizeHostedPhysicalNoteRecipient,
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
const ACCEPTED_INPUT_ID_PATTERN = /^ain_[0-9a-f]{32}$/u

const physicalNoteArgumentsSchema = z.object({
  image_ref: z.string().trim().min(1).max(1024),
  image_sha256: z.string().trim().regex(/^[0-9a-f]{64}$/u),
  message_ref: z.string().trim().regex(ACCEPTED_INPUT_ID_PATTERN),
  to: z.object({
    address_line1: z.string().trim().min(1).max(64),
    address_line2: z.string().trim().min(1).max(64).optional(),
    city: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(40),
    postal_code: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/u),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/u),
  }).strict(),
}).strict()

export const MURPH_SEND_PHYSICAL_NOTE_TOOL = {
  namespace: 'murph',
  name: 'send_physical_note',
  description: [
    'Before creating or mailing a physical note, read $MURPH_ASSISTANT_SKILLS_ROOT/physical-notes/SKILL.md.',
    'Provide the exact vault_image ref and SHA-256 returned by murph.generate_image, plus the exact accepted Message ref authorizing this send. Runtime code re-reads and verifies the private vault bytes before mailing.',
    'Before treating omitted city, state, or ZIP fields as an incomplete address, follow the skill\'s narrow temporary address-resolution step. Lookup results complete a destination only; they never identify a recipient or authorize a send.',
    'When the originating user explicitly asked Murph to mail the note and supplied a complete or reliably resolved US address, call this tool in the same turn after generation finishes. Attach the artwork only when the person asked to see it.',
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
          'Exact private vault image ref returned by murph.generate_image. Never invent or alter it.',
      },
      image_sha256: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
        description:
          'Exact SHA-256 paired with image_ref by murph.generate_image.',
      },
      message_ref: {
        type: 'string',
        pattern: '^ain_[0-9a-f]{32}$',
        description:
          'Exact accepted Message ref authorizing this physical-note send in the current turn.',
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
    required: ['image_ref', 'image_sha256', 'message_ref', 'to'],
  },
} as const

export type PhysicalNoteDynamicToolRequest =
  | {
      imageRef: string
      imageSha256: string
      kind: 'send-physical-note'
      messageRef: string
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
    imageRef: parsed.args.image_ref,
    imageSha256: parsed.args.image_sha256,
    kind: 'send-physical-note',
    messageRef: parsed.args.message_ref,
    recipient,
  }
}

export function resolvePhysicalNoteExplicitOriginInputId(input: {
  acceptedInputIds: readonly string[]
  conversationScope: AssistantConversationScope
  messageRef: string
}): string | null {
  if (input.conversationScope === 'unverified-external') {
    return null
  }
  return input.acceptedInputIds.includes(input.messageRef)
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
`)

const skillPath = 'packages/assistant-engine/skills/physical-notes/SKILL.md'
await write(skillPath, `---
name: physical-notes
description: Generate and mail one expressive full-page Murph note through the existing image and physical-note tools.
---

# Physical notes

Use this flow only when a person explicitly wants Murph to send a real note in
the mail. The product is one US-only, one-artwork-page, color First Class note.

## Resolve before asking

Identify one recipient name, the US street address the person supplied, and
enough intent to make the note. Do not treat an address as incomplete merely
because city, state, or ZIP were omitted.

Before asking for an objective missing address component, run
\`vault-cli route resolve-address "<address>" --country US --format json\`. This
is a narrow temporary Mapbox lookup for completing the destination the person
already supplied. Use \`recommendedCandidate\` only when it is non-null; it means
one strong candidate preserved the supplied house number and street and supplied
all US mailing fields. Otherwise ask one concise question about the unresolved
delivery-critical detail. Never use address lookup to discover where a person
lives, choose among genuinely ambiguous people or destinations, or infer send
authority.

A clear request to send a thank-you, congratulations, apology, or similar note
already asks Murph to draft fitting short copy. Use a signature the requester
explicitly supplied or that is already established in their private direct
context; otherwise omit it unless the note genuinely needs one. In a group,
never use a room display label or another participant's identity as authorship
proof. Do not ask whether Murph should draft the note. Ask about content only
when the intended sender, relationship, signature, or message meaning is
materially ambiguous.

## Compose with the existing primitives

1. Confirm the recipient address is complete as supplied or safely resolved and
   the request contains enough intent to make the note. Murph's fixed return
   address is platform configuration. Never ask the person for a return address,
   invent one, or place one in tool arguments or artwork.
2. Call \`murph.generate_image\` with portrait size \`1024x1536\`, JPEG output,
   high quality, and the exact current authorizing message as \`message_ref\`.
   Image generation completes inside this tool call and returns one exact
   private \`vault_image\` descriptor.
3. When the request already authorizes mailing, immediately call
   \`murph.send_physical_note\` in the same turn with that descriptor's exact
   \`ref\` and \`sha256\`, the same exact \`message_ref\`, and the recipient.
   Never alter or reconstruct descriptor fields.
4. For a draft-only request, call \`murph.attach_response_media\` with the exact
   descriptor instead of mailing it. After a later explicit send request, call
   \`murph.send_physical_note\` with the saved descriptor and the new approving
   message's exact \`message_ref\`.

Do not attach or preview artwork merely because it exists. When the originating
request already said to mail it and the address is complete or safely resolved,
send it directly. Show it first only when the person requested a draft, the
intended content is ambiguous, or Murph genuinely needs their choice.

## Image prompt

The model owns the visual expression. It may create handwriting, doodles,
illustration, collage, a fake award, a comic, or another fitting single-page
design. Keep it personal and specific to the conversation.

Include these print constraints in the prompt:

- portrait full-page artwork on white 8.5-by-11-inch paper;
- all important text, faces, and marks within the central 86 percent of the
  page because the 1024x1536 image is cover-cropped to US Letter;
- a small understated \`murph ai\` mark somewhere unobtrusive;
- no mailing address, postage, envelope, QR code, tracking code, or provider
  branding inside the artwork;
- large enough lettering and contrast to remain legible in print.

The recipient address belongs only in \`murph.send_physical_note\`; never place
it in the image prompt. Trusted server code supplies the platform return
address.

## Authority and safety

One explicit mail request authorizes one note. A group request may originate
from any current activated participant; the group itself owns the free claim
and any later Murph-time cost.

Do not send bulk or repeated mail, international mail, anonymous threats,
harassment, fraud, impersonation, doxxing, illegal content, or a note that
claims to come from an uninvolved real person. Ask one concise question only
after the permitted lookup cannot uniquely resolve a delivery-critical address
field, or when send intent or note authorship is genuinely incomplete. Do not
ask the person to repeat retrievable city, state, or ZIP details or whether
Murph should draft a clear note request. Never ask for a return address.

Treat tool results literally:

- \`accepted\` means accepted for printing, not delivered; when the result is
  paid rather than complimentary, state the returned Murph-time cost;
- \`pending\` means do not retry or claim mailing success;
- \`insufficient_usage\` means explain that the free note was used and more
  Murph time is needed;
- \`failed\` means it was not accepted for printing.
`)

console.log('Rewrote image generation to complete in the active tool call.')
