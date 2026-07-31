import { describe, expect, it } from 'vitest'

import {
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
  createPhysicalNoteRequestKey,
  readPhysicalNoteDynamicToolRequest,
  resolvePhysicalNoteExplicitOriginInputId,
} from '../src/assistant-codex/dynamic-tools/physical-notes.js'
import { resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.js'

const APPROVAL_INPUT_ID = `ain_${'c'.repeat(32)}`
const OTHER_INPUT_ID = `ain_${'d'.repeat(32)}`

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
})
