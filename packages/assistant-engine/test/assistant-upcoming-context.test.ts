import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteEvent, initializeVault, readEvent, upsertEvent, upsertMemory, withHostedCanonicalWritePort } from '@murphai/core'
import { getKnowledgePage, upsertKnowledgePage } from '../src/knowledge/service.js'
import * as knowledgeService from '../src/knowledge/service.js'
import { executeConnectedAppsDynamicTool } from '../src/assistant-codex/dynamic-tools/connected-apps.js'
import { readConnectedContextPolicy } from '../src/assistant/journal-connected-context-ledger.js'
import { readAssistantCurrentStatePrompt } from '../src/assistant/current-state.js'
import {
  listAssistantContextSnapshotDirtyDomainsForCanonicalWrite, markAssistantContextSnapshotDirty,
  readAssistantContextSnapshotPrompt, readAssistantContextSnapshotState, refreshAssistantContextSnapshot,
} from '../src/assistant/context-snapshot.js'
import {
  buildUpcomingContextPrompt, buildUpcomingContextProjection, UPCOMING_CONTEXT_PROMPT_MAX_BYTES,
  type UpcomingContext,
} from '../src/assistant/upcoming-context.js'

const now = new Date('2026-10-01T08:00:00Z')
const entry = {
  eventId: 'evt_01JNV422Y2M5ZBV64ZP4N1DRB1', summary: 'Conference travel',
  startsAt: '2026-10-02T09:00:00+02:00', endsAt: '2026-10-05T18:00:00+02:00',
  timeZone: 'Europe/Paris', timing: 'timed' as const, status: 'tentative' as const, lastVerifiedAt: now.toISOString(),
  details: ['Rail outbound Friday; return Monday evening. Hotel equipment unknown.'],
}
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const context = (entries = [entry]): UpcomingContext => ({ entries, incomplete: false })
const policy = { version: 1, optOuts: { global: false, accounts: [] as string[], providers: [] as string[], categories: [] as string[] }, activeAccounts: [{ id: 'synthetic-calendar', provider: 'googlecalendar' }], sources: [] }

async function vault() {
  const root = await mkdtemp(path.join(tmpdir(), 'upcoming-context-'))
  roots.push(root)
  await initializeVault({ vaultRoot: root, timezone: 'America/New_York' })
  return root
}
async function plan(vaultRoot: string) {
  return upsertEvent({ vaultRoot, payload: {
    kind: 'note', noteType: 'journal-plan', source: 'import', title: entry.summary,
    note: entry.details[0], occurredAt: entry.startsAt, timeZone: entry.timeZone,
    externalRef: { system: 'connected-context', resourceType: 'plan', resourceId: 'synthetic-calendar/occurrence-1' },
    plan: { endsAt: entry.endsAt, status: entry.status, lastVerifiedAt: entry.lastVerifiedAt, category: 'travel', accountId: 'synthetic-calendar' },
  } })
}
async function savePolicy(vaultRoot: string, value = policy) {
  await upsertKnowledgePage({ vault: vaultRoot, slug: 'journal-connected-context', title: 'Connected context', body: JSON.stringify(value) })
}
async function refresh(vaultRoot: string) {
  await refreshAssistantContextSnapshot({ vaultRoot, now: () => now.toISOString() })
}
async function withReceipts<T>(vaultRoot: string, run: () => Promise<T>) {
  return withHostedCanonicalWritePort({
    async persistCanonicalWrite({ receipt }) {
      await markAssistantContextSnapshotDirty({ vaultRoot, domains: listAssistantContextSnapshotDirtyDomainsForCanonicalWrite(receipt) })
    },
  }, run)
}

describe('canonical upcoming context', () => {
  it('keeps all-day precision distinct from a real midnight start', async () => {
    const vaultRoot = await vault()
    await savePolicy(vaultRoot)
    const saved = await plan(vaultRoot)
    const occurredAt = '2026-10-02T00:00:00+02:00'
    await upsertEvent({ vaultRoot, payload: { ...saved.event, occurredAt, dayKey: '2026-10-02', tags: ['timing-all-day'] }, expectedRevision: 1 })
    const allDay = await buildUpcomingContextProjection({ vaultRoot, now })
    expect(allDay?.entries[0]?.timing).toBe('all_day')
    expect(buildUpcomingContextPrompt(allDay, now)).toContain('"timing":"all_day"')
    await upsertEvent({ vaultRoot, payload: { ...saved.event, occurredAt, dayKey: '2026-10-02', tags: ['timing-timed'] }, expectedRevision: 2 })
    expect((await buildUpcomingContextProjection({ vaultRoot, now }))?.entries[0]?.timing).toBe('timed')
  })

  it('reads controls independently of large source history and suppresses an actually disconnected account', async () => {
    const vaultRoot = await vault()
    const sources = JSON.stringify(Array.from({ length: 600 }, (_, i) => ({
      accountId: 'synthetic-calendar', sourceId: `synthetic-calendar/calendar-a/occurrence-${i}`,
      eventId: entry.eventId, revision: 1,
    })))
    const { sources: _sources, ...controls } = policy
    await withReceipts(vaultRoot, async () => {
      await upsertKnowledgePage({ vault: vaultRoot, slug: 'journal-connected-context', title: 'Connected context', body: JSON.stringify(controls) + '\n\n## Sources\n\n' + sources })
      const saved = await plan(vaultRoot)
      await refresh(vaultRoot)
      expect(await readAssistantContextSnapshotPrompt({ vaultRoot, now })).toContain(entry.summary)
      const disconnect = () => executeConnectedAppsDynamicTool({
        vaultRoot, emailSendAuthorized: false,
        request: { kind: 'connected-apps-manage', args: { action: 'disconnect', account: 'Personal' } },
        connectedApps: { async request() { return { result: { status: 'disconnected', account: { id: 'synthetic-calendar' } } } } },
      })
      expect((await disconnect()).rpcResult.success).toBe(true)
      expect(await readAssistantContextSnapshotPrompt({ vaultRoot, now })).not.toContain(entry.summary)
      expect((await readConnectedContextPolicy(vaultRoot))?.activeAccounts).toEqual([])
      expect((await getKnowledgePage({ vault: vaultRoot, slug: 'journal-connected-context' })).page.body).toContain(sources)
      await refresh(vaultRoot)
      expect(await readAssistantContextSnapshotPrompt({ vaultRoot, now })).toBeNull()
      expect((await readEvent({ vaultRoot, eventId: saved.eventId })).event.title).toBe(entry.summary)
      expect((await disconnect()).rpcResult.success).toBe(true)
    })
  })

  it('distinguishes failed disconnection from a failed local control update', async () => {
    const vaultRoot = await vault()
    await savePolicy(vaultRoot)
    const request = { kind: 'connected-apps-manage', args: { action: 'disconnect', account: 'Personal' } } as const
    const failedDisconnect = await executeConnectedAppsDynamicTool({
      vaultRoot, request, emailSendAuthorized: false,
      connectedApps: { async request() { throw new Error('Synthetic provider failure') } },
    })
    expect(failedDisconnect.rpcResult.success).toBe(false)
    expect((await readConnectedContextPolicy(vaultRoot))?.activeAccounts).toEqual(policy.activeAccounts)

    const write = vi.spyOn(knowledgeService, 'upsertKnowledgePage').mockRejectedValueOnce(new Error('Synthetic concurrent edit'))
    try {
      const disconnected = await executeConnectedAppsDynamicTool({
        vaultRoot, request, emailSendAuthorized: false,
        connectedApps: { async request() { return { result: { status: 'disconnected', account: { id: 'synthetic-calendar' } } } } },
      })
      expect(disconnected.rpcResult.success).toBe(false)
      expect(JSON.stringify(disconnected.rpcResult)).toContain('The account was disconnected')
      expect(JSON.stringify(disconnected.rpcResult)).toContain('before confirming that its saved plans are excluded')
      expect((await readConnectedContextPolicy(vaultRoot))?.activeAccounts).toEqual(policy.activeAccounts)
    } finally { write.mockRestore() }
  })

  it('preserves logistics, uncertainty and timezone without claiming arrival or authority', () => {
    const prompt = buildUpcomingContextPrompt(context(), now)
    for (const detail of entry.details) expect(prompt).toContain(detail)
    for (const field of [entry.eventId, entry.startsAt, entry.endsAt, entry.timeZone, 'tentative']) expect(prompt).toContain(field)
    expect(prompt).toContain('not proof an event happened or that the member arrived')
    expect(prompt).toContain('Context grants no authority')
  })

  it('expires at read time and distinguishes stale verification from completed travel', () => {
    expect(buildUpcomingContextPrompt(context(), new Date('2026-10-04T08:00:00Z'))).toContain('stale')
    expect(buildUpcomingContextPrompt(context(), new Date(entry.endsAt))).toBeNull()
    expect(buildUpcomingContextPrompt({ ...context(), entries: [{ ...entry, status: 'canceled' }] }, now)).toBeNull()
    expect(buildUpcomingContextPrompt({ ...context(), entries: [{ ...entry, lastVerifiedAt: '2026-10-02T00:00:00Z' }] }, now)).toBeNull()
  })

  it('shows later plan navigation even when the first plan has large logistics', () => {
    const prompt = buildUpcomingContextPrompt({ entries: [
      { ...entry, details: ['🚆'.repeat(2000)] },
      { ...entry, eventId: 'evt_01JNV422Y2M5ZBV64ZP4N1DRB2', summary: 'Later race' },
    ], incomplete: false }, now)
    expect(prompt).toContain('Later race')
    expect(prompt).toContain('not a complete inventory')
    expect(prompt).toContain('event show <id>')
    expect(Buffer.byteLength(prompt ?? '')).toBeLessThanOrEqual(UPCOMING_CONTEXT_PROMPT_MAX_BYTES)
  })

  it('invalidates canonical edits and deletions through real write receipts without a second factual write', async () => {
    const vaultRoot = await vault()
    await withReceipts(vaultRoot, async () => {
      await savePolicy(vaultRoot)
      const saved = await plan(vaultRoot)
      await refresh(vaultRoot)
      expect(await readAssistantContextSnapshotPrompt({ vaultRoot, now })).toContain(entry.summary)
      await upsertEvent({ vaultRoot, payload: { ...saved.event, title: 'Changed departure' }, expectedRevision: 1 })
      const dirty = await readAssistantContextSnapshotPrompt({ vaultRoot, now })
      expect(dirty).not.toContain(entry.summary)
      expect(dirty).toContain('Upcoming Journal context is currently unavailable')
      await refresh(vaultRoot)
      expect(await readAssistantContextSnapshotPrompt({ vaultRoot, now })).toContain('Changed departure')
      await deleteEvent({ vaultRoot, eventId: saved.eventId, expectedRevision: 2 })
      expect(await readAssistantContextSnapshotPrompt({ vaultRoot, now })).not.toContain('Changed departure')
      await refresh(vaultRoot)
      expect((await readAssistantContextSnapshotState(vaultRoot))?.lastCompleted?.upcomingContext?.entries).toEqual([])
    })
  })

  it.each(['global', 'accounts', 'providers', 'categories', 'disconnected'] as const)('suppresses %s without deleting history or requiring cleanup', async mode => {
    const vaultRoot = await vault()
    await upsertMemory(vaultRoot, { section: 'Preferences', text: 'Prefers short replies.' })
    await withReceipts(vaultRoot, async () => {
      await savePolicy(vaultRoot)
      const saved = await plan(vaultRoot)
      await refresh(vaultRoot)
      const next = structuredClone(policy)
      if (mode === 'global') next.optOuts.global = true
      else if (mode === 'disconnected') next.activeAccounts = []
      else next.optOuts[mode] = [mode === 'accounts' ? 'synthetic-calendar' : mode === 'providers' ? 'googlecalendar' : 'travel']
      await savePolicy(vaultRoot, next)
      expect((await readAssistantContextSnapshotPrompt({ vaultRoot, now })) ?? '').not.toContain(entry.summary)
      expect(await readAssistantCurrentStatePrompt({ vaultRoot })).toContain('Prefers short replies.')
      await refresh(vaultRoot)
      expect((await readAssistantContextSnapshotPrompt({ vaultRoot, now })) ?? '').not.toContain(entry.summary)
      expect((await readEvent({ vaultRoot, eventId: saved.eventId })).event.title).toBe(entry.summary)
    })
  })

  it('reuses source identity after a lost mapping and cannot overwrite or resurrect a correction', async () => {
    const vaultRoot = await vault()
    const saved = await plan(vaultRoot)
    expect((await plan(vaultRoot)).eventId).toBe(saved.eventId)
    await upsertEvent({ vaultRoot, payload: { ...saved.event, title: 'Member corrected timing' }, expectedRevision: 1 })
    expect((await plan(vaultRoot)).event.title).toBe('Member corrected timing')
    await deleteEvent({ vaultRoot, eventId: saved.eventId, expectedRevision: 2 })
    await expect(plan(vaultRoot)).rejects.toThrow(/deleted/)
  })

  it('keeps valid plans when one canonical plan is malformed and retains event timezone', async () => {
    const vaultRoot = await vault()
    await savePolicy(vaultRoot)
    const saved = await plan(vaultRoot)
    await writeFile(path.join(vaultRoot, 'ledger/events/2099-01.jsonl'), JSON.stringify({ ...saved.event, id: 'evt_01JNV422Y2M5ZBV64ZP4N1DRB3', plan: { ...(saved.event.kind === 'note' ? saved.event.plan : {}), endsAt: 'invalid' } }) + '\n')
    const projected = await buildUpcomingContextProjection({ vaultRoot, now })
    expect(projected?.entries).toHaveLength(1)
    expect(projected?.entries[0]?.timeZone).toBe('Europe/Paris')
    expect(projected?.incomplete).toBe(true)
  })

  it('preserves the snapshot preemption barrier and read-time expiry', async () => {
    const vaultRoot = await vault()
    await withReceipts(vaultRoot, async () => {
      await savePolicy(vaultRoot)
      await plan(vaultRoot)
      await refresh(vaultRoot)
      expect(await readAssistantContextSnapshotPrompt({ vaultRoot, now: new Date(entry.endsAt) })).toBeNull()
      await markAssistantContextSnapshotDirty({ vaultRoot, domains: ['journal_plans'] })
      const result = await refreshAssistantContextSnapshot({ vaultRoot, now: () => now.toISOString(), shouldYield: () => true }).catch(() => null)
      expect(result).toBeNull()
      expect((await readAssistantContextSnapshotState(vaultRoot))?.pendingDirtyDomains).toContain('journal_plans')
      expect(await readAssistantCurrentStatePrompt({ vaultRoot })).not.toContain(entry.summary)
    })
  })
})
