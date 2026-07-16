import { describe, expect, it } from 'vitest'

import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantKnowledgeToolsAvailable: false,
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
    expect(prompt).not.toContain('must be terminal and the resulting state confirmed before the final reply')
    expect(prompt).toContain('blood-test for labs and panels')
  })

  it('makes large record bundles responsive while background children own canonical writes', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('For a large or mixed bundle')
    expect(prompt).toContain('Preserve the raw evidence, save the high-value structure needed now')
    expect(prompt).toContain('do not make the user wait for exhaustive extraction')
    expect(prompt).toContain('Then delegate the remaining bounded parse or write work when useful')
    expect(prompt).toContain('A delegated parser may outlive the reply')
    expect(prompt).toContain('It uses durable paths, idempotent provenance-aware writes, and dedupe')
    expect(prompt).toContain('reports saved ids or the blocker privately')
    expect(prompt).toContain('A spawn means parsing is pending, not saved')
    expect(prompt).toContain('If background parsing is unavailable, preserve the source and state that full extraction is incomplete')
    expect(prompt).not.toContain('keep the root turn open until the child is terminal')
  })

  it('lets a specific flow delegate a small independent record without waiting', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'For a small item needed for the current answer',
    )
    expect(prompt).toContain(
      'When one clean report or product list can be parsed or persisted independently of the visible answer, delegate it and reply without waiting.',
    )
  })
})
