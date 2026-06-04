import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.ts'
import {
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'

describe('assistant progress prompt contract', () => {
  it('omits progress update guidance when progress delivery is unavailable', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdatesAvailable: false,
    })

    expect(prompt).not.toContain('send_progress_update')
    expect(prompt).not.toContain('before the first non-progress tool call')
    expect(prompt).not.toContain('Do not overthink the channel or task category')
  })

  it('requires progress preambles for longer tool-heavy work', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdatesAvailable: true,
    })

    expect(prompt).toContain(
      'call `send_progress_update` once before the first non-progress tool call',
    )
    expect(prompt).toContain('reading attachments, inspecting or parsing files')
    expect(prompt).toContain('saving recovered data')
    expect(prompt).toContain('multi-step tool work')
    expect(prompt).toContain('quick single-step replies')
    expect(prompt).toContain('Do not overthink the channel or task category')
    expect(prompt).toContain(
      'one short, factual sentence about what you are starting or checking next',
    )
    expect(prompt).toContain(
      'Do not include final answers, medical interpretations, abnormalities',
    )
  })

  it('keeps the dynamic tool description aligned with the progress prompt rule', () => {
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.name).toBe('send_progress_update')
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'before longer or tool-heavy work',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'before the first non-progress tool call',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'current user conversation',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'not include final conclusions',
    )

    const textProperty =
      MURPH_SEND_PROGRESS_UPDATE_TOOL.inputSchema.properties.text
    expect(textProperty.description).toContain(
      'Say what you are starting or checking next',
    )
    expect(textProperty.description).toContain('No markdown links')
    expect(textProperty.description).toContain('final answers')
    expect(textProperty.description).toContain('medical interpretation')
    expect(textProperty.description).toContain('diagnoses')
    expect(textProperty.description).toContain('recommendations')
    expect(textProperty.description).toContain('unchecked claims')
  })
})
