import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { initializeVault } from '@murphai/core'
import { describe, expect, it } from 'vitest'
import { readAssistantContextSnapshotPrompt, refreshAssistantContextSnapshot } from '../src/assistant/context-snapshot.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
import { seedImportedRecallMeal, seedImportedRecallPhoto, SYNTHETIC_IMPORTED_MEAL } from './support/imported-record-recall-fixture.js'

describe('imported-record natural recall evidence', () => {
  it('exposes two device photo-only captures to bounded canonical reads before any enrichment', async () => {
    const vault = await mkdtemp(path.join(tmpdir(), 'murph-recall-photo-proof-'))
    try {
      await initializeVault({ vaultRoot: vault, timezone: 'UTC' })
      const earlier = await seedImportedRecallPhoto(vault, '2026-04-11T10:59:50Z', 'synthetic_photo_earlier')
      const latest = await seedImportedRecallPhoto(vault, '2026-04-11T11:00:00Z', 'synthetic_photo_latest')
      expect(latest.photo).not.toBeNull()
      expect(latest.event.note).toBeUndefined()
      const { stdout } = await promisify(execFile)(process.execPath, [
        fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url)),
        'meal', 'list', '--from', '2026-04-11', '--to', '2026-04-11',
        '--limit', '2', '--format', 'json', '--vault', vault,
      ])
      expect(stdout).toContain(latest.mealId)
      expect(stdout).toContain('device')
      expect(stdout).not.toMatch(/avocado|chickpea/iu)
      const shown = await promisify(execFile)(process.execPath, [
        fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url)),
        'meal', 'show', latest.mealId, '--format', 'json', '--vault', vault,
      ])
      expect(shown.stdout).toContain('photo')
      expect(shown.stdout).not.toMatch(/avocado|chickpea/iu)
      const cli = promisify(execFile)
      const entrypoint = fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url))
      const oldest = await cli(process.execPath, [entrypoint, 'meal', 'list', '--limit', '1', '--format', 'json', '--vault', vault])
      expect(oldest.stdout).toContain(earlier.mealId)
      expect(oldest.stdout).not.toContain(latest.mealId)
      const newest = await cli(process.execPath, [entrypoint, 'timeline', '--entry-type', 'event', '--kind', 'meal', '--limit', '1', '--format', 'json', '--vault', vault])
      expect(newest.stdout).toContain(latest.mealId)
      expect(newest.stdout).not.toContain(earlier.mealId)
    } finally { await rm(vault, { recursive: true, force: true }) }
  })

  it('routes private latest-meal recall to a descending read without adding a new-capture preflight', async () => {
    const skill = await readFile(new URL('../skills/food-journal/SKILL.md', import.meta.url), 'utf8')
    expect(skill).toContain('For private recent-meal recall, read canonical records before asking')
    expect(skill).toContain('vault-cli timeline --entry-type event --kind meal --limit 1 --format json')
    expect(skill).toContain('`meal list --limit 1` does not find the latest meal')
    expect(skill).toContain('Do not list meals as a prerequisite to a new capture.')
  })
  it('keeps an out-of-conversation device record readable despite omission from the navigation snapshot', async () => {
    const vault = await mkdtemp(path.join(tmpdir(), 'murph-recall-proof-'))
    try {
      await initializeVault({ vaultRoot: vault, timezone: 'UTC' })
      await seedImportedRecallMeal(vault, '2026-04-11T11:00:00Z')
      await refreshAssistantContextSnapshot({ vaultRoot: vault, now: () => '2026-04-11T12:00:00Z' })
      const snapshot = await readAssistantContextSnapshotPrompt({ vaultRoot: vault, now: new Date('2026-04-11T12:00:00Z') })
      expect(snapshot ?? '').not.toContain(SYNTHETIC_IMPORTED_MEAL)
      const { stdout } = await promisify(execFile)(process.execPath, [
        fileURLToPath(new URL('../../cli/dist/bin.js', import.meta.url)),
        'meal', 'list', '--from', '2026-04-11', '--to', '2026-04-11',
        '--limit', '10', '--format', 'json', '--vault', vault,
      ])
      expect(stdout).toContain(SYNTHETIC_IMPORTED_MEAL)
      expect(stdout).toContain('device')
    } finally { await rm(vault, { recursive: true, force: true }) }
  })

  it('already gives ordinary direct turns source-first resolution and canonical query discovery', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null, assistantContextSnapshotPrompt: null,
      assistantHostedDeviceConnectAvailable: false, assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false, channel: 'linq',
      cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
      conversationScope: 'direct', hostedRuntime: true, ordinaryInboundTurn: true,
      currentInstant: '2026-04-11T12:00:00Z', currentLocalDate: '2026-04-11', currentTimeZone: 'UTC',
      modelBehaviorProfile: 'gpt5-agentic', onboardingGuidance: false, turnTrigger: null,
    })
    expect(prompt).toContain('Resolve ambiguity with available context first')
    expect(prompt).toContain('Ask only for missing subjective context, ambiguous details, consent, or facts no available source can answer.')
    expect(prompt).toContain('Use canonical query surfaces first for health data')
    expect(prompt).not.toContain('This is an output-only turn.')
    expect(prompt).not.toContain('This turn was triggered by an existing scheduled automation run.')
  })
})
