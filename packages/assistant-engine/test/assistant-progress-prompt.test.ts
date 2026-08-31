import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.ts'
import {
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'

describe('assistant progress prompt contract', () => {
  it('orients the member only before genuinely noticeable work', () => {
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
      'Default to no progress update',
    )
    expect(prompt).toContain(
      'Send one only when the member is likely to wait noticeably',
    )
    expect(prompt).toContain(
      '3+ substantive evidence checks/actions beyond setup',
    )
    expect(prompt).toContain(
      "an active skill's required receipt or start acknowledgement",
    )
    expect(prompt).toContain(
      'Routine onboarding/setup never qualifies by itself, even when it uses tools or the runtime is slow',
    )
    expect(prompt).toContain(
      'goal capture, policy/resume/status/context reads, device checks, saves, connection choices, one or two quick calls, and the next setup question go straight to the final reply',
    )
    expect(prompt).toContain(
      'send before its first qualifying action',
    )
    expect(prompt).toContain(
      'send a required child-start acknowledgement after spawning',
    )
    expect(prompt).toContain(
      'Background work does not trigger progress by itself',
    )
    expect(prompt).toContain(
      'A single routine daily-card read alone does not trigger progress',
    )
    expect(prompt).toContain(
      'Skip it within ordinary latency',
    )
    expect(prompt).toContain(
      'for an expected delay, send one outcome-focused update before slow work',
    )
    expect(prompt).toContain(
      'Never narrate safety, totals, estimates, or target resolution',
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
    expect(prompt).not.toContain('orient the member even when each lookup is routine')
    expect(prompt).not.toContain('Source count alone does not trigger it')
    expect(prompt).not.toContain('only separate user-requested long research or external action')
    expect(prompt).not.toContain('Routine onboarding/setup does not count by itself')
  })

  it('does not instruct routes without progress delivery to call the tool', () => {
    const prompt = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
      progressUpdatesAvailable: false,
      progressUpdateMode: 'direct',
    })

    expect(prompt).toContain(
      'Member-visible interim progress is unavailable on this route',
    )
    expect(prompt).not.toContain('murph.send_progress_update')
    expect(prompt).not.toContain('Send one early update before direct reply-critical work')
    expect(prompt).not.toContain('may outlast ordinary response time')
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
