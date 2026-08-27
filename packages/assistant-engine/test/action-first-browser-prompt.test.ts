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

  it('preserves point-of-risk pauses instead of premature search-only replies', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput())

    expect(prompt).toContain(
      'For irreversible browser actions, make reversible progress first and stop only at a real point of risk',
    )
    expect(prompt).toContain(
      'login/private handoff, missing material choice, unavailable payment or sensitive input, final confirmation, or a site/tool blocker proven after bounded recovery',
    )
    expect(prompt).toContain(
      'An ordinary failed or unresponsive control is not yet a blocker',
    )
    expect(prompt).toContain(
      're-inspect current state, complete one safe alternate interaction, and only then use `computer-use` OS fallback when allowed; refresh only when no side effect is unknown and entered state is safe',
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
      'ask for approval in chat so a simple "yes" or "go ahead" can resume the run',
    )
    expect(prompt).toContain(
      'A handoff link may be included for optional inspection or takeover',
    )
    expect(prompt).toContain(
      'do not require the user to open it or instruct them to click the final site control',
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
