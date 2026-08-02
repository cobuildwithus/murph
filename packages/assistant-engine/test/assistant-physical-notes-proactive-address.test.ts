import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import {
  MURPH_SEND_PHYSICAL_NOTE_TOOL,
} from '../src/assistant-codex/dynamic-tools/physical-notes.js'

const skillPath = path.join(
  resolveAssistantSkillsRoot(),
  'physical-notes',
  'SKILL.md',
)

async function readSkill(): Promise<string> {
  return (await readFile(skillPath, 'utf8')).replace(/\s+/gu, ' ').trim()
}

describe('assistant physical-note proactive address flow', () => {
  it('resolves objective mailing fields before asking without widening authority', async () => {
    const skill = await readSkill()

    expect(skill).toContain(
      'vault-cli route resolve-address "<address>" --country US --format json',
    )
    expect(skill).toContain(
      'Use `recommendedCandidate` only when it is non-null',
    )
    expect(skill).toContain(
      'Never use address lookup to discover where a person lives, choose among genuinely ambiguous people or destinations, or infer send authority.',
    )
    expect(skill).toContain(
      'Otherwise ask one concise question about the unresolved delivery-critical detail.',
    )
  })

  it('treats a clear note request as enough drafting intent without inventing authorship', async () => {
    const skill = await readSkill()

    expect(skill).toContain(
      'A clear request to send a thank-you, congratulations, apology, or similar note already asks Murph to draft fitting short copy.',
    )
    expect(skill).toContain(
      'Use a signature the requester explicitly supplied or that is already established in their private direct context',
    )
    expect(skill).toContain(
      "never use a room display label or another participant's identity as authorship proof",
    )
    expect(skill).toContain('Do not ask whether Murph should draft the note.')
    expect(skill).toContain(
      'Ask about content only when the intended sender, relationship, signature, or message meaning is materially ambiguous.',
    )
  })

  it('keeps the model-facing send tool on the same resolved-address contract', () => {
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      'narrow temporary address-resolution step',
    )
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      'complete or reliably resolved US address',
    )
    expect(MURPH_SEND_PHYSICAL_NOTE_TOOL.description).toContain(
      'Lookup results complete a destination only; they never identify a recipient or authorize a send.',
    )
  })
})
