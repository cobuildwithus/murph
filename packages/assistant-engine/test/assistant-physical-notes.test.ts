import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
  createPhysicalNoteRequestKey,
  readPhysicalNoteDynamicToolRequest,
  resolvePhysicalNoteExplicitOriginInputId,
} from '../src/assistant-codex/dynamic-tools/physical-notes.js'
import {
  executeMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'
import type {
  AssistantAcceptedMessageTargetAuthorizer,
} from '../src/assistant/message-target-selection.js'

const APPROVAL_INPUT_ID = `ain_${'c'.repeat(32)}`
const OTHER_INPUT_ID = `ain_${'d'.repeat(32)}`
const IMAGE_REF = 'raw/captures/physical-note.png'
const IMAGE_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const IMAGE_SHA256 = createHash('sha256').update(IMAGE_BYTES).digest('hex')
const RECIPIENT = {
  addressLine1: '123 Main St',
  city: 'Atlanta',
  name: 'Sam',
  postalCode: '30308',
  state: 'GA',
}
const tempRoots: string[] = []
const authorizeApprovalInput: AssistantAcceptedMessageTargetAuthorizer =
  async (input) => input.messageRef === APPROVAL_INPUT_ID
    ? { targetInputId: APPROVAL_INPUT_ID }
    : null

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

describe('assistant physical notes', () => {
  it('exposes one composable mail tool only when hosted transport is available', () => {
    expect(resolveMurphDynamicTools({
      physicalNotesAvailable: true,
    })).toContain(MURPH_SEND_PHYSICAL_NOTE_TOOL)
    expect(resolveMurphDynamicTools({
      physicalNotesAvailable: false,
    })).not.toContain(MURPH_SEND_PHYSICAL_NOTE_TOOL)
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/physical-notes/SKILL.md',
    )
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      'call this tool automatically after generation finishes',
    )
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      'provide the exact image_ref and image_sha256',
    )
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      'exact message_ref approving the send in the current turn',
    )
    expect(
      MURPH_SEND_PHYSICAL_NOTE_TOOL.inputSchema.properties.to.properties.state,
    ).toEqual({ type: 'string', pattern: '^[A-Za-z]{2}$' })
  })

  it('keeps rejection recovery separate from feedback eligibility', async () => {
    const skill = await readFile(
      new URL('../skills/physical-notes/SKILL.md', import.meta.url),
      'utf8',
    )

    expect(skill).toMatch(
      /A physical-note rejection by itself is recovery evidence, not product-feedback\s+eligibility\./u,
    )
    expect(skill).toMatch(
      /independently establishes eligible frustration or repeated\s+Murph-owned friction/u,
    )
  })

  it('normalizes the bounded US recipient', () => {
    expect(readPhysicalNoteDynamicToolRequest({
      arguments: {
        to: {
          address_line1: ' 123 Main St ',
          city: ' Atlanta ',
          name: ' Sam ',
          postal_code: '30308',
          state: 'ga',
        },
      },
      tool: MURPH_SEND_PHYSICAL_NOTE_TOOL.name,
    })).toEqual({
      kind: 'send-physical-note',
      recipient: {
        addressLine1: '123 Main St',
        city: 'Atlanta',
        name: 'Sam',
        postalCode: '30308',
        state: 'GA',
      },
    })
  })

  it('returns the safe invalid-arguments result for a non-alphabetic state', () => {
    for (const state of ['d1', '1A']) {
      expect(readPhysicalNoteDynamicToolRequest({
        arguments: {
          to: {
            address_line1: '123 Main St',
            city: 'Atlanta',
            name: 'Sam',
            postal_code: '30308',
            state,
          },
        },
        tool: MURPH_SEND_PHYSICAL_NOTE_TOOL.name,
      })).toMatchObject({
        kind: 'invalid-physical-note-arguments',
      })
    }
  })

  it('accepts an exact earlier generated-image identity only as a pair', () => {
    expect(readPhysicalNoteDynamicToolRequest({
      arguments: {
        image_ref: 'raw/captures/generated.jpeg',
        image_sha256: 'a'.repeat(64),
        message_ref: APPROVAL_INPUT_ID,
        to: {
          address_line1: '123 Main St',
          city: 'Atlanta',
          name: 'Sam',
          postal_code: '30308',
          state: 'GA',
        },
      },
      tool: MURPH_SEND_PHYSICAL_NOTE_TOOL.name,
    })).toMatchObject({
      imageRef: 'raw/captures/generated.jpeg',
      imageSha256: 'a'.repeat(64),
      kind: 'send-physical-note',
      messageRef: APPROVAL_INPUT_ID,
    })

    expect(readPhysicalNoteDynamicToolRequest({
      arguments: {
        image_ref: 'raw/captures/generated.jpeg',
        to: {
          address_line1: '123 Main St',
          city: 'Atlanta',
          name: 'Sam',
          postal_code: '30308',
          state: 'GA',
        },
      },
      tool: MURPH_SEND_PHYSICAL_NOTE_TOOL.name,
    })).toMatchObject({
      kind: 'invalid-physical-note-arguments',
    })

    expect(readPhysicalNoteDynamicToolRequest({
      arguments: {
        image_ref: 'raw/captures/generated.jpeg',
        image_sha256: 'a'.repeat(64),
        to: {
          address_line1: '123 Main St',
          city: 'Atlanta',
          name: 'Sam',
          postal_code: '30308',
          state: 'GA',
        },
      },
      tool: MURPH_SEND_PHYSICAL_NOTE_TOOL.name,
    })).toMatchObject({
      kind: 'invalid-physical-note-arguments',
    })

    expect(readPhysicalNoteDynamicToolRequest({
      arguments: {
        message_ref: APPROVAL_INPUT_ID,
        to: {
          address_line1: '123 Main St',
          city: 'Atlanta',
          name: 'Sam',
          postal_code: '30308',
          state: 'GA',
        },
      },
      tool: MURPH_SEND_PHYSICAL_NOTE_TOOL.name,
    })).toMatchObject({
      kind: 'invalid-physical-note-arguments',
    })
  })

  it('binds every later send to the exact accepted approving input', () => {
    expect(resolvePhysicalNoteExplicitOriginInputId({
      acceptedInputIds: [OTHER_INPUT_ID, APPROVAL_INPUT_ID],
      conversationScope: 'group',
      messageRef: APPROVAL_INPUT_ID,
    })).toBe(APPROVAL_INPUT_ID)
    expect(resolvePhysicalNoteExplicitOriginInputId({
      acceptedInputIds: [OTHER_INPUT_ID],
      conversationScope: 'group',
      messageRef: APPROVAL_INPUT_ID,
    })).toBeNull()
    expect(resolvePhysicalNoteExplicitOriginInputId({
      acceptedInputIds: [OTHER_INPUT_ID, APPROVAL_INPUT_ID],
      conversationScope: 'group',
    })).toBeNull()
    expect(resolvePhysicalNoteExplicitOriginInputId({
      acceptedInputIds: [OTHER_INPUT_ID, APPROVAL_INPUT_ID],
      conversationScope: 'direct',
    })).toBeNull()
    expect(resolvePhysicalNoteExplicitOriginInputId({
      acceptedInputIds: [OTHER_INPUT_ID, APPROVAL_INPUT_ID],
      conversationScope: 'direct',
      messageRef: APPROVAL_INPUT_ID,
    })).toBe(APPROVAL_INPUT_ID)
    expect(resolvePhysicalNoteExplicitOriginInputId({
      acceptedInputIds: [APPROVAL_INPUT_ID],
      conversationScope: 'unverified-external',
    })).toBeNull()
  })

  it('keys only the exact authorized effect so changed content collides downstream', () => {
    const originAssistantInputId = `ain_${'a'.repeat(32)}`
    const first = createPhysicalNoteRequestKey({
      originAssistantInputId,
    })

    expect(first).toMatch(/^physical_note_[0-9a-f]{64}$/u)
    expect(createPhysicalNoteRequestKey({
      originAssistantInputId,
    })).toBe(first)
    expect(createPhysicalNoteRequestKey({
      originAssistantInputId: `ain_${'d'.repeat(32)}`,
    })).not.toBe(first)
  })

  it('rejects changed artwork bytes before publishing or mailing', async () => {
    const vaultRoot = await createPhysicalNoteVault()
    const publishPrivateImageUrl = vi.fn()
    const send = vi.fn()

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: authorizeApprovalInput,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        physicalNotes: { send },
        privateImageUrlPublisher: { publishPrivateImageUrl },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        imageRef: IMAGE_REF,
        imageSha256: 'f'.repeat(64),
        kind: 'send-physical-note',
        messageRef: APPROVAL_INPUT_ID,
        recipient: RECIPIENT,
      },
      vaultRoot,
    })

    expect(publishPrivateImageUrl).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(result.rpcResult).toMatchObject({ success: false })
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'no longer matches its trusted saved image',
    )
  })

  it('reports participant denial as definite and does not invite an unsafe retry', async () => {
    const vaultRoot = await createPhysicalNoteVault()
    const send = vi.fn(async () => ({
      complimentary: false,
      costUsdMicros: '0',
      physicalNoteId: null,
      status: 'permission_denied' as const,
    }))

    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: authorizeApprovalInput,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        physicalNotes: { send },
        privateImageUrlPublisher: {
          publishPrivateImageUrl: async () => ({
            expiresAt: '2026-08-01T00:00:00.000Z',
            url: 'https://private-media.example.test/note',
          }),
        },
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        imageRef: IMAGE_REF,
        imageSha256: IMAGE_SHA256,
        kind: 'send-physical-note',
        messageRef: APPROVAL_INPUT_ID,
        recipient: RECIPIENT,
      },
      vaultRoot,
    })

    expect(result.rpcResult).toMatchObject({ success: false })
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"status":"permission_denied"',
    )
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'action is not available to the current participant right now',
    )
  })

  it.each([
    ['recipient_address', 'check the street and unit'],
    ['artwork', 'regenerate the image'],
    ['service_unavailable', "on Murph's side, not the recipient address"],
    ['request_invalid', 'correct the printing request'],
    ['unknown', 'without a recognized safe correction'],
  ] as const)(
    'returns actionable recovery for %s physical-note failures',
    async (failureReason, expectedGuidance) => {
      const vaultRoot = await createPhysicalNoteVault()
      const send = vi.fn(async () => ({
        complimentary: false,
        costUsdMicros: '250000',
        failureReason,
        physicalNoteId: 'hpn_failed',
        status: 'failed' as const,
      }))

      const result = await executeMurphDynamicToolRequest({
        authorizeAcceptedMessageTarget: authorizeApprovalInput,
        deliveryContextOrdinal: 0,
        env: {},
        fetchImpl: fetch,
        hostedToolContext: createHostedToolContext({
          physicalNotes: { send },
          privateImageUrlPublisher: {
            publishPrivateImageUrl: async () => ({
              expiresAt: '2027-08-01T00:00:00.000Z',
              url: 'https://private-media.example.test/note',
            }),
          },
        }),
        nextUsageOrdinal: () => 1,
        progressDelivery: null,
        request: {
          imageRef: IMAGE_REF,
          imageSha256: IMAGE_SHA256,
          kind: 'send-physical-note',
          messageRef: APPROVAL_INPUT_ID,
          recipient: RECIPIENT,
        },
        vaultRoot,
      })

      expect(result.rpcResult).toMatchObject({ success: false })
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        `"failureReason":"${failureReason}"`,
      )
      expect(result.rpcResult.contentItems[0]?.text).toContain(expectedGuidance)
      expect(result.rpcResult.contentItems[0]?.text).toMatch(
        /do not .*retry automatically/iu,
      )
      expect(result.rpcResult.contentItems[0]?.text).not.toMatch(
        /product feedback|submit_product_feedback/iu,
      )
      if (
        failureReason === 'service_unavailable'
        || failureReason === 'request_invalid'
        || failureReason === 'unknown'
      ) {
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'No automatic retry or follow-up is running',
        )
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'new explicit send request later',
        )
      }
    },
  )
})

async function createPhysicalNoteVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-physical-note-tool-'))
  tempRoots.push(vaultRoot)
  const absolutePath = path.join(vaultRoot, IMAGE_REF)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, IMAGE_BYTES)
  return vaultRoot
}

function createHostedToolContext(input: {
  physicalNotes: NonNullable<AssistantHostedToolContext['physicalNotes']>
  privateImageUrlPublisher:
    NonNullable<AssistantHostedToolContext['privateImageUrlPublisher']>
}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: () => ({
      acceptedInputIds: [APPROVAL_INPUT_ID],
      conversationId: 'conversation_physical_note',
      conversationScope: 'direct',
      inboundMailboxItemIds: ['mailbox_physical_note'],
      originSessionId: 'session_physical_note',
      recipientKey: 'recipient_physical_note',
    }),
    physicalNotes: input.physicalNotes,
    privateImageUrlPublisher: input.privateImageUrlPublisher,
    sendVaultFile: vi.fn(async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: false,
  }
}
