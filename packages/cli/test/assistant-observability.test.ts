import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { runAssistantDoctor } from '../src/assistant/doctor.js'
import { runAssistantAutomation } from '../src/assistant-runtime.js'
import { getAssistantStatus } from '../src/assistant/status.js'
import { resolveAssistantStatePaths } from '../src/assistant-state.js'
import { deliverAssistantMessage } from '../src/outbound-channel.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

test('assistant status surfaces recent receipts and doctor passes on healthy local state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'imessage',
      participantId: '+15551234567',
      message: 'Lunch is logged.',
    },
    {
      sendImessage: async () => {},
    },
  )

  const status = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
  })
  assert.equal(status.runLock.state, 'unlocked')
  assert.equal(status.outbox.total, 1)
  assert.equal(status.outbox.sent, 1)
  assert.equal(status.recentTurns.length, 1)
  assert.equal(status.recentTurns[0]?.status, 'completed')
  assert.equal(status.recentTurns[0]?.deliveryRequested, true)
  assert.equal(status.recentTurns[0]?.deliveryDisposition, 'sent')
  assert.equal(
    status.recentTurns[0]?.timeline.some((event) => event.kind === 'delivery.sent'),
    true,
  )

  const doctor = await runAssistantDoctor(vaultRoot)
  assert.equal(doctor.ok, true)
  assert.equal(
    doctor.checks.some(
      (check) => check.name === 'turn-receipts' && check.status === 'pass',
    ),
    true,
  )
})

test('assistant doctor flags malformed transcript lines without breaking status', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-bad-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.transcriptsDirectory, { recursive: true })
  await writeFile(
    path.join(statePaths.transcriptsDirectory, 'orphan-session.jsonl'),
    '{not valid json}\n',
    'utf8',
  )

  const status = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
  })
  assert.equal(status.recentTurns.length, 0)
  assert.equal(status.outbox.total, 0)

  const doctor = await runAssistantDoctor(vaultRoot)
  const transcriptCheck = doctor.checks.find(
    (check) => check.name === 'transcript-files',
  )
  assert.equal(doctor.ok, false)
  assert.equal(transcriptCheck?.status, 'fail')
})

test('assistant automation ignores legacy outbox records after the outbox cutover', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-legacy-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.outboxDirectory, { recursive: true })
  await writeFile(
    path.join(statePaths.outboxDirectory, 'legacy-intent.json'),
    JSON.stringify({
      schema: 'murph.assistant-outbox-intent.v1',
      intentId: 'outbox_legacy_sent',
      idempotencyKey: 'turn_legacy_sent',
      sessionId: 'asst_legacy_sent',
      channel: 'telegram',
      target: 'chat-legacy',
      targetKind: 'thread',
      messageLength: 42,
      messageSha256: 'legacy-message-sha',
      status: 'sent',
      createdAt: '2026-03-26T02:46:10.117Z',
      updatedAt: '2026-03-26T02:46:11.497Z',
      sentAt: '2026-03-26T02:46:11.497Z',
      delivery: {
        channel: 'telegram',
        target: 'chat-legacy',
        targetKind: 'thread',
        sentAt: '2026-03-26T02:46:11.497Z',
        messageLength: 42,
      },
      lastError: null,
    }),
    'utf8',
  )

  const result = await runAssistantAutomation({
    vault: vaultRoot,
    once: true,
    startDaemon: false,
    inboxServices: {} as any,
  })
  assert.equal(result.reason, 'completed')

  const status = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
  })
  assert.equal(status.outbox.total, 0)

  const doctor = await runAssistantDoctor(vaultRoot)
  const outboxCheck = doctor.checks.find(
    (check) => check.name === 'outbox-intents',
  )
  assert.equal(doctor.ok, false)
  assert.equal(outboxCheck?.status, 'fail')
})

test('assistant status ignores expired cooldown warnings and can find an older requested session beyond the global recent-turn window', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-status-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const olderSession = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      alias: 'chat:older',
      channel: 'imessage',
      participantId: '+15550000001',
      message: 'older session message',
    },
    {
      sendImessage: async () => {},
    },
  )

  for (let index = 0; index < 55; index += 1) {
    await deliverAssistantMessage(
      {
        vault: vaultRoot,
        alias: 'chat:newer',
        channel: 'imessage',
        participantId: '+15550000002',
        message: `newer session message ${index}`,
      },
      {
        sendImessage: async () => {},
      },
    )
  }

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await writeFile(
    statePaths.failoverStatePath,
    JSON.stringify({
      schema: 'murph.assistant-failover-state.v1',
      updatedAt: '2026-03-26T12:00:00.000Z',
      routes: [
        {
          routeId: 'route-expired',
          label: 'expired',
          provider: 'codex-cli',
          model: 'gpt-oss:20b',
          failureCount: 1,
          successCount: 0,
          consecutiveFailures: 1,
          lastFailureAt: '2000-01-01T00:00:00.000Z',
          lastErrorCode: 'ASSISTANT_PROVIDER_TIMEOUT',
          lastErrorMessage: 'provider timed out',
          cooldownUntil: '2000-01-01T00:01:00.000Z',
        },
      ],
    }),
    'utf8',
  )

  const status = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
    sessionId: olderSession.session.sessionId,
  })
  assert.equal(status.recentTurns.length, 1)
  assert.equal(status.recentTurns[0]?.sessionId, olderSession.session.sessionId)
  assert.equal(
    status.warnings.some((warning) =>
      warning.includes('provider failover route(s) are cooling down'),
    ),
    false,
  )
})
