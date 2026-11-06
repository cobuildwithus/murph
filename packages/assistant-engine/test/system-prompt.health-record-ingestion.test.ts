import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
import { MURPH_ATTACH_RESPONSE_CARD_TOOL } from '../src/assistant-codex/dynamic-tool-catalog.js'
import { MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION } from '../src/assistant/managed-automations.js'

function buildPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantKnowledgeToolsAvailable: false,
    channel: 'local',
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    currentLocalDate: '2026-06-26',
    currentTimeZone: 'America/New_York',
    onboardingGuidance: false,
  })
}

describe('assistant system prompt health record ingestion invariant', () => {
  it('separates dish names from notes and excludes non-food photos across loaded guidance', async () => {
    const prompt = buildPrompt()
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/food-journal/SKILL.md')
    const food = await readFile(path.join(resolveAssistantSkillsRoot(), 'food-journal', 'SKILL.md'), 'utf8')
    const automatic = await readFile(path.join(resolveAssistantSkillsRoot(), 'automatic-meal-capture', 'SKILL.md'), 'utf8')
    const normalizedFood = food.replace(/\s+/gu, ' ')
    expect(normalizedFood).toContain('sentence-case dish name: 2–5 words, at most 40 characters')
    expect(normalizedFood).toContain('Keep portions, uncertainty, brands, and places in `--note`')
    expect(normalizedFood).toContain('Never log a meal from a non-food image or food/drink that the member did not consume')
    expect(food).toContain('--name "<short dish name>"')
    expect(food).toContain('meal edit --name')
    expect(automatic).toMatch(/An imported photo stub is not\s+evidence of consumption/u)
    expect(automatic).not.toContain('record only that the retained image was')
    const closeout = automatic.replace(/\s+/gu, ' ')
    expect(closeout).toContain('run `vault-cli meal delete <meal-id>` and confirm it is absent with a fresh bounded `meal list`')
    expect(closeout).toContain('Write no note and run no `remove-photo` for that meal')
    expect(closeout).toContain('This applies to interactive enrichment and scheduled closeout')
    expect(closeout).toContain('Never delete a stub with a member-written note')
    expect(closeout).toContain('Never delete from classifier acceptance, a guess, or difficulty estimating food')
    expect(closeout).toContain('unclear images follow the food workflow above')
    expect(closeout).toContain('On retry, refresh the queue and skip meals already absent')
    expect(closeout).toContain('For surviving meals only')
    expect(closeout).toContain('from closeout text, questions, and cards')
    expect(closeout).toContain('Any command failure, including a failed delete, fails the run')
    const recovery = await readFile(path.join(resolveAssistantSkillsRoot(), 'food-journal', 'references', 'day-recovery.md'), 'utf8')
    for (const guidance of [normalizedFood, recovery.replace(/\s+/gu, ' ')]) {
      expect(guidance).toMatch(/(?:delete|deletion).*?(?:member-written notes)|member-written notes.*?(?:delete|deletion)/iu)
    }
    for (const guidance of [automatic, food, recovery, prompt, MURPH_ATTACH_RESPONSE_CARD_TOOL.description]) {
      expect(guidance.replace(/\s+/gu, ' ')).not.toMatch(/record only the supported non-food|Read the factual observation back|neither saved nutrition nor that observation/u)
    }
    const managed = MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION.instructions
    expect(managed).toContain('A review-completion failure or any selected pending photo attachment remaining fails the run')
    expect(closeout).not.toContain('defer')
  })

  it('requires uploaded medical records to be structured or durably preserved instead of becoming memory-only notes', async () => {
    const prompt = buildPrompt()
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'health-records', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/health-records/SKILL.md')

    expect(prompt).toContain('Saving what the member shares:')
    expect(prompt).toContain('never ends as only a chat answer, casual note, or memory')
    expect(prompt).toContain('Save each fact once, through its canonical owner')
    expect(prompt).toContain('preserve the source through an existing attachment, document, capture, manifest, or import surface')
    expect(prompt).not.toContain('must be terminal and the resulting state confirmed before the final reply')
    expect(skill).toContain('Labs and panels: `blood-test`')
  })

  it('makes large record bundles responsive while preserving a durable source', async () => {
    const prompt = buildPrompt()
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'health-records', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/health-records/SKILL.md')

    expect(skill).toContain('For a large or mixed bundle')
    expect(skill).toContain('preserve the source durably before replying')
    expect(skill).toContain('A child may write only its named family from that exact source, or enrich exact returned record ids')
    expect(skill).toContain('idempotent, provenance-aware writes and dedupe')
    expect(skill).toContain('A spawn is not durable parse state')
    expect(skill).toContain('otherwise say plainly which details you do not have yet')
    expect(skill).not.toContain('A delegated parser may outlive the reply')
    expect(skill).not.toContain('A spawn means parsing is pending, not saved')
    expect(skill).not.toContain('keep the root turn open until the child is terminal')
  })

  it('defaults small saves to the parent but permits an explicit skill split', async () => {
    const prompt = buildPrompt()
    const skill = (await readFile(
      path.join(resolveAssistantSkillsRoot(), 'health-records', 'SKILL.md'), 'utf8',
    )).replace(/\s+/gu, ' ')
    expect(prompt).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/health-records/SKILL.md')

    expect(skill).toContain(
      'Finish small, reply-needed extraction and saves yourself.',
    )
    expect(skill).toContain(
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
    expect(prompt).toContain('workout-csv-import owns workout CSVs')
    expect(prompt).not.toContain('one `activity_session` row per grouped workout')
    expect(instructions).toContain('vault-cli workout import inspect')
    expect(instructions).toContain('vault-cli document import')
    expect(instructions).toContain('standard library only')
    expect(instructions).toContain('zoneinfo.ZoneInfo')
    expect(instructions).toContain('ambiguous or nonexistent daylight-saving wall time')
    expect(instructions).toContain('one temporary JSONL row per workout')
    expect(instructions).toContain('document workout-import-status')
    expect(instructions).toContain('event import-jsonl --input @<temporary.jsonl> --source-raw-ref-once')
    expect(instructions).toContain('Do not add model-authored `externalRef` values')
    expect(instructions).toContain('prior source document was deleted')
    expect(instructions).toContain('Confirm the JSONL SHA-256 is unchanged')
    expect(instructions).toContain('Never blindly retry a failed apply')
    expect(instructions).toContain('status check again in the same turn')
    expect(instructions).toContain('exactly one proof-backed recovery apply')
  })
})
