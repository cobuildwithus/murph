import { describe, expect, it } from 'vitest'

import {
  MURPH_GROUP_ROOM_MODEL_TOOL,
} from '../src/assistant-codex/dynamic-tools/group-room-model.js'
import {
  renderAssistantGroupRoomModelPrompt,
} from '../src/assistant/group-room-model.js'

describe('group photo reference recall', () => {
  it('teaches silent consolidation to keep only explicit bounded photo refs', () => {
    const description = MURPH_GROUP_ROOM_MODEL_TOOL.description

    expect(description).toContain('engine-authorized silent consolidation')
    expect(description).toContain('`Photo references` subsection under `People`')
    expect(description).toContain('`raw/captures/**`')
    expect(description).toContain('`raw/inbox/**`')
    expect(description).toContain('retire the entry after 14 days')
    expect(description).toContain(
      'at most three useful non-duplicate refs per person',
    )
    expect(description).toContain(
      'Never invent a ref or infer identity from facial similarity',
    )
  })

  it('gives silent consolidation a soft lore size target and compaction policy', () => {
    const description = MURPH_GROUP_ROOM_MODEL_TOOL.description

    expect(description).toContain('roughly under 20,000 UTF-8 bytes')
    expect(description).toContain('soft curation target, not a hard write gate')
    expect(description).toContain('merge duplicate lore')
    expect(description).toContain('summarize older low-value detail')
    expect(description).toContain('retire stale or contradicted bits')
    expect(description).toContain('preserving high-signal current canon')
    expect(description).not.toContain('must fit the complete advisory prompt')
  })

  it('checks available refs before asking for another upload', () => {
    const prompt = renderAssistantGroupRoomModelPrompt([
      '## People',
      '### Photo references',
      '- Zach — `raw/captures/2026/08/evt_capture_1/media-1.jpg` (far left).',
    ].join('\n'))

    expect(prompt).toContain('current attachments')
    expect(prompt).toContain('recent visible conversation')
    expect(prompt).toContain('before asking for another upload')
    expect(prompt).toContain('ask only for the missing photo or position')
    expect(prompt).toContain(
      'Never identify someone from facial similarity alone',
    )
    expect(prompt).toContain(
      'raw/captures/2026/08/evt_capture_1/media-1.jpg',
    )
  })
})
