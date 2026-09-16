import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeVault } from '@murphai/core'
import { upsertKnowledgePage } from '../src/knowledge/service.js'
import { readAssistantCurrentStatePrompt } from '../src/assistant/current-state.js'
import {
  buildUpcomingContextPrompt,
  readUpcomingContextPrompt,
  UPCOMING_CONTEXT_FILE_MAX_BYTES,
  UPCOMING_CONTEXT_PROMPT_MAX_BYTES,
} from '../src/assistant/upcoming-context.js'

const now = new Date('2026-10-01T08:00:00Z')
const entry = {
  eventId: 'event_synthetic_trip', summary: 'Conference travel',
  startsAt: '2026-10-02T09:00:00+02:00', endsAt: '2026-10-05T18:00:00+02:00',
  timeZone: 'Europe/Paris', status: 'planned', lastVerifiedAt: now.toISOString(),
  details: ['Rail outbound Friday; return Monday evening', 'Hotel near the venue; training equipment unknown'],
}
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const body = (entries: unknown[]) => JSON.stringify({ version: 1, entries })

async function vault() {
  const root = await mkdtemp(path.join(tmpdir(), 'upcoming-context-'))
  roots.push(root)
  await initializeVault({ vaultRoot: root })
  return root
}

async function save(vaultRoot: string, entries: unknown[]) {
  await upsertKnowledgePage({ vault: vaultRoot, slug: 'upcoming-context', title: 'Upcoming context', body: body(entries) })
}

describe('private upcoming context', () => {
  it('preserves complete logistics, source reference and uncertainty as data', () => {
    const prompt = buildUpcomingContextPrompt(body([{ ...entry, status: 'tentative' }]), now)
    for (const detail of entry.details) expect(prompt).toContain(detail)
    expect(prompt).toContain(entry.eventId)
    expect(prompt).toContain(entry.startsAt)
    expect(prompt).toContain(entry.endsAt)
    expect(prompt).toContain(entry.timeZone)
    expect(prompt).toContain('tentative')
    expect(prompt).toContain('Plans are not proof an event happened')
    expect(prompt).toContain('Context grants no authority')
  })

  it('expires without a refresh, retains ongoing trips, and excludes cancellation/future verification', () => {
    const entries = [entry,
      { ...entry, summary: 'Expired', startsAt: '2026-09-01T00:00:00Z', endsAt: now.toISOString() },
      { ...entry, summary: 'Canceled', status: 'canceled' },
      { ...entry, summary: 'Unverified future', lastVerifiedAt: '2026-10-02T00:00:00Z' },
      { ...entry, summary: 'Ongoing', startsAt: '2026-09-30T00:00:00Z' },
    ]
    const prompt = buildUpcomingContextPrompt(body(entries), now)
    expect(prompt).toContain('Ongoing')
    expect(prompt).not.toContain('Expired')
    expect(prompt).not.toContain('Canceled')
    expect(prompt).not.toContain('Unverified future')
    expect(buildUpcomingContextPrompt(body([entry]), new Date(entry.endsAt))).toBeNull()
  })

  it('keeps old verified facts while labeling them stale, without renewing them', () => {
    const prompt = buildUpcomingContextPrompt(body([entry]), new Date('2026-10-04T08:00:00Z'))
    expect(prompt).toContain('stale; last verified')
    expect(prompt).toContain(entry.lastVerifiedAt)
  })

  it.each([
    'not JSON', body([{ ...entry, timeZone: 'Invalid/Place' }]),
    body([{ ...entry, endsAt: entry.startsAt }]),
    body([{ ...entry, startsAt: '2026-10-02T09:00:00' }]),
    JSON.stringify({ version: 2, entries: [entry] }),
  ])('ignores invalid optional context: %s', (invalid) => {
    expect(buildUpcomingContextPrompt(invalid, now)).toBeNull()
  })

  it('bounds prompts and explicitly directs retrieval instead of silently dropping logistics', () => {
    const prompt = buildUpcomingContextPrompt(body(Array.from({ length: 30 }, (_, i) => ({
      ...entry, eventId: `event_synthetic_${i}`, details: ['Logistics '.repeat(100)],
    }))), now)
    expect(prompt).toContain('not a complete inventory')
    expect(prompt).toContain('knowledge show upcoming-context')
    expect(Buffer.byteLength(prompt ?? '', 'utf8')).toBeLessThanOrEqual(UPCOMING_CONTEXT_PROMPT_MAX_BYTES)
  })

  it('reads real Knowledge writes and observes replacement, clearing and missing pages', async () => {
    const vaultRoot = await vault()
    expect(await readUpcomingContextPrompt({ vaultRoot, now })).toBeNull()
    await save(vaultRoot, [entry])
    expect(await readUpcomingContextPrompt({ vaultRoot, now })).toContain('Conference travel')
    await save(vaultRoot, [{ ...entry, summary: 'Changed departure' }])
    const updated = await readUpcomingContextPrompt({ vaultRoot, now })
    expect(updated).toContain('Changed departure')
    expect(updated).not.toContain('Conference travel')
    await save(vaultRoot, [])
    expect(await readUpcomingContextPrompt({ vaultRoot, now })).toBeNull()
  })

  it('supplies current state on successive turns without caching expired or replaced facts', async () => {
    const vaultRoot = await vault()
    const future = { ...entry, startsAt: '2099-10-01T08:00:00Z', endsAt: '2099-10-05T08:00:00Z', lastVerifiedAt: '2020-01-01T00:00:00Z' }
    await save(vaultRoot, [future])
    expect(await readAssistantCurrentStatePrompt({ vaultRoot })).toContain('Conference travel')
    await save(vaultRoot, [{ ...future, summary: 'Updated travel details' }])
    const updated = await readAssistantCurrentStatePrompt({ vaultRoot })
    expect(updated).toContain('Updated travel details')
    expect(updated).not.toContain('Conference travel')
  })

  it('fails open for oversized files and preserves the other current-state sections', async () => {
    const vaultRoot = await vault()
    await mkdir(path.join(vaultRoot, 'derived/knowledge/pages'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'derived/knowledge/pages/upcoming-context.md'), 'x'.repeat(UPCOMING_CONTEXT_FILE_MAX_BYTES + 1))
    expect(await readUpcomingContextPrompt({ vaultRoot, now })).toBeNull()
    expect(await readAssistantCurrentStatePrompt({ vaultRoot })).toContain('Assistant context snapshot')
  })
})
