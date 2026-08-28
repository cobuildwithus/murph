import { describe, expect, it } from 'vitest'

import {
  buildAssistantExecutionBehaviorText,
} from '../src/assistant/model-behavior.js'
import {
  buildAssistantSystemPrompt,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

describe('action-first browser prompt contract', () => {
  it('treats lookup as preflight for browser-backed real-world actions', () => {
    const executionText = buildAssistantExecutionBehaviorText({
      profile: 'gpt5-agentic',
    })

    expect(executionText).toContain(
      'For browser-backed real-world action requests such as ordering, reordering, booking, rescheduling, canceling, paying, refilling, submitting a form, or using a portal',
    )
    expect(executionText).toContain(
      'treat product, catalog, web, email, calendar, or vault lookup as preflight only',
    )
    expect(executionText).toContain(
      'use that tool instead of replying with only a search result, product link, appointment portal, or instructions',
    )
    expect(executionText).toContain(
      'For medical appointment check-in or intake, read `appointment-scheduling` before browser execution',
    )
  })

  it('delegates point-of-risk decisions and preserves bounded recovery', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput())

    expect(prompt).toContain(
      'For browser approval, sensitive-data transmission, takeover, and retry boundaries, follow `computer-use` as the single policy owner',
    )
    expect(prompt).toContain(
      'Make reversible progress first',
    )
    expect(prompt).toContain(
      'An ordinary failed or unresponsive control is not yet a blocker',
    )
    expect(prompt).toContain(
      're-inspect current state, complete one safe alternate interaction, and only then use `computer-use` OS fallback when allowed',
    )
    expect(prompt).toContain(
      'After one OS action, re-inspect; when the target state changed, never repeat that action',
    )
    expect(prompt).toContain(
      'Refresh only when no side effect is unknown and entered state is safe',
    )
    expect(prompt).toContain(
      'do not imply you opened or can drive checkout unless an actual runtime action happened',
    )
    expect(prompt).toContain(
      'Complete the browser task end-to-end when the user has asked you to do it and the needed information is available.',
    )
  })

  it('keeps final confirmation handoff links optional', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput())

    expect(prompt).toContain(
      'When `computer-use` requires in-chat approval, ask the smallest concrete question',
    )
    expect(prompt).toContain(
      'Keep a handoff link optional unless automation cannot proceed after approval',
    )
  })

  it('includes a fresh handoff link when direct takeover is required', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput())

    expect(prompt).toContain(
      'When direct browser takeover is actually required and the pause tool returns a fresh handoff URL',
    )
    expect(prompt).toContain(
      'include that URL with the one precise action needed',
    )
    expect(prompt).toContain(
      'Never refer to an "open page" or takeover without giving the usable link',
    )
  })
})

function createCommonCodexPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract for common Codex route.',
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    assistantKnowledgeToolsAvailable: true,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
    ...overrides,
  }
}
