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
      'Use it for longer, multi-step, research, long parsing/scans, or substantial non-audio content-inspection work',
    )
    expect(prompt).toContain(
      'If the turn remains long-running after substantial tool work, send another brief update so the user is not left hanging, up to three total progress updates in the turn',
    )
    expect(prompt).toContain(
      'Keep the text to one to three short conversational sentences, specific to the immediate next step',
    )
    expect(prompt).toContain(
      'avoid stiff plan-recitation wording like "I\'m going to..."',
    )
    expect(prompt).toContain(
      'Skip it for skill-file reads, setup checks, routine single-command vault reads, quick replies, straightforward one-shot logging/capture/memory saves, and automatically transcribed voice memo or audio content',
    )
    expect(prompt).not.toContain('saving recovered data')
    expect(prompt).not.toContain('before the first non-progress tool call')
  })

  it('keeps the dynamic tool description aligned with the progress prompt rule', () => {
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.name).toBe('send_progress_update')
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'before longer, tool-heavy, or substantial user-content-inspection work',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'If the turn remains long-running after substantial tool work',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'so the user is not left hanging',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'up to three total progress updates in the turn',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Use immediately as the first assistant action',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'PDFs, lab reports, images, screenshots, CSVs',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).not.toContain(
      'audio/video, large pasted text',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'large pasted text, meal/product/supplement labels',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'workout exports, wearable exports, or health documents',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Skip automatically transcribed voice memo or audio content',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'manual media tools or broader long-running work are needed',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).not.toContain(
      'reasoning over extracted content',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Do not use for skill-file reads alone, setup checks, routine single-command vault reads',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'one-shot logging/capture/memory saves that only need a straightforward write',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).not.toContain(
      'before the first non-progress tool call',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'current conversation',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'brief, natural user-visible progress update',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'or final conclusions',
    )

    const textProperty =
      MURPH_SEND_PROGRESS_UPDATE_TOOL.inputSchema.properties.text
    expect(textProperty).not.toHaveProperty('maxLength')
    expect(textProperty.description).toContain(
      'One to three short conversational first-person sentences about the immediate next step',
    )
    expect(textProperty.description).toContain('Use contractions when natural')
    expect(textProperty.description).toContain(
      'Avoid stiff plan-recitation wording like "I\'m going to..."',
    )
    expect(textProperty.description).toContain(
      'a shorter "I\'ll..." or "Taking a look..." works',
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
