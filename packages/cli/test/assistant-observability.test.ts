import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import { runAssistantDoctor } from '@murphai/assistant-cli/assistant/doctor'
import { recordAssistantDiagnosticEvent } from '@murphai/assistant-engine/assistant/diagnostics'
import { appendAssistantRuntimeEvent } from '@murphai/assistant-engine/assistant/runtime-events'
import { readAssistantTurnReceipt } from '@murphai/assistant-engine/assistant/turns'
import {
  createAssistantOutboxIntent,
  drainAssistantOutbox,
  readAssistantOutboxIntent,
} from '@murphai/assistant-cli/assistant/outbox'
import { getAssistantStatus } from '@murphai/assistant-cli/assistant/status'
import { readAssistantStatusSnapshot } from '@murphai/assistant-cli/assistant/status'
import { resolveAssistantStatePaths } from '@murphai/assistant-engine/assistant-state'
import { deliverAssistantMessage } from '@murphai/assistant-engine/outbound-channel'
import { createVersionedJsonStateEnvelope } from '@murphai/runtime-state/node'

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
      channel: 'telegram',
      participantId: '123456789',
      sourceThreadId: '-1001234567890:topic:42',
      threadIsDirect: false,
      message: 'Lunch is logged.',
    },
    {
      sendTelegram: async () => {},
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

test('assistant observability reads blocked turn receipts and status snapshots', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-legacy-blocked-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await mkdir(statePaths.turnsDirectory, { recursive: true })

  const legacyReceipt = {
    schema: 'murph.assistant-turn-receipt.v1',
    turnId: 'turn_legacy_blocked',
    sessionId: 'asst_legacy_blocked',
    provider: 'codex-cli',
    providerModel: 'gpt-5.4-mini',
    promptPreview: 'legacy blocked prompt',
    responsePreview: null,
    status: 'blocked',
    deliveryRequested: true,
    deliveryDisposition: 'blocked',
    deliveryIntentId: null,
    startedAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:00:05.000Z',
    completedAt: '2026-03-30T10:00:05.000Z',
    lastError: {
      code: 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED',
      message: 'Legacy blocked turn.',
    },
    timeline: [
      {
        at: '2026-03-30T10:00:00.000Z',
        kind: 'turn.started',
        detail: null,
        metadata: {},
      },
      {
        at: '2026-03-30T10:00:05.000Z',
        kind: 'turn.blocked',
        detail: 'Legacy blocked turn.',
        metadata: {},
      },
    ],
  } as const

  await writeFile(
    path.join(statePaths.turnsDirectory, `${legacyReceipt.turnId}.json`),
    `${JSON.stringify(legacyReceipt, null, 2)}\n`,
    'utf8',
  )

  const baselineStatus = await getAssistantStatus({
    vault: vaultRoot,
    limit: 5,
  })
  await writeFile(
    statePaths.statusPath,
    `${JSON.stringify(
      createVersionedJsonStateEnvelope({
        schema: 'murph.assistant-status-snapshot.v1',
        schemaVersion: 1,
        value: {
          ...baselineStatus,
          recentTurns: [legacyReceipt],
        },
      }),
      null,
      2,
    )}\n`,
    'utf8',
  )

  const receipt = await readAssistantTurnReceipt(vaultRoot, legacyReceipt.turnId)
  assert.equal(receipt?.status, 'blocked')
  assert.equal(receipt?.deliveryDisposition, 'blocked')

  const statusSnapshot = await readAssistantStatusSnapshot(vaultRoot)
  assert.equal(statusSnapshot?.recentTurns[0]?.status, 'blocked')
  assert.equal(statusSnapshot?.recentTurns[0]?.timeline[1]?.kind, 'turn.blocked')

  const doctor = await runAssistantDoctor(vaultRoot)
  const receiptCheck = doctor.checks.find((check) => check.name === 'turn-receipts')
  assert.ok(receiptCheck)
  assert.ok(receiptCheck.details)
  assert.equal(receiptCheck.details.parseErrors, 0)
  assert.notEqual(receiptCheck.status, 'fail')
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

test('assistant outbox keeps raw dedupe identity separate from persisted target normalization', async () => {
  const parent = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-observability-normalized-outbox-'),
  )
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const baseIntent = {
    vault: vaultRoot,
    message: ' Hello ',
    sessionId: 'sess_outbox_identity',
    turnId: 'turn_outbox_identity',
    threadIsDirect: true,
  } as const

  const spaced = await createAssistantOutboxIntent({
    ...baseIntent,
    channel: ' telegram ',
    identityId: ' assistant:primary ',
    actorId: ' actor:1 ',
    threadId: ' -1001234567890:topic:42 ',
    replyToMessageId: ' reply:1 ',
    explicitTarget: ' -1001234567890:topic:42 ',
  })
  const trimmed = await createAssistantOutboxIntent({
    ...baseIntent,
    channel: 'telegram',
    identityId: 'assistant:primary',
    actorId: 'actor:1',
    threadId: '-1001234567890:topic:42',
    replyToMessageId: 'reply:1',
    explicitTarget: '-1001234567890:topic:42',
  })

  assert.notEqual(spaced.intentId, trimmed.intentId)
  assert.notEqual(spaced.dedupeKey, trimmed.dedupeKey)
  assert.notEqual(spaced.targetFingerprint, trimmed.targetFingerprint)

  const persistedSpaced = await readAssistantOutboxIntent(vaultRoot, spaced.intentId)
  const persistedTrimmed = await readAssistantOutboxIntent(vaultRoot, trimmed.intentId)

  for (const intent of [persistedSpaced, persistedTrimmed]) {
    assert.equal(intent?.message, 'Hello')
    assert.equal(intent?.channel, 'telegram')
    assert.equal(intent?.identityId, 'assistant:primary')
    assert.equal(intent?.actorId, 'actor:1')
    assert.equal(intent?.threadId, '-1001234567890:topic:42')
    assert.equal(intent?.threadIsDirect, true)
    assert.equal(intent?.replyToMessageId, 'reply:1')
    assert.equal(intent?.explicitTarget, '-1001234567890:topic:42')
  }
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
  await writeFile(statePaths.automationStatePath, '{"version":2', 'utf8')
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
    'pass',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'diagnostics-snapshot')?.status,
    'pass',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'failover-state')?.status,
    'pass',
  )
  assert.equal(
    doctor.checks.find((check) => check.name === 'turn-receipts')?.status,
    'pass',
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
      channel: 'telegram',
      participantId: '123456789',
      sourceThreadId: '-1001234567890:topic:42',
      threadIsDirect: false,
      message: 'Lunch is still logged.',
    },
    {
      sendTelegram: async () => {},
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
  assert.equal(outboxCheck?.status, 'pass')
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
      channel: 'telegram',
      participantId: '123450001',
      sourceThreadId: '-1001234567890:topic:42',
      threadIsDirect: false,
      message: 'older session message',
    },
    {
      sendTelegram: async () => {},
    },
  )

  for (let index = 0; index < 55; index += 1) {
    await deliverAssistantMessage(
      {
        vault: vaultRoot,
        alias: 'chat:newer',
        channel: 'telegram',
        participantId: '123450002',
        sourceThreadId: '-1001234567890:topic:43',
        threadIsDirect: false,
        message: `newer session message ${index}`,
      },
      {
        sendTelegram: async () => {},
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


test('assistant doctor repairs assistant-state permissions but leaves inline legacy session secrets for manual repair', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-repair-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  await Promise.all([
    mkdir(statePaths.sessionsDirectory, { recursive: true }),
    mkdir(statePaths.sessionSecretsDirectory, { recursive: true }),
  ])

  const sessionPath = path.join(statePaths.sessionsDirectory, 'asst_legacyrepair.json')

  await writeFile(
    sessionPath,
    `${JSON.stringify(
      {
        schema: 'murph.assistant-session.v4',
        sessionId: 'asst_legacyrepair',
        target: {
          adapter: 'openai-compatible',
          apiKeyEnv: 'OPENAI_API_KEY',
          endpoint: 'https://api.example.test/v1',
          headers: {
            Authorization: 'Bearer legacy-session-secret',
            'X-Visible': 'public-header',
          },
          model: 'gpt-4.1-mini',
          providerName: 'legacy',
          reasoningEffort: null,
        },
        resumeState: {
          providerSessionId: 'provider-binding-1',
          resumeRouteId: null,
        },
        alias: 'chat:legacy',
        binding: {
          conversationKey: null,
          channel: null,
          identityId: null,
          actorId: null,
          threadId: null,
          threadIsDirect: null,
          delivery: null,
        },
        createdAt: '2026-03-29T12:00:00.000Z',
        updatedAt: '2026-03-29T12:00:00.000Z',
        lastTurnAt: null,
        turnCount: 0,
      },
      null,
      2,
    )}
`,
    'utf8',
  )

  await Promise.all([
    chmod(statePaths.assistantStateRoot, 0o755),
    chmod(statePaths.sessionsDirectory, 0o755),
    chmod(sessionPath, 0o644),
  ])

  const doctorBefore = await runAssistantDoctor(vaultRoot)
  assert.equal(doctorBefore.ok, false)
  assert.equal(
    doctorBefore.checks.find((check) => check.name === 'assistant-state-permissions')?.status,
    'fail',
  )
  assert.equal(
    doctorBefore.checks.find((check) => check.name === 'assistant-session-secrets')?.status,
    'fail',
  )

  const repaired = await runAssistantDoctor(vaultRoot, { repair: true })
  assert.equal(repaired.ok, false)
  assert.equal(
    repaired.checks.find((check) => check.name === 'assistant-state-permissions')?.status,
    'warn',
  )
  assert.equal(
    repaired.checks.find((check) => check.name === 'assistant-session-secrets')?.status,
    'fail',
  )

  const repairedSessionRaw = await readFile(sessionPath, 'utf8')
  const sessionSecretsPath = path.join(
    statePaths.sessionSecretsDirectory,
    'asst_legacyrepair.json',
  )

  assert.equal(/legacy-session-secret|legacy-binding-secret/u.test(repairedSessionRaw), true)

  assert.equal((await stat(statePaths.assistantStateRoot)).mode & 0o777, 0o700)
  assert.equal((await stat(statePaths.sessionsDirectory)).mode & 0o777, 0o700)
  assert.equal((await stat(sessionPath)).mode & 0o777, 0o600)
  await assert.rejects(readFile(sessionSecretsPath, 'utf8'))

  const doctorAfter = await runAssistantDoctor(vaultRoot)
  assert.equal(doctorAfter.ok, false)
  assert.equal(
    doctorAfter.checks.find((check) => check.name === 'assistant-state-permissions')?.status,
    'pass',
  )
  assert.equal(
    doctorAfter.checks.find((check) => check.name === 'assistant-session-secrets')?.status,
    'fail',
  )
})

test('assistant observability logs redact inline secret material before persistence', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-observability-redaction-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)

  await recordAssistantDiagnosticEvent({
    vault: vaultRoot,
    component: 'automation',
    kind: 'automation.scan.started',
    level: 'warn',
    message: 'Authorization: Bearer super-secret-token',
    data: {
      Authorization: 'Bearer data-secret-token',
      nested: {
        apiKey: 'abc123456789',
      },
    },
  })
  await appendAssistantRuntimeEvent({
    vault: vaultRoot,
    component: 'runtime',
    kind: 'runtime.maintenance',
    level: 'warn',
    message: 'cookie=session-secret-cookie',
    data: {
      headers: {
        Authorization: 'Bearer runtime-secret-token',
      },
    },
  })

  const diagnosticRaw = await readFile(statePaths.diagnosticEventsPath, 'utf8')
  const runtimeRaw = await readFile(statePaths.runtimeEventsPath, 'utf8')

  assert.equal(/super-secret-token|data-secret-token|abc123456789/u.test(diagnosticRaw), false)
  assert.equal(/runtime-secret-token|session-secret-cookie/u.test(runtimeRaw), false)
  assert.match(diagnosticRaw, /\[REDACTED\]/u)
  assert.match(runtimeRaw, /\[REDACTED\]/u)
})
