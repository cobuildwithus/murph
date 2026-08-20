import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  hostedPhysicalNoteSendResponseSchema,
} from '@murphai/hosted-execution/physical-notes'

import {
  MURPH_RESOLVE_PHYSICAL_NOTE_TOOL,
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
const PREVIOUS_HOSTED_PHYSICAL_NOTE_SEND_RESPONSE_SCHEMA =
  hostedPhysicalNoteSendResponseSchema
    .omit({ failureReason: true })
    .strict()
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

  it('exposes standalone recovery only with current hosted recovery authority', () => {
    expect(resolveMurphDynamicTools({
      physicalNoteRecoveryAvailable: true,
    })).toContain(MURPH_RESOLVE_PHYSICAL_NOTE_TOOL)
    expect(resolveMurphDynamicTools({
      physicalNoteRecoveryAvailable: false,
    })).not.toContain(MURPH_RESOLVE_PHYSICAL_NOTE_TOOL)
    expect(MURPH_RESOLVE_PHYSICAL_NOTE_TOOL.description).toContain(
      'never sends a new note or recalls an accepted one',
    )
    expect(MURPH_RESOLVE_PHYSICAL_NOTE_TOOL.deferLoading).toBe(true)
  })

  it('parses recovery only with an exact accepted-input-shaped message ref', () => {
    expect(readPhysicalNoteDynamicToolRequest({
      arguments: { message_ref: APPROVAL_INPUT_ID },
      tool: MURPH_RESOLVE_PHYSICAL_NOTE_TOOL.name,
    })).toEqual({
      kind: 'resolve-physical-note',
      messageRef: APPROVAL_INPUT_ID,
    })
    expect(readPhysicalNoteDynamicToolRequest({
      arguments: { message_ref: 'not-an-accepted-input' },
      tool: MURPH_RESOLVE_PHYSICAL_NOTE_TOOL.name,
    })).toMatchObject({ kind: 'invalid-physical-note-arguments' })
  })

  it('requires the exact current accepted message before recovery', async () => {
    const resolve = vi.fn()
    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: authorizeApprovalInput,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        physicalNotes: { resolve, send: vi.fn() },
        privateImageUrlPublisher: unavailablePrivateImagePublisher(),
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        kind: 'resolve-physical-note',
        messageRef: OTHER_INPUT_ID,
      },
    })

    expect(resolve).not.toHaveBeenCalled()
    expect(result.rpcResult).toMatchObject({ success: false })
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'exact current authorizing Message ref',
    )
  })

  it.each([
    {
      expected: 'cannot be treated as canceled',
      response: { retryAfter: null, status: 'accepted' as const },
      success: true,
    },
    {
      expected: 'No unresolved physical-note submission remains',
      response: { retryAfter: null, status: 'clear' as const },
      success: true,
    },
    {
      expected: 'No automatic retry or follow-up is running',
      response: {
        retryAfter: '2026-08-21T18:00:00.000Z',
        status: 'pending' as const,
      },
      success: true,
    },
    {
      expected: 'not available to the current participant',
      response: { retryAfter: null, status: 'permission_denied' as const },
      success: false,
    },
    {
      expected: 'recovery is currently unavailable',
      response: { retryAfter: null, status: 'unavailable' as const },
      success: false,
    },
  ])('reports recovery status $response.status literally', async ({
    expected,
    response,
    success,
  }) => {
    const resolve = vi.fn(async () => response)
    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: authorizeApprovalInput,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        physicalNotes: { resolve, send: vi.fn() },
        privateImageUrlPublisher: unavailablePrivateImagePublisher(),
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        kind: 'resolve-physical-note',
        messageRef: APPROVAL_INPUT_ID,
      },
    })

    expect(resolve).toHaveBeenCalledWith({
      originAssistantInputId: APPROVAL_INPUT_ID,
    }, { signal: null })
    expect(result.rpcResult).toMatchObject({ success })
    expect(result.rpcResult.contentItems[0]?.text).toContain(expected)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      `\"status\":\"${response.status}\"`,
    )
    if (response.status === 'unavailable') {
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        'earlier submission was not cleared',
      )
    }
  })

  it('keeps the durable recovery state unconfirmed when its response is lost', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('response body lost after the request was consumed')
    })
    const result = await executeMurphDynamicToolRequest({
      authorizeAcceptedMessageTarget: authorizeApprovalInput,
      deliveryContextOrdinal: 0,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        physicalNotes: { resolve, send: vi.fn() },
        privateImageUrlPublisher: unavailablePrivateImagePublisher(),
      }),
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: {
        kind: 'resolve-physical-note',
        messageRef: APPROVAL_INPUT_ID,
      },
    })

    const text = result.rpcResult.contentItems[0]?.text ?? ''
    expect(resolve).toHaveBeenCalledOnce()
    expect(result.rpcResult).toMatchObject({ success: false })
    expect(text).toContain('final state is unconfirmed')
    expect(text).toContain('Nothing new was sent')
    expect(text).toContain('no automatic retry is running')
    expect(text).not.toContain('was not cleared')
    expect(text).not.toContain('nothing changed')
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
    expect(skill).toMatch(
      /call `murph\.resolve_physical_note` exactly\s+once with the exact current authorizing `message_ref`/u,
    )
    expect(skill).toContain('never sends a new note or recalls an accepted one')
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

  it('does not present a recovered legacy acceptance as paid or complimentary', async () => {
    const vaultRoot = await createPhysicalNoteVault()
    const send = vi.fn(async () => ({
      complimentary: false,
      costUsdMicros: '250000',
      failureReason: 'prior_note_accepted' as const,
      physicalNoteId: 'hpn_legacy_accepted',
      status: 'accepted' as const,
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

    const toolText = result.rpcResult.contentItems[0]?.text ?? ''
    expect(result.rpcResult).toMatchObject({ success: true })
    expect(toolText).toContain('"status":"accepted"')
    expect(toolText).toContain('"failureReason":"prior_note_accepted"')
    expect(toolText).toContain('This replay did not send another note')
    expect(toolText).toContain('do not describe it as paid or complimentary')
    expect(toolText).not.toContain('costUsdMicros')
    expect(toolText).not.toMatch(/"complimentary":/u)
  })

  it('preserves the cost fields for an ordinary paid acceptance', async () => {
    const vaultRoot = await createPhysicalNoteVault()
    const send = vi.fn(async () => ({
      complimentary: false,
      costUsdMicros: '250000',
      physicalNoteId: 'hpn_paid_accepted',
      status: 'accepted' as const,
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

    const toolText = result.rpcResult.contentItems[0]?.text ?? ''
    expect(result.rpcResult).toMatchObject({ success: true })
    expect(toolText).toContain('"status":"accepted"')
    expect(toolText).toContain('"complimentary":false')
    expect(toolText).toContain('"costUsdMicros":"250000"')
    expect(toolText).not.toContain('prior_note_accepted')
  })

  it.each([
    ['categorized rejection', {
      complimentary: true,
      costUsdMicros: '0',
      failureReason: 'recipient_address',
      physicalNoteId: 'hpn_failed',
      status: 'failed',
    }],
    ['recovered legacy acceptance', {
      complimentary: false,
      costUsdMicros: '250000',
      failureReason: 'prior_note_accepted',
      physicalNoteId: 'hpn_legacy_accepted',
      status: 'accepted',
    }],
  ] as const)(
    'keeps a %s pending through the previous strict runner',
    async (_caseName, response) => {
      const vaultRoot = await createPhysicalNoteVault()
      const currentWebResponse = hostedPhysicalNoteSendResponseSchema.parse(
        response,
      )
      const send = vi.fn(async () =>
        PREVIOUS_HOSTED_PHYSICAL_NOTE_SEND_RESPONSE_SCHEMA.parse(
          currentWebResponse,
        )
      )

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

      expect(send).toHaveBeenCalledOnce()
      expect(result.rpcResult).toMatchObject({ success: false })
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        '"status":"pending"',
      )
      expect(result.rpcResult.contentItems[0]?.text).toContain(
        'could not confirm whether this physical note was accepted',
      )
      expect(result.rpcResult.contentItems[0]?.text).toMatch(
        /do not .*retry it automatically/iu,
      )
      expect(result.rpcResult.contentItems[0]?.text).not.toContain(
        'new explicit send request',
      )
    },
  )

  it('keeps a transport-timeout result pending without inviting another request', async () => {
    const vaultRoot = await createPhysicalNoteVault()
    const send = vi.fn(async () => {
      throw new Error('Hosted Web control plane returned HTTP 408.')
    })

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

    const toolText = result.rpcResult.contentItems[0]?.text ?? ''
    expect(send).toHaveBeenCalledOnce()
    expect(result.rpcResult).toMatchObject({ success: false })
    expect(toolText).toContain('"status":"pending"')
    expect(toolText).toContain(
      'could not confirm whether this physical note was accepted',
    )
    expect(toolText).not.toContain('Nothing was sent')
    expect(toolText).not.toContain('new explicit send request')
  })

  it.each([
    ['recipient_address', 'check the street and unit'],
    ['artwork', 'regenerate the image'],
    ['service_unavailable', "on Murph's side, not the recipient address"],
    ['request_invalid', 'correct the printing request'],
    ['prior_note_unresolved', 'earlier physical-note submission is still unresolved'],
    ['prior_note_accepted', 'earlier physical note was accepted'],
    ['unknown', 'could not complete the physical-note request'],
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
      if (
        failureReason === 'prior_note_unresolved'
        || failureReason === 'prior_note_accepted'
      ) {
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'current physical-note request was not sent',
        )
        expect(result.rpcResult.contentItems[0]?.text).not.toContain(
          'new explicit send request',
        )
        expect(result.rpcResult.contentItems[0]?.text).not.toContain(
          'for this person',
        )
        expect(result.rpcResult.contentItems[0]?.text).not.toContain(
          'while Murph investigates',
        )
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'without claiming the earlier and current requests share a recipient',
        )
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'No automatic',
        )
      }
      if (failureReason === 'prior_note_unresolved') {
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'A later explicit physical-note request may recheck the earlier outcome',
        )
      }
      if (failureReason === 'prior_note_accepted') {
        expect(result.rpcResult.contentItems[0]?.text).not.toContain(
          'is still unresolved',
        )
        expect(result.rpcResult.contentItems[0]?.text).not.toContain(
          'may recheck',
        )
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'Do not retry automatically; that applies only to this request',
        )
        expect(result.rpcResult.contentItems[0]?.text).toContain(
          'A separately authorized future request is distinct',
        )
      }
      if (failureReason === 'unknown') {
        expect(result.rpcResult.contentItems[0]?.text).not.toContain(
          'is still unresolved',
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

function unavailablePrivateImagePublisher(): NonNullable<
  AssistantHostedToolContext['privateImageUrlPublisher']
> {
  return {
    publishPrivateImageUrl: vi.fn(async () => {
      throw new Error('private image publishing is not used by recovery')
    }),
  }
}
