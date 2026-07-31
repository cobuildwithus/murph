import { rm, writeFile } from 'node:fs/promises'
import { afterEach, expect, test } from 'vitest'

import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'

import {
  ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_HEADING,
  ASSISTANT_MAINTENANCE_EVIDENCE_HEADING,
  buildAssistantMaintenanceConversationEvidence,
} from '../src/assistant/maintenance-evidence.ts'
import {
  appendAssistantTranscriptEntries,
  listAssistantSessions,
  listAssistantTranscriptTailEntries,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { buildAssistantNoReplyTranscriptMarkerText } from '../src/assistant/turn-finalizer.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  )
})

function createEvidenceTestSession(input: {
  channel?: string | null
  lastTurnAt: string | null
  sessionId: string
  threadIsDirect?: boolean | null
}): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-session.v1',
    sessionId: input.sessionId,
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: 'gpt-5.6-terra',
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
      channel: input.channel ?? null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: input.threadIsDirect ?? null,
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

test('uses legacy assistant session files for maintenance evidence', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-legacy-repair-',
  )
  cleanupPaths.push(parentRoot)

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T22:00:00.000Z',
      sessionId: 'session-legacy-newer',
    }),
  )
  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T21:00:00.000Z',
      sessionId: 'session-legacy-older',
    }),
  )
  await appendAssistantTranscriptEntries(vaultRoot, 'session-legacy-newer', [
    {
      createdAt: '2026-06-29T22:00:00.000Z',
      kind: 'user',
      text: 'Legacy assistant session files should still surface this message.',
    },
  ])

  const paths = resolveAssistantStatePaths(vaultRoot)
  await writeFile(
    paths.indexesPath,
    JSON.stringify({ version: 1, aliases: {}, conversationKeys: {} }),
    'utf8',
  )

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-06-30T03:00:00.000Z'),
    vault: vaultRoot,
  })

  expect(evidence).not.toContain('No committed user or assistant conversation messages')
  expect(evidence).toContain(
    '- [2026-06-29T22:00:00.000Z] user: Legacy assistant session files should still surface this message.',
  )
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

  const limited = await listAssistantSessions(vaultRoot, { limit: 1 })
  expect(limited.map((session) => session.sessionId)).toEqual([
    'session-newer-activity',
  ])

  const unlimited = await listAssistantSessions(vaultRoot)
  expect(unlimited.map((session) => session.sessionId).sort()).toEqual([
    'session-newer-activity',
    'session-older-activity',
  ])

  const paths = resolveAssistantStatePaths(vaultRoot)
  await writeFile(
    paths.indexesPath,
    JSON.stringify({ version: 1, aliases: {}, conversationKeys: {} }),
    'utf8',
  )
  const legacyIndexed = await listAssistantSessions(vaultRoot, { limit: 10 })
  expect(legacyIndexed.map((session) => session.sessionId).sort()).toEqual([
    'session-newer-activity',
    'session-older-activity',
  ])

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T23:00:00.000Z',
      sessionId: 'session-post-deploy',
    }),
  )
  const warmed = await listAssistantSessions(vaultRoot, { limit: 10 })
  expect(warmed.map((session) => session.sessionId)).toEqual([
    'session-post-deploy',
    'session-newer-activity',
    'session-older-activity',
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

test('builds structured group evidence only from group-bound sessions', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-group-',
  )
  cleanupPaths.push(parentRoot)

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T22:00:00.000Z',
      channel: 'linq',
      sessionId: 'session-group',
      threadIsDirect: false,
    }),
  )
  const longTail = 'x'.repeat(3_000)
  const groupPrompt = [
    'Input 1:',
    'Sender: +15550000001',
    '',
    'Message text:',
    'the combine is canceled',
    '',
    'Input 2:',
    'Sender: +15550000002',
    '',
    'Recent group event context:',
    'Participant +15550000002 added a laugh reaction on: sources confirm',
    longTail,
  ].join('\n')
  await appendAssistantTranscriptEntries(vaultRoot, 'session-group', [
    {
      createdAt: '2026-06-29T22:00:00.000Z',
      kind: 'user',
      text: groupPrompt,
    },
    {
      createdAt: '2026-06-29T22:00:01.000Z',
      kind: 'assistant',
      text: 'sources confirm the combine has lost institutional backing',
    },
    {
      createdAt: '2026-06-29T22:00:02.000Z',
      kind: 'status',
      text: buildAssistantNoReplyTranscriptMarkerText({
        deliveryContextOrdinal: 0,
        turnId: 'turn_group_no_reply',
      }),
    },
  ])

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T23:00:00.000Z',
      channel: 'linq',
      sessionId: 'session-direct',
      threadIsDirect: true,
    }),
  )
  await appendAssistantTranscriptEntries(vaultRoot, 'session-direct', [
    {
      createdAt: '2026-06-29T23:00:00.000Z',
      kind: 'user',
      text: 'private direct message must not enter group evidence',
    },
  ])

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      channel: 'email',
      lastTurnAt: '2026-06-29T23:30:00.000Z',
      sessionId: 'session-group-email',
      threadIsDirect: false,
    }),
  )
  await appendAssistantTranscriptEntries(vaultRoot, 'session-group-email', [
    {
      createdAt: '2026-06-29T23:30:00.000Z',
      kind: 'user',
      text: 'spoofable group email must not enter room-model evidence',
    },
  ])

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-06-30T03:00:00.000Z'),
    profile: 'group-room-model',
    vault: vaultRoot,
  })

  expect(evidence).toContain(ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_HEADING)
  expect(evidence).toContain('- selected entries: 2')
  expect(evidence).toContain('- truncated: false')
  expect(evidence).not.toContain('private direct message')
  expect(evidence).not.toContain('spoofable group email')
  expect(evidence).not.toContain('murph.assistant-no-reply.v1')

  const records = evidence
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { kind: string; text: string })
  expect(records).toHaveLength(2)
  expect(records[0]?.text).toContain('Input 1:\nSender: +15550000001')
  expect(records[0]?.text).toContain('Input 2:\nSender: +15550000002')
  expect(records[0]?.text).toContain(longTail)
  expect(records[1]).toEqual({
    createdAt: '2026-06-29T22:00:01.000Z',
    kind: 'assistant',
    text: 'sources confirm the combine has lost institutional backing',
  })
})

test('keeps Habitat voice maintenance isolated from conversation history', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-habitat-voice-',
  )
  cleanupPaths.push(parentRoot)

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T23:00:00.000Z',
      sessionId: 'session-private-history',
    }),
  )
  await appendAssistantTranscriptEntries(vaultRoot, 'session-private-history', [
    {
      createdAt: '2026-06-29T23:00:00.000Z',
      kind: 'user',
      text: 'private conversation detail must stay outside voice extraction',
    },
  ])

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-06-30T03:00:00.000Z'),
    profile: 'habitat-voice',
    vault: vaultRoot,
  })

  expect(evidence).toContain('Environment voice evidence boundary')
  expect(evidence).toContain('Do not read conversation history')
  expect(evidence).not.toContain('private conversation detail')
})

test('applies the group session cap after route filtering', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-group-session-cap-',
  )
  cleanupPaths.push(parentRoot)

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T21:00:00.000Z',
      channel: 'telegram',
      sessionId: 'session-eligible-behind-cap',
      threadIsDirect: false,
    }),
  )
  await appendAssistantTranscriptEntries(
    vaultRoot,
    'session-eligible-behind-cap',
    [
      {
        createdAt: '2026-06-29T21:00:00.000Z',
        kind: 'user',
        text: [
          'Input 1:',
          'Sender: telegram:participant-alpha',
          '',
          'Message text:',
          'retire the old nickname',
        ].join('\n'),
      },
      {
        createdAt: '2026-06-29T21:00:01.000Z',
        kind: 'assistant',
        text: 'Got it — that nickname is retired.',
      },
    ],
  )

  for (let index = 0; index < 24; index += 1) {
    await saveAssistantSession(
      vaultRoot,
      createEvidenceTestSession({
        lastTurnAt: `2026-06-29T23:${String(index).padStart(2, '0')}:00.000Z`,
        channel: index % 2 === 0 ? 'linq' : 'email',
        sessionId: `session-excluded-${String(index).padStart(2, '0')}`,
        threadIsDirect: index % 2 === 0,
      }),
    )
  }

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-06-30T03:00:00.000Z'),
    profile: 'group-room-model',
    vault: vaultRoot,
  })

  expect(evidence).toContain(
    'Input 1:\\nSender: telegram:participant-alpha',
  )
  expect(evidence).toContain('retire the old nickname')
  expect(evidence).toContain('Got it — that nickname is retired.')
})

test('returns an explicit empty group evidence section without group sessions', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-maintenance-evidence-group-empty-',
  )
  cleanupPaths.push(parentRoot)

  await saveAssistantSession(
    vaultRoot,
    createEvidenceTestSession({
      lastTurnAt: '2026-06-29T23:00:00.000Z',
      channel: 'linq',
      sessionId: 'session-direct-only',
      threadIsDirect: true,
    }),
  )

  const evidence = await buildAssistantMaintenanceConversationEvidence({
    now: new Date('2026-06-30T03:00:00.000Z'),
    profile: 'group-room-model',
    vault: vaultRoot,
  })

  expect(evidence).toContain(ASSISTANT_GROUP_ROOM_MODEL_EVIDENCE_HEADING)
  expect(evidence).toContain('Do not create or update the group room model this run.')
})
