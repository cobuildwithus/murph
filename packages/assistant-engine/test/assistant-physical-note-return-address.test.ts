import { describe, expect, it } from 'vitest'

import {
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
  readPhysicalNoteDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/physical-notes.js'

const RECIPIENT = {
  address_line1: '123 Main St',
  city: 'Atlanta',
  name: 'Sam',
  postal_code: '30308',
  state: 'GA',
}

describe('physical-note return address ownership', () => {
  it('keeps the return address in trusted platform configuration', () => {
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      'Never ask the person for a return address',
    )
    expect(
      MURPH_SEND_PHYSICAL_NOTE_TOOL.inputSchema.properties.to.description,
    ).toContain("server code supplies Murph's fixed return address")
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.inputSchema.properties)
      .not.toHaveProperty('from')

    expect(readPhysicalNoteDynamicToolRequest({
      arguments: {
        from: 'user supplied return address',
        to: RECIPIENT,
      },
      tool: MURPH_SEND_PHYSICAL_NOTE_TOOL.name,
    })).toMatchObject({
      kind: 'invalid-physical-note-arguments',
    })
  })
})
