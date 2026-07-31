import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
      'exact message_ref from the participant approving the send',
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

  it('binds a later group send to the exact accepted approving input', () => {
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
    })).toBe(APPROVAL_INPUT_ID)
    expect(resolvePhysicalNoteExplicitOriginInputId({
      acceptedInputIds: [APPROVAL_INPUT_ID],
      conversationScope: 'unverified-external',
    })).toBeNull()
  })

  it('keys the exact generated pixels, origin, and recipient', () => {
    const completion = {
      contentType: 'image/jpeg' as const,
      imageRef: 'raw/captures/generated.jpeg',
      imageSha256: 'b'.repeat(64),
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      sizeBytes: 123,
    }
    const recipient = {
      addressLine1: '123 Main St',
      city: 'Atlanta',
      name: 'Sam',
      postalCode: '30308',
      state: 'GA',
    }
    const first = createPhysicalNoteRequestKey({
      completion,
      recipient,
    })

    expect(first).toMatch(/^physical_note_[0-9a-f]{64}$/u)
    expect(createPhysicalNoteRequestKey({
      completion,
      recipient,
    })).toBe(first)
    expect(createPhysicalNoteRequestKey({
      completion: {
        ...completion,
        imageSha256: 'c'.repeat(64),
      },
      recipient,
    })).not.toBe(first)
    expect(createPhysicalNoteRequestKey({
      completion,
      recipient: {
        ...recipient,
        addressLine1: '456 Other St',
      },
    })).not.toBe(first)
  })

  it('executes a later approved send with the exact private bytes and identity', async () => {
    const vaultRoot = await createPhysicalNoteVault()
    const publishPrivateImageUrl = vi.fn<
      NonNullable<
        AssistantHostedToolContext['privateImageUrlPublisher']
      >['publishPrivateImageUrl']
    >(async () => ({
        expiresAt: '2026-08-01T00:00:00.000Z',
        url: 'https://private-media.example.test/note',
      }))
    const send = vi.fn(async () => ({
      complimentary: true,
      costUsdMicros: '250000',
      physicalNoteId: 'hpn_test',
      status: 'accepted' as const,
    }))

    const result = await executeMurphDynamicToolRequest({
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
        imageSha256: IMAGE_SHA256,
        kind: 'send-physical-note',
        recipient: RECIPIENT,
      },
      vaultRoot,
    })

    expect(publishPrivateImageUrl).toHaveBeenCalledWith({
      bytes: expect.any(Uint8Array),
      contentType: 'image/png',
    })
    expect([
      ...(publishPrivateImageUrl.mock.calls[0]?.[0].bytes ?? []),
    ]).toEqual([...IMAGE_BYTES])
    expect(send).toHaveBeenCalledWith({
      artwork: {
        expiresAt: '2026-08-01T00:00:00.000Z',
        sha256: IMAGE_SHA256,
        url: 'https://private-media.example.test/note',
      },
      originAssistantInputId: APPROVAL_INPUT_ID,
      recipient: RECIPIENT,
      requestKey: createPhysicalNoteRequestKey({
        completion: {
          imageRef: IMAGE_REF,
          imageSha256: IMAGE_SHA256,
          originAssistantInputId: APPROVAL_INPUT_ID,
        },
        recipient: RECIPIENT,
      }),
    }, {
      signal: null,
    })
    expect(result.rpcResult).toMatchObject({ success: true })
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"status":"accepted"',
    )
  })

  it('rejects changed artwork bytes before publishing or mailing', async () => {
    const vaultRoot = await createPhysicalNoteVault()
    const publishPrivateImageUrl = vi.fn()
    const send = vi.fn()

    const result = await executeMurphDynamicToolRequest({
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
        recipient: RECIPIENT,
      },
      vaultRoot,
    })

    expect(result.rpcResult).toMatchObject({ success: false })
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"status":"permission_denied"',
    )
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'current participant is not authorized',
    )
  })
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
