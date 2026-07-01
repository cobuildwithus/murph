import { rm } from 'node:fs/promises'
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
  saveAssistantSession,
} from '../src/assistant/store.ts'
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
