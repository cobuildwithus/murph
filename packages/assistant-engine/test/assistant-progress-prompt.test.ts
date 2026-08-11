import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.ts'
import {
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'

describe('assistant progress prompt contract', () => {
  it('orients the member before noticeable multi-source or long work', () => {
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
      'Send an update before reply-critical work needing a multi-source or cross-owner evidence pass, several substantive tool calls, long research, parsing/scans, or content inspection',
    )
    expect(prompt).toContain(
      'Before the first read in that pass, orient the member even when each lookup is routine',
    )
    expect(prompt).toContain(
      'Do not wait until the work is done or the member asks about the delay',
    )
    expect(prompt).toContain(
      'If the requested answer depends on a child and the wait may exceed ordinary latency, send it after spawning',
    )
    expect(prompt).toContain(
      'Background work does not trigger progress by itself unless an active skill explicitly requires a receipt or start acknowledgement',
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

  it('keeps the dynamic tool to a concise call contract', () => {
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.name).toBe('send_progress_update')
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description.length)
      .toBeLessThanOrEqual(260)
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'a brief user-visible update',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'before reply-critical work likely to keep the member waiting',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'continue immediately',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'A successful call means this update was sent',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).toContain(
      'This is not a final answer',
    )
    expect(MURPH_SEND_PROGRESS_UPDATE_TOOL.description).not.toContain(
      'do not repeat it',
    )

    const textProperty =
      MURPH_SEND_PROGRESS_UPDATE_TOOL.inputSchema.properties.text
    expect(textProperty).not.toHaveProperty('maxLength')
    expect(textProperty.description.length).toBeLessThanOrEqual(140)
    expect(textProperty.description).toContain(
      'One short natural sentence orienting the member to the work and immediate next step',
    )
    expect(textProperty.description).toContain('no final conclusions')
    expect(textProperty.description).toContain('unverified result claims')
    expect(textProperty.description).not.toContain('verified current progress')
  })
})
