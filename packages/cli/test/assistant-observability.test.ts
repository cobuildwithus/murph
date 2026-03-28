import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { runAssistantDoctor } from '../src/assistant/doctor.js'
import { drainAssistantOutbox, readAssistantOutboxIntent } from '../src/assistant/outbox.js'
import { getAssistantStatus } from '../src/assistant/status.js'
import { readAssistantStatusSnapshot } from '../src/assistant-runtime.js'
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

test('assistant status defaults torn local state files and doctor surfaces recovered JSONL tails', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-torn-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await Promise.all([
    mkdir(statePaths.transcriptsDirectory, { recursive: true }),
    mkdir(statePaths.turnsDirectory, { recursive: true }),
    mkdir(statePaths.diagnosticsDirectory, { recursive: true }),
  ])

  await writeFile(
    path.join(statePaths.transcriptsDirectory, 'session-a.jsonl'),
    `${JSON.stringify({
      schema: 'murph.assistant-transcript-entry.v1',
      at: '2026-03-29T10:00:00.000Z',
      kind: 'user',
      text: 'hello',
    })}\n{"schema":"murph.assistant-transcript-entry.v1","at":"2026-03-29T10:00:01.000Z","kind":"assistant"`,
    'utf8',
  )
  await writeFile(
    statePaths.diagnosticEventsPath,
    `${JSON.stringify({
      schema: 'murph.assistant-diagnostic-event.v1',
      at: '2026-03-29T10:00:00.000Z',
      level: 'info',
      component: 'automation',
      kind: 'automation.scan.started',
      message: 'scan started',
      code: null,
      sessionId: null,
      turnId: null,
      intentId: null,
      dataJson: null,
    })}\n{"schema":"murph.assistant-diagnostic-event.v1","at":"2026-03-29T10:00:01.000Z","level":"warn"`,
    'utf8',
  )
  await writeFile(
    path.join(statePaths.turnsDirectory, 'turn-broken.json'),
    '{"schema":"murph.assistant-turn-receipt.v1"',
    'utf8',
  )
  await writeFile(statePaths.automationPath, '{"version":2', 'utf8')
  await writeFile(
    statePaths.diagnosticSnapshotPath,
    '{"schema":"murph.assistant-diagnostics.v1"',
    'utf8',
  )
  await writeFile(
    statePaths.failoverStatePath,
    '{"schema":"murph.assistant-failover-state.v1"',
    'utf8',
  )
  await writeFile(
    statePaths.statusPath,
    '{"vault":"redacted"',
    'utf8',
  )

  const status = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
  })

  assert.equal(status.automation.inboxScanCursor, null)
  assert.equal(status.diagnostics.counters.turnsStarted, 0)
  assert.deepEqual(status.failover.routes, [])
  assert.equal(status.recentTurns.length, 0)
  assert.equal(await readAssistantStatusSnapshot(vaultRoot), null)

  const doctor = await runAssistantDoctor(vaultRoot)
  assert.equal(doctor.ok, false)
  assert.equal(
    doctor.checks.find((check) => check.name === 'automation-state')?.status,
    'fail',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'diagnostics-snapshot')?.status,
    'fail',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'failover-state')?.status,
    'fail',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'turn-receipts')?.status,
    'fail',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'transcript-files')?.status,
    'fail',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'diagnostic-events')?.status,
    'warn',
  )
})

test('assistant outbox inventory paths quarantine legacy intent payloads without breaking status, drain, or new replies', async () => {
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

  await assert.rejects(() => readAssistantOutboxIntent(vaultRoot, 'legacy-intent'))
  const status = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
  })
  assert.equal(status.outbox.total, 0)
  assert.equal(status.recentTurns.length, 0)

  const drained = await drainAssistantOutbox({
    vault: vaultRoot,
  })
  assert.equal(drained.attempted, 0)
  assert.equal(drained.sent, 0)

  await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'imessage',
      participantId: '+15551234567',
      message: 'Lunch is still logged.',
    },
    {
      sendImessage: async () => {},
    },
  )

  const recoveredStatus = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
  })
  assert.equal(recoveredStatus.outbox.total, 1)
  assert.equal(recoveredStatus.outbox.sent, 1)
  assert.equal(recoveredStatus.recentTurns[0]?.deliveryDisposition, 'sent')

  const doctor = await runAssistantDoctor(vaultRoot)
  const outboxCheck = doctor.checks.find(
    (check) => check.name === 'outbox-intents',
  )
  assert.equal(doctor.ok, false)
  assert.equal(outboxCheck?.status, 'fail')
  assert.equal(
    String(outboxCheck?.message).includes('quarantined'),
    true,
  )
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
