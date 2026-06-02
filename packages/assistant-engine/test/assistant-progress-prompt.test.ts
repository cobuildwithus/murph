import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.ts'

describe('assistant progress prompt contract', () => {
  it('omits progress update guidance when progress delivery is unavailable', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdatesAvailable: false,
    })

    expect(prompt).not.toContain('send_progress_update')
    expect(prompt).not.toContain('large PDFs, CSVs, images, lab reports')
    expect(prompt).not.toContain('File received.')
  })

  it('requires early progress updates for long attachment work when available', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdatesAvailable: true,
    })

    expect(prompt).toContain('send `send_progress_update` once early')
    expect(prompt).toContain('large PDFs, CSVs, images, lab reports')
    expect(prompt).toContain('multi-step file parsing/import')
    expect(prompt).toContain('This is not narrating a plan')
    expect(prompt).toContain(
      "File received. I'm saving the relevant health data now.",
    )
  })
})
