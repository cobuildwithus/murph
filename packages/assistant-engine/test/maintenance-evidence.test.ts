import { rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, test } from 'vitest'

import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  ASSISTANT_MAINTENANCE_EVIDENCE_HEADING,
  buildAssistantMaintenanceConversationEvidence,
} from '../src/assistant/maintenance-evidence.ts'
import {
  appendAssistantTranscriptEntries,
  listAssistantTranscriptTailEntries,
  listRecentAssistantSessions,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  )
})

function createEvidenceTestSession(input: {
  lastTurnAt: string | null
  sessionId: string
}): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-session.v1',
    sessionId: input.sessionId,
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.5',
      modelProvider: 'vercel-ai-gateway',
      oss: false,
      profile: null,
      reasoningEffort: 'medium',
      sandbox: 'danger-full-access',
    },
    resumeState: null,
    alias: null,
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: input.lastTurnAt ?? '2026-06-01T00:00:00.000Z',
    lastTurnAt: input.lastTurnAt,
    turnCount: input.lastTurnAt === null ? 0 : 1,
  })
}

test('builds bounded committed conversation evidence across recent sessions', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-',
  )
  cleanupPaths.push(parentRoot)

  const now = new Date('2026-06-30T03:00:00.000Z')

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T21:00:00.000Z',
      sessionId: 'session-recent',
    }),
  )
  await appendAssistantTranscriptEntries(vaultRoot, 'session-recent', [
    {
      createdAt: '2026-06-20T09:00:00.000Z',
      kind: 'user',
      text: 'Too old to be included.',
    },
    {
      createdAt: '2026-06-28T09:00:00.000Z',
      kind: 'user',
      text: 'I switched to decaf\ncoffee this week.',
    },
    {
      createdAt: '2026-06-28T09:00:05.000Z',
      kind: 'assistant',
      text: 'Noted, updated your coffee experiment.',
    },
    {
      createdAt: '2026-06-28T09:00:10.000Z',
      kind: 'status',
      text: 'internal status entry',
    },
  ])

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-05-01T09:00:00.000Z',
      sessionId: 'session-stale',
    }),
  )
  await appendAssistantTranscriptEntries(vaultRoot, 'session-stale', [
    {
      createdAt: '2026-05-01T09:00:00.000Z',
      kind: 'user',
      text: 'Stale session message.',
    },
  ])

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now,
    vault: vaultRoot,
  })

  expect(evidence).toContain(ASSISTANT_MAINTENANCE_EVIDENCE_HEADING)
  expect(evidence).toContain(
    '- [2026-06-28T09:00:00.000Z] user: I switched to decaf coffee this week.',
  )
  expect(evidence).toContain(
    '- [2026-06-28T09:00:05.000Z] assistant: Noted, updated your coffee experiment.',
  )
  expect(evidence).not.toContain('Too old to be included.')
  expect(evidence).not.toContain('Stale session message.')
  expect(evidence).not.toContain('internal status entry')
})

test('bounds transcript evidence reads to the tail byte cap', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-tail-',
  )
  cleanupPaths.push(parentRoot)

  await appendAssistantTranscriptEntries(vaultRoot, 'session-tail', [
    {
      createdAt: '2026-06-28T09:00:00.000Z',
      kind: 'user',
      text: 'oldest message that the tail cap should drop',
    },
    {
      createdAt: '2026-06-28T09:00:01.000Z',
      kind: 'user',
      text: 'middle message',
    },
    {
      createdAt: '2026-06-28T09:00:02.000Z',
      kind: 'user',
      text: 'newest message',
    },
  ])

  const all = await listAssistantTranscriptTailEntries(vaultRoot, 'session-tail', {
    maxBytes: 1_000_000,
  })
  expect(all.map((entry) => entry.text)).toEqual([
    'oldest message that the tail cap should drop',
    'middle message',
    'newest message',
  ])

  // Small enough to cut into the oldest line: the partial first line is
  // dropped and only fully contained newest entries are returned.
  const tail = await listAssistantTranscriptTailEntries(vaultRoot, 'session-tail', {
    maxBytes: 240,
  })
  expect(tail.length).toBeGreaterThan(0)
  expect(tail.length).toBeLessThan(3)
  expect(tail[tail.length - 1]?.text).toBe('newest message')
  expect(tail.map((entry) => entry.text)).not.toContain(
    'oldest message that the tail cap should drop',
  )
})

test('bounds session reads to the newest sessions by durable activity', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-session-cap-',
  )
  cleanupPaths.push(parentRoot)

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T21:00:00.000Z',
      sessionId: 'session-older-activity',
    }),
  )
  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T22:00:00.000Z',
      sessionId: 'session-newer-activity',
    }),
  )

  const limited = await listRecentAssistantSessions(vaultRoot, { limit: 1 })
  expect(limited.map((session) => session.sessionId)).toEqual([
    'session-newer-activity',
  ])

  const unlimited = await listRecentAssistantSessions(vaultRoot, { limit: 10 })
  expect(unlimited.map((session) => session.sessionId).sort()).toEqual([
    'session-newer-activity',
    'session-older-activity',
  ])

  // Recovery path: an index without the projection (or restored without it)
  // is rebuilt once from durable session records instead of staying blind.
  const paths = resolveAssistantStatePaths(vaultRoot)
  await writeFile(
    paths.indexesPath,
    JSON.stringify({ version: 1, aliases: {}, conversationKeys: {} }),
    'utf8',
  )
  const rebuilt = await listRecentAssistantSessions(vaultRoot, { limit: 1 })
  expect(rebuilt.map((session) => session.sessionId)).toEqual([
    'session-newer-activity',
  ])
})

test('returns an explicit empty evidence section when the window has no messages', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-empty-',
  )
  cleanupPaths.push(parentRoot)

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-06-30T03:00:00.000Z'),
    vault: vaultRoot,
  })

  expect(evidence).toContain(ASSISTANT_MAINTENANCE_EVIDENCE_HEADING)
  expect(evidence).toContain('Do not write any new memory this run.')
})
