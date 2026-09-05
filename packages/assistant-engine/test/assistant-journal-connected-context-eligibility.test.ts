import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

import { initializeVault } from '@murphai/core'

import { canSkipManagedJournalConnectedContext } from '../src/assistant/journal-connected-context-eligibility.ts'
import {
  MURPH_JOURNAL_CONNECTED_CONTEXT_AFTERNOON_AUTOMATION_ID,
  MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
  MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID,
} from '../src/assistant/managed-automations.ts'
import { buildKnowledgePageRelativePath } from '../src/knowledge/documents.ts'
import { upsertKnowledgePage } from '../src/knowledge/service.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []
afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function setup() {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-journal-eligibility-')
  cleanupPaths.push(parentRoot)
  await initializeVault({ vaultRoot })
  const request = vi.fn(async () => ({ result: { accounts: [], toolkits: [] } }))
  return {
    automationId: MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
    connectedApps: { request },
    vaultRoot,
  }
}

test.each([
  MURPH_JOURNAL_CONNECTED_CONTEXT_MORNING_AUTOMATION_ID,
  MURPH_JOURNAL_CONNECTED_CONTEXT_AFTERNOON_AUTOMATION_ID,
])('skips empty managed Journal inventory without provider content reads: %s', async (automationId) => {
  const input = await setup()
  await expect(canSkipManagedJournalConnectedContext({ ...input, automationId })).resolves.toBe(true)
  expect(input.connectedApps.request.mock.calls).toEqual([[{
    input: { action: 'list' },
    operation: 'manage',
  }, { signal: undefined }]])
})

test('keeps Personal Patterns and custom automations outside the Journal gate', async () => {
  const input = await setup()
  for (const automationId of [MURPH_PERSONAL_PATTERNS_UPDATE_AUTOMATION_ID, 'custom-journal-pass']) {
    await expect(canSkipManagedJournalConnectedContext({ ...input, automationId })).resolves.toBe(false)
  }
  expect(input.connectedApps.request).not.toHaveBeenCalled()
})

test('does not interpret an unavailable connected-app port as empty', async () => {
  const input = await setup()
  await expect(canSkipManagedJournalConnectedContext({ ...input, connectedApps: null })).resolves.toBe(false)
})

test.each([
  'Pending follow-up after an event; cancel the existing check-in when appropriate.',
  'Connection notice sent; automatic capture globally disabled.',
  '{}',
])('preserves any existing ledger, including follow-ups and opt-outs: %s', async (body) => {
  const input = await setup()
  await upsertKnowledgePage({
    body,
    pageType: 'ledger',
    slug: 'journal-connected-context',
    vault: input.vaultRoot,
  })
  await expect(canSkipManagedJournalConnectedContext(input)).resolves.toBe(false)
  expect(input.connectedApps.request).not.toHaveBeenCalled()
})

test('preserves a malformed ledger instead of treating failed evidence as absent', async () => {
  const input = await setup()
  const ledgerPath = path.join(input.vaultRoot, buildKnowledgePageRelativePath('journal-connected-context'))
  await mkdir(path.dirname(ledgerPath), { recursive: true })
  await writeFile(ledgerPath, '---\ninvalid: [\n---\nPending check-in.\n')
  await expect(canSkipManagedJournalConnectedContext(input)).resolves.toBe(false)
  expect(input.connectedApps.request).not.toHaveBeenCalled()
})

test('preserves the ordinary run when the knowledge inventory cannot be read', async () => {
  const input = await setup()
  const pagesPath = path.dirname(path.join(input.vaultRoot, buildKnowledgePageRelativePath('journal-connected-context')))
  await rm(pagesPath, { force: true, recursive: true })
  await mkdir(path.dirname(pagesPath), { recursive: true })
  await writeFile(pagesPath, 'Unexpected file instead of the knowledge directory.')
  await expect(canSkipManagedJournalConnectedContext(input)).resolves.toBe(false)
  expect(input.connectedApps.request).not.toHaveBeenCalled()
})

test.each([
  { accounts: [{ id: 'account-new', toolkit: { slug: 'googlecalendar' }, connectedAt: '2026-09-03T00:00:00Z' }], toolkits: [] },
  { accounts: [{ id: 'account-baseline', toolkit: { slug: 'gmail' }, connectedAt: null }], toolkits: [] },
  { accounts: [{ id: 'account-other', toolkit: { slug: 'other' } }], toolkits: [] },
  { accounts: [], toolkits: [], next_cursor: 'more' },
  { accounts: [], toolkits: [], error: 'unavailable' },
  { accounts: [] },
  { toolkits: [] },
  { accounts: null, toolkits: [] },
  null,
])('preserves account notices or uncertain inventory: %j', async (result) => {
  const input = await setup()
  const request = vi.fn(async () => ({ result }))
  await expect(canSkipManagedJournalConnectedContext({ ...input, connectedApps: { request } })).resolves.toBe(false)
  expect(request).toHaveBeenCalledTimes(1)
})

test('falls through on provider failure without retrying or reading content', async () => {
  const input = await setup()
  input.connectedApps.request.mockRejectedValue(new Error('Inventory unavailable'))
  await expect(canSkipManagedJournalConnectedContext(input)).resolves.toBe(false)
  expect(input.connectedApps.request).toHaveBeenCalledTimes(1)
})

test('propagates occurrence cancellation from the account inventory read', async () => {
  const input = await setup()
  const controller = new AbortController()
  input.connectedApps.request.mockImplementation(async () => {
    controller.abort(new Error('Occurrence canceled'))
    return { result: { accounts: [], toolkits: [] } }
  })
  await expect(canSkipManagedJournalConnectedContext({ ...input, signal: controller.signal }))
    .rejects.toThrow('Occurrence canceled')
})
