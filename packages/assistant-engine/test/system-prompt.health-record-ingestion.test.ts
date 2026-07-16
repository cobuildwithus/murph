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

  it('makes large record bundles responsive without making a child the durable owner', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('For a large or mixed bundle')
    expect(prompt).toContain('preserve raw evidence durably and save needed high-value structure before replying')
    expect(prompt).toContain('An optional child may enrich only exact source refs or record ids')
    expect(prompt).toContain('idempotent, provenance-aware writes and dedupe')
    expect(prompt).toContain('A spawn is not durable parse state')
    expect(prompt).toContain('otherwise say which details remain unconfirmed')
    expect(prompt).not.toContain('A delegated parser may outlive the reply')
    expect(prompt).not.toContain('A spawn means parsing is pending, not saved')
    expect(prompt).not.toContain('keep the root turn open until the child is terminal')
  })

  it('keeps the durable minimum in the parent before optional enrichment', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'Finish small, reply-needed extraction and saves in the parent.',
    )
    expect(prompt).toContain(
      'For product lists, parent-batch the reported identity, brand, and status and capture ids before optional label enrichment.',
    )
  })
})
