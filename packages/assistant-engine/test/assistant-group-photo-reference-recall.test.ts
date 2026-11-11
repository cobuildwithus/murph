import { describe, expect, it } from 'vitest'

import {
  renderAssistantGroupRoomModelPrompt,
} from '../src/assistant/group-room-model.js'

describe('group photo reference recall', () => {
  it('checks available refs before asking for another upload', () => {
    const prompt = renderAssistantGroupRoomModelPrompt([
      '## People',
      '### Photo references',
      '- Zach — `raw/captures/2026/08/evt_capture_1/media-1.jpg` (far left).',
    ].join('\n'))

    expect(prompt).toContain(
      'raw/captures/2026/08/evt_capture_1/media-1.jpg',
    )
  })
})
