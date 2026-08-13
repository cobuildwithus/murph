import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
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

  it('makes large record bundles responsive while preserving a durable source', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('For a large or mixed bundle')
    expect(prompt).toContain('preserve the source durably before replying')
    expect(prompt).toContain('A child may write only its named family from that exact source or enrich exact returned record ids')
    expect(prompt).toContain('idempotent, provenance-aware writes and dedupe')
    expect(prompt).toContain('A spawn is not durable parse state')
    expect(prompt).toContain('otherwise say plainly which details you do not have yet')
    expect(prompt).not.toContain('A delegated parser may outlive the reply')
    expect(prompt).not.toContain('A spawn means parsing is pending, not saved')
    expect(prompt).not.toContain('keep the root turn open until the child is terminal')
  })

  it('defaults small saves to the parent but permits an explicit skill split', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain(
      'Finish small, reply-needed extraction and saves in the parent by default.',
    )
    expect(prompt).toContain(
      'A loaded skill may explicitly split independent canonical persistence from the durably accepted current input across bounded children.',
    )
  })

  it('routes workout CSV imports to the on-demand owner', async () => {
    const prompt = buildPrompt()
    const skill = ASSISTANT_SKILLS.find(({ slug }) => slug === 'workout-csv-import')
    const instructions = await readFile(
      path.join(resolveAssistantSkillsRoot(), 'workout-csv-import', 'SKILL.md'),
      'utf8',
    )

    expect(skill?.triggerHint).toContain('Strong, Hevy, an unknown export format')
    expect(prompt).toContain('workout-csv-import owns CSV/history import')
    expect(prompt).not.toContain('one `activity_session` row per grouped workout')
    expect(instructions).toContain('vault-cli workout import inspect')
    expect(instructions).toContain('vault-cli document import')
    expect(instructions).toContain('only the standard-library `csv`')
    expect(instructions).toContain('one temporary JSONL row per workout')
    expect(instructions).toContain('Never use row number')
    expect(instructions).toContain('event import-jsonl --conflict-policy reject')
    expect(instructions).toContain('edited after import')
    expect(instructions).toContain('Confirm the JSONL SHA-256 is unchanged')
    expect(instructions).toContain('never blindly retry after an ambiguous failure')
  })
})
