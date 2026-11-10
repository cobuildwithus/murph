import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault, upsertAutomation } from '@murphai/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canSkipManagedJournalConnectedContext } from '../src/assistant/journal-connected-context-eligibility.js'
import { readConnectedContextPolicy, readConnectedContextPolicyState } from '../src/assistant/journal-connected-context-ledger.js'
import { MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID } from '../src/assistant/managed-automations.js'
import { buildKnowledgePageRelativePath } from '../src/knowledge/documents.js'
import { upsertKnowledgePage } from '../src/knowledge/service.js'
import { createDeferred } from './test-helpers.js'

describe('morning Journal connected-context eligibility', () => {
  let vaultRoot: string
  const request = vi.fn(async () => ({ result: { accounts: [] as unknown[], toolkits: [] } }))
  const check = (overrides: Partial<Parameters<typeof canSkipManagedJournalConnectedContext>[0]> = {}) =>
    canSkipManagedJournalConnectedContext({
      automationId: MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
      connectedApps: { request }, vaultRoot, ...overrides,
    })
  const ledgerPath = () => path.join(vaultRoot, buildKnowledgePageRelativePath('journal-connected-context'))
  const account = (toolkit = 'googlecalendar') => ({
    alias: null, connectedAt: null, id: 'synthetic-account', status: 'ACTIVE',
    toolkit, toolkitConfigured: true, toolkitLabel: 'Synthetic provider', wordId: null,
  })
  const savePolicy = (global = false, activeAccounts: { id: string; provider: string }[] = []) =>
    upsertKnowledgePage({ vault: vaultRoot, slug: 'journal-connected-context', body: JSON.stringify({
      version: 1, optOuts: { global, accounts: [], providers: [], categories: [] }, activeAccounts,
    }) })
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
    request.mockReset().mockResolvedValue({ result: { accounts: [], toolkits: [] } })
  })
  afterEach(async () => {
    vi.useRealTimers()
    await rm(vaultRoot, { recursive: true, force: true })
  })

  it('skips an absent ledger only after a successful authoritative list', async () => {
    expect(await readConnectedContextPolicyState(vaultRoot)).toEqual({ kind: 'absent' })
    expect(await readConnectedContextPolicy(vaultRoot)).toBeNull()
    expect(await check()).toBe(true)
    expect(request).toHaveBeenCalledExactlyOnceWith(
      { operation: 'manage', input: { action: 'list' } }, { signal: expect.any(AbortSignal) },
    )
  })

  it('skips a readable empty-account ledger and ignores unsupported active toolkits', async () => {
    await savePolicy()
    request.mockResolvedValue({ result: { accounts: [account('slack')], toolkits: [] } })
    expect(await check()).toBe(true)
  })

  it('skips global opt-out even with saved accounts and no connected-apps port', async () => {
    await savePolicy(true, [{ id: 'synthetic-account', provider: 'gmail' }])
    expect(await check()).toBe(true)
    expect(await check({ connectedApps: null })).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['active', 'paused'] as const)('admits a %s reminder before any port call, even with global opt-out', async status => {
    await reminder(status)
    await savePolicy(true)
    expect(await check()).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('excludes maintenance by immutable id and archived reminders', async () => {
    await reminder('active', MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID)
    expect(await check()).toBe(true)
    await reminder('archived', MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID)
    await reminder('archived')
    expect(await check()).toBe(true)
    await reminder('paused')
    request.mockClear()
    expect(await check()).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['googlecalendar', 'gmail', 'outlook', 'GoogleCalendar'])('admits a newly connected %s account without a ledger', async toolkit => {
    request.mockResolvedValue({ result: { accounts: [account(toolkit)], toolkits: [] } })
    expect(await check()).toBe(false)
  })

  it('admits saved active accounts for cleanup even when the port would return none', async () => {
    await savePolicy(false, [{ id: 'disconnected-account', provider: 'googlecalendar' }])
    expect(await check()).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['legacy text needing normalization', '{"version":1}', '{broken'])('admits an unparseable ledger: %s', async body => {
    await upsertKnowledgePage({ vault: vaultRoot, slug: 'journal-connected-context', body })
    expect(await readConnectedContextPolicyState(vaultRoot)).toEqual({ kind: 'unreadable' })
    expect(await readConnectedContextPolicy(vaultRoot)).toBeNull()
    expect(await check()).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['status: archived', 'slug: another-ledger'])('admits wrong ledger metadata: %s', async replacement => {
    await savePolicy()
    const markdown = await readFile(ledgerPath(), 'utf8')
    await writeFile(ledgerPath(), markdown.replace(replacement.startsWith('status') ? 'status: active' : 'slug: journal-connected-context', replacement))
    expect(await check()).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not confuse a ledger read error or dangling symlink with absence', async () => {
    await mkdir(ledgerPath(), { recursive: true })
    expect(await check()).toBe(false)
    await rm(ledgerPath(), { recursive: true })
    await symlink(path.join(vaultRoot, 'missing-page'), ledgerPath())
    expect(await check()).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('fails open on inventory read failure', async () => {
    await rm(path.join(vaultRoot, 'bank/automations'), { recursive: true })
    await writeFile(path.join(vaultRoot, 'bank/automations'), 'not a directory')
    expect(await check()).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('fails open when the connected-apps port is missing or throws', async () => {
    expect(await check({ connectedApps: null })).toBe(false)
    request.mockRejectedValue(new Error('Synthetic list failure'))
    expect(await check()).toBe(false)
  })

  it.each([
    null, {}, { accounts: [] }, { accounts: [], toolkits: [], nextCursor: 'more' },
    { accounts: [{ id: 'synthetic-account', toolkit: { slug: 'gmail' } }], toolkits: [] },
    ...['UNKNOWN', 'INACTIVE', 'EXPIRED', 'active'].map(status => ({ accounts: [{ ...account(), status }], toolkits: [] })),
  ])('fails open on an unexpected list result %#', async result => {
    expect(await check({ connectedApps: { request: async () => ({ result }) } })).toBe(false)
  })

  it('fails open on timeout even when the port ignores cancellation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const started = createDeferred<AbortSignal>()
    const pending = check({ connectedApps: { request: async (_request, options) => {
      started.resolve(options!.signal!)
      return new Promise(() => {})
    } } })
    const signal = await started.promise
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toBe(false)
    expect(signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates caller cancellation before and during the port call', async () => {
    await expect(check({ signal: AbortSignal.abort(new Error('Synthetic cancellation')) })).rejects.toThrow('Synthetic cancellation')
    expect(request).not.toHaveBeenCalled()
    const controller = new AbortController()
    const started = createDeferred<void>()
    const pending = check({ signal: controller.signal, connectedApps: { request: async () => {
      started.resolve()
      return new Promise(() => {})
    } } })
    const assertion = expect(pending).rejects.toThrow('Synthetic cancellation')
    await started.promise
    controller.abort(new Error('Synthetic cancellation'))
    await assertion
  })

  it('does not inspect another automation', async () => {
    expect(await check({ automationId: 'aut_other', vaultRoot: path.join(vaultRoot, 'missing') })).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })
})
