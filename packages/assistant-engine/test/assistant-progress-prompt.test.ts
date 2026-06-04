import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.ts'
import {
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'

describe('assistant progress prompt contract', () => {
  it('requires progress preambles for longer or user-content-inspection work', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(prompt).toContain(
      'A required `send_progress_update` call is not a final answer and does not conflict with acting directly',
    )
    expect(prompt).toContain(
      'continue immediately with the first file, vault, web, skill, media, or CLI action',
    )
    expect(prompt).toContain(
      'content inspection, research, saving recovered data, long parsing, long scans, or multiple tool steps',
    )
    expect(prompt).not.toContain('before the first non-progress tool call')
  })

  it('keeps the dynamic tool description aligned with the progress prompt rule', () => {
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.name).toBe('send_progress_update')
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'before longer, tool-heavy, or user-content-inspection work',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Use immediately as the first assistant action',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'PDFs, lab reports, images, screenshots, CSVs, audio/video',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'large pasted text, meal/product/supplement labels',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'workout exports, wearable exports, or health documents',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'reasoning over extracted content',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Do not use for skill-file reads alone, setup checks, routine single-command vault reads',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).not.toContain(
      'before the first non-progress tool call',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'current conversation',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'or final conclusions',
    )

    const textProperty =
      MURPH_SEND_PROGRESS_UPDATE_TOOL.inputSchema.properties.text
    expect(textProperty.description).toContain(
      'One short factual sentence about what you are starting or checking next',
    )
    expect(textProperty.description).toContain('No markdown links')
    expect(textProperty.description).toContain('final answers')
    expect(textProperty.description).toContain('lab interpretations')
    expect(textProperty.description).toContain('abnormalities')
    expect(textProperty.description).toContain('diagnoses')
    expect(textProperty.description).toContain('treatment recommendations')
    expect(textProperty.description).toContain('claims not yet verified')
  })
})
