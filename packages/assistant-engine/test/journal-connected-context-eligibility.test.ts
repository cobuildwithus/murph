import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault, upsertAutomation } from '@murphai/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canSkipManagedJournalConnectedContext } from '../src/assistant/journal-connected-context-eligibility.js'
import { MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID } from '../src/assistant/managed-automations.js'

// Preparation owns connected-account inventory and controls; its admission is
// covered in journal-connected-context-prepare.test.ts.
describe('morning Journal connected-context eligibility', () => {
  let vaultRoot: string
  const check = (overrides: Partial<Parameters<typeof canSkipManagedJournalConnectedContext>[0]> = {}) =>
    canSkipManagedJournalConnectedContext({
      automationId: MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
      preparedAdmission: 'empty', vaultRoot, ...overrides,
    })
  const reminder = (status: 'active' | 'paused' | 'archived', automationId = 'automation_01JNV422Y2M5ZBV64ZP4N1DRB1') =>
    upsertAutomation({
      vaultRoot, automationId, slug: `synthetic-${automationId.slice(-6).toLowerCase()}`, title: 'Synthetic reminder',
      instructions: 'Follow the explicit reminder request.', status, continuityPolicy: 'fresh',
      route: { channel: 'telegram', deliveryTarget: 'synthetic-room', threadId: 'synthetic-room', threadIsDirect: true,
        identityId: null, participantId: null },
      schedule: { kind: 'dailyLocal', localTime: '09:00' },
    })

  beforeEach(async () => {
    vaultRoot = await mkdtemp(path.join(tmpdir(), 'journal-context-eligibility-'))
    await initializeVault({ vaultRoot, timezone: 'UTC' })
  })
  afterEach(async () => {
    await rm(vaultRoot, { recursive: true, force: true })
  })

  it('skips only an empty prepared admission with no private reminders', async () => {
    expect(await check()).toBe(true)
    expect(await check({ preparedAdmission: 'run' })).toBe(false)
    expect(await check({ preparedAdmission: null })).toBe(false)
    expect(await check({ preparedAdmission: undefined })).toBe(false)
  })

  it.each(['active', 'paused'] as const)('admits a %s reminder even when preparation is empty', async status => {
    await reminder(status)
    expect(await check()).toBe(false)
  })

  it('excludes maintenance by immutable id and archived reminders', async () => {
    await reminder('active', MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID)
    expect(await check()).toBe(true)
    await reminder('archived')
    expect(await check()).toBe(true)
    await reminder('paused')
    expect(await check()).toBe(false)
  })

  it('fails open on a reminder inventory read failure', async () => {
    await rm(path.join(vaultRoot, 'bank/automations'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'bank/automations'), 'not a directory')
    expect(await check()).toBe(false)
  })

  it('propagates caller cancellation', async () => {
    await expect(check({ signal: AbortSignal.abort(new Error('Synthetic cancellation')) }))
      .rejects.toThrow('Synthetic cancellation')
  })

  it('does not inspect another automation', async () => {
    expect(await check({ automationId: 'aut_other', vaultRoot: path.join(vaultRoot, 'missing') })).toBe(false)
  })
})
