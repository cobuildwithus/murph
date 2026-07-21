import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.ts'
import {
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'

describe('assistant progress prompt contract', () => {
  it('keeps progress preambles scarce for longer or user-content-inspection work', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(prompt).toContain(
      'Native commentary is internal, not member-visible',
    )
    expect(prompt).toContain(
      'Use `murph.send_progress_update` for interim updates the member must see; commentary does not count',
    )
    expect(prompt).toContain(
      'It is not a final answer, so continue immediately with the first needed action',
    )
    expect(prompt).toContain(
      'For reply-critical long research, multiple substantive tool calls, long parsing/scans, or content inspection, send an update before slow work',
    )
    expect(prompt).toContain(
      'If the requested answer depends on a child and the wait may exceed ordinary latency, send it after spawning',
    )
    expect(prompt).toContain(
      'Background work does not trigger progress by itself unless an active skill explicitly requires a start acknowledgement after accepted child spawns',
    )
    expect(prompt).toContain(
      'Do not leave the member silent during reply-critical work; Linq/iMessage quota is not a reason to withhold a useful update',
    )
    expect(prompt).toContain(
      'For work likely to finish within about a minute, send at most one update',
    )
    expect(prompt).toContain(
      'never a fourth',
    )
    expect(prompt).toContain(
      'If it runs unusually long, send up to two more at real milestones; never a fourth',
    )
    expect(prompt).toContain(
      'Do not narrate individual tool loops, searches, reads, clicks, or status churn',
    )
    expect(prompt).toContain(
      'Use one or two natural sentences about what the member cares about and the next step; never narrate internal mechanics',
    )
    expect(prompt).toContain(
      'Skip skill reads, setup checks, routine single-command reads, quick replies, one-shot logging/capture/memory saves, and auto-transcribed audio unless broader work is long-running',
    )
    expect(prompt).not.toContain('saving recovered data')
    expect(prompt).not.toContain('before the first non-progress tool call')
  })

  it('keeps the dynamic tool description aligned with the progress prompt rule', () => {
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.name).toBe('send_progress_update')
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'when genuinely reply-critical work would otherwise leave the user waiting',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'For work likely to finish in about a minute or less, send at most one update',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'never a fourth',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Linq/iMessage quota is not a reason to withhold a useful update',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Use it before long tasks',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'If the requested answer depends on a child and the wait may exceed ordinary latency, send it after spawning',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Background work does not trigger an update by itself unless an active skill explicitly requires a start acknowledgement after accepted child spawns',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'Do not use for individual tool loops, searches, reads, page checks, clicks, status churn',
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
      'skill-file reads alone, setup checks, routine single-command vault reads',
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
      'Prefer one short conversational first-person sentence about the immediate next step',
    )
    expect(textProperty.description).toContain(
      'use two only when needed to keep the quick note clear',
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
