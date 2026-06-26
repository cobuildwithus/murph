import { describe, expect, it } from 'vitest'

import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantKnowledgeToolsAvailable: false,
    assistantSupportedExperimentProtocols: [],
    channel: 'local',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-06-26',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
  })
}

describe('assistant system prompt health record ingestion invariant', () => {
  it('requires uploaded medical records to be structured or durably preserved instead of becoming memory-only notes', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('Health record ingestion invariant:')
    expect(prompt).toContain('must not end as only a chat summary, casual note, or freeform memory')
    expect(prompt).toContain('structured facts saved to the best canonical vault surfaces')
    expect(prompt).toContain('durable raw evidence preserved through an existing attachment, document, capture, manifest, or import surface')
    expect(prompt).toContain('blood-test for labs and panels')
  })

  it('makes large record bundles responsive without pretending turn-local subagents can finish post-reply writes', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('For a large or heterogeneous record bundle')
    expect(prompt).toContain('do not make the user wait for exhaustive extraction')
    expect(prompt).toContain('runtime-supported non-blocking background job or subagent')
    expect(prompt).toContain('Do not rely on a turn-local subagent that may outlive the parent turn for required vault writes')
    expect(prompt).toContain('say the full structured extraction did not finish rather than implying it is running')
  })
})
