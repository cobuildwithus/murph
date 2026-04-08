import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, test as baseTest, vi } from 'vitest'

import { resolveAssistantStatePaths } from '@murphai/runtime-state/node'
import type {
  AssistantDoctorCheckStatus,
  AssistantOutboxIntent,
  AssistantSession,
  AssistantTurnReceipt,
} from '@murphai/operator-config/assistant-cli-contracts'

const test = baseTest.sequential

const doctorSecurityMocks = vi.hoisted(() => ({
  inspectAndRepairAssistantStateSecrecy: vi.fn(),
}))

const runtimeMocks = vi.hoisted(() => ({
  summarizeAssistantQuarantines: vi.fn(),
}))

const stateMocks = vi.hoisted(() => ({
  resolveAssistantStatePaths: vi.fn(),
  withAssistantRuntimeWriteLock: vi.fn(),
}))

vi.mock('../src/assistant/doctor-security.ts', () => doctorSecurityMocks)

vi.mock('@murphai/assistant-engine/assistant-runtime', () => {
  return {
    isMissingFileError(error: unknown) {
      return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      )
    },
    parseAssistantJsonLinesWithTailSalvage<T>(
      raw: string,
      parseValue: (value: unknown) => T,
    ) {
      const values: T[] = []
      let malformedLineCount = 0
      let salvagedTailLineCount = 0
      const lines = raw.split('\n')

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]?.trim() ?? ''
        if (line.length === 0) {
          continue
        }

        try {
          values.push(parseValue(JSON.parse(line) as unknown))
        } catch {
          const hasRemainingNonEmptyLine = lines
            .slice(index + 1)
            .some((nextLine) => nextLine.trim().length > 0)
          if (hasRemainingNonEmptyLine) {
            malformedLineCount += 1
          } else {
            salvagedTailLineCount += 1
          }
        }
      }

      return {
        malformedLineCount,
        salvagedTailLineCount,
        values,
      }
    },
    summarizeAssistantQuarantines: runtimeMocks.summarizeAssistantQuarantines,
  }
})

vi.mock('@murphai/assistant-engine/assistant-state', () => ({
  resolveAssistantStatePaths: stateMocks.resolveAssistantStatePaths,
  withAssistantRuntimeWriteLock: stateMocks.withAssistantRuntimeWriteLock,
}))

vi.mock('../src/assistant/store.ts', () => ({
  redactAssistantDisplayPath: (value: string) => value,
}))

import { runAssistantDoctor } from '../src/assistant/doctor.ts'

const testNow = '2026-04-08T12:00:00.000Z'

const BASE_SESSION: AssistantSession = {
  schema: 'murph.assistant-session.v4',
  sessionId: 'session-doctor-demo',
  target: {
    adapter: 'codex-cli',
    approvalPolicy: null,
    codexCommand: null,
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: null,
    sandbox: null,
  },
  resumeState: null,
  provider: 'codex-cli',
  providerOptions: {
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
  },
  providerBinding: null,
  alias: 'chat:doctor',
  binding: {
    conversationKey: 'chat:doctor',
    channel: 'local',
    identityId: null,
    actorId: null,
    threadId: null,
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 1,
}

const BASE_RECEIPT: AssistantTurnReceipt = {
  schema: 'murph.assistant-turn-receipt.v1',
  turnId: 'turn_demo',
  sessionId: BASE_SESSION.sessionId,
  provider: 'codex-cli',
  providerModel: null,
  promptPreview: 'hello',
  responsePreview: 'hi',
  status: 'completed',
  deliveryRequested: false,
  deliveryDisposition: 'not-requested',
  deliveryIntentId: null,
  startedAt: '2026-04-08T00:01:00.000Z',
  updatedAt: '2026-04-08T00:01:05.000Z',
  completedAt: '2026-04-08T00:01:05.000Z',
  lastError: null,
  timeline: [],
}

const BASE_OUTBOX_INTENT: AssistantOutboxIntent = {
  schema: 'murph.assistant-outbox-intent.v1',
  intentId: 'intent_demo',
  sessionId: BASE_SESSION.sessionId,
  turnId: BASE_RECEIPT.turnId,
  createdAt: '2026-04-08T00:01:00.000Z',
  updatedAt: '2026-04-08T00:01:05.000Z',
  lastAttemptAt: null,
  nextAttemptAt: null,
  sentAt: '2026-04-08T00:01:05.000Z',
  attemptCount: 1,
  status: 'sent',
  message: 'hello',
  dedupeKey: 'dedupe_demo',
  targetFingerprint: 'target_demo',
  channel: 'local',
  identityId: null,
  actorId: null,
  threadId: null,
  threadIsDirect: true,
  replyToMessageId: null,
  bindingDelivery: null,
  explicitTarget: null,
  delivery: null,
  deliveryConfirmationPending: false,
  deliveryIdempotencyKey: null,
  deliveryTransportIdempotent: false,
  lastError: null,
}

function toPersistedSessionFile(session: AssistantSession) {
  return {
    schema: session.schema,
    sessionId: session.sessionId,
    target: session.target,
    resumeState: session.resumeState,
    alias: session.alias,
    binding: session.binding,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastTurnAt: session.lastTurnAt,
    turnCount: session.turnCount,
  }
}

let currentPaths = resolveAssistantStatePaths('/tmp/assistant-doctor-default')
let tempRoots: string[] = []

beforeEach(() => {
  tempRoots = []
  doctorSecurityMocks.inspectAndRepairAssistantStateSecrecy.mockReset()
  runtimeMocks.summarizeAssistantQuarantines.mockReset()
  stateMocks.resolveAssistantStatePaths.mockReset()
  stateMocks.withAssistantRuntimeWriteLock.mockReset()
  stateMocks.resolveAssistantStatePaths.mockImplementation(() => currentPaths)
  stateMocks.withAssistantRuntimeWriteLock.mockImplementation(
    async (_vault: string, callback: (paths: typeof currentPaths) => Promise<unknown>) =>
      callback(currentPaths),
  )
  doctorSecurityMocks.inspectAndRepairAssistantStateSecrecy.mockResolvedValue({
    malformedSessionSecretSidecars: 0,
    orphanSessionSecretSidecars: 0,
    permissionAudit: {
      incorrectEntries: 0,
      issues: [],
      repairedEntries: 0,
      scannedDirectories: 0,
      scannedFiles: 0,
      scannedOtherEntries: 0,
    },
    sessionFilesScanned: 0,
    sessionInlineSecretFiles: 0,
    sessionInlineSecretHeaders: 0,
    sessionSecretSidecarFiles: 0,
  })
  runtimeMocks.summarizeAssistantQuarantines.mockResolvedValue({
    byKind: {},
    recent: [],
    total: 0,
  })
  vi.useFakeTimers()
  vi.setSystemTime(new Date(testNow))
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(
    tempRoots.map((root) => rm(root, { force: true, recursive: true })),
  )
})

test('runAssistantDoctor reports a clean assistant state as healthy', async () => {
  const { vaultRoot, paths } = await createAssistantStateFixture()

  await writeJson(
    path.join(paths.sessionsDirectory, `${BASE_SESSION.sessionId}.json`),
    toPersistedSessionFile(BASE_SESSION),
  )
  await writeJson(
    path.join(paths.transcriptsDirectory, `${BASE_SESSION.sessionId}.jsonl`),
    {
      createdAt: '2026-04-08T00:01:00.000Z',
      kind: 'assistant',
      schema: 'murph.assistant-transcript-entry.v1',
      text: 'hello world',
    },
    true,
  )
  await writeJson(path.join(paths.turnsDirectory, `${BASE_RECEIPT.turnId}.json`), BASE_RECEIPT)
  await writeJson(
    path.join(paths.outboxDirectory, `${BASE_OUTBOX_INTENT.intentId}.json`),
    BASE_OUTBOX_INTENT,
  )
  await writeJson(paths.automationStatePath, {
    version: 2,
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: [],
    autoReplyBacklogChannels: [],
    autoReplyPrimed: false,
    updatedAt: testNow,
  })
  await writeJsonl(paths.diagnosticEventsPath, [
    {
      at: testNow,
      code: null,
      component: 'automation',
      dataJson: null,
      intentId: null,
      kind: 'diagnostics.event.recorded',
      level: 'info',
      message: 'scan completed',
      schema: 'murph.assistant-diagnostic-event.v1',
      sessionId: BASE_SESSION.sessionId,
      turnId: BASE_RECEIPT.turnId,
    },
  ])
  await writeJsonl(paths.runtimeEventsPath, [
    {
      at: testNow,
      component: 'automation',
      dataJson: null,
      entityId: null,
      entityType: null,
      kind: 'diagnostics.event.recorded',
      level: 'info',
      message: 'runtime journal',
      schema: 'murph.assistant-runtime-event.v1',
    },
  ])
  await writeJson(paths.diagnosticSnapshotPath, {
    schema: 'murph.assistant-diagnostics.v1',
    updatedAt: testNow,
    lastEventAt: testNow,
    lastErrorAt: null,
    counters: {
      turnsStarted: 1,
      turnsCompleted: 1,
      turnsDeferred: 0,
      turnsFailed: 0,
      providerAttempts: 1,
      providerFailures: 0,
      providerFailovers: 0,
      deliveriesQueued: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
      deliveriesRetryable: 0,
      outboxDrains: 1,
      outboxRetries: 0,
      automationScans: 1,
    },
    recentWarnings: [],
  })
  await writeJson(paths.failoverStatePath, {
    schema: 'murph.assistant-failover-state.v1',
    updatedAt: testNow,
    routes: [],
  })
  await writeJson(paths.resourceBudgetPath, {
    schema: 'murph.assistant-runtime-budget.v1',
    updatedAt: testNow,
    caches: [],
    maintenance: {
      lastRunAt: null,
      staleQuarantinePruned: 0,
      staleLocksCleared: 0,
      notes: [],
    },
  })
  await writeJson(paths.statusPath, {
    schema: 'murph.assistant-status-snapshot.v1',
    schemaVersion: 1,
    value: {
      vault: vaultRoot,
      stateRoot: paths.assistantStateRoot,
      statusPath: paths.statusPath,
      outboxRoot: paths.outboxDirectory,
      diagnosticsPath: paths.diagnosticSnapshotPath,
      failoverStatePath: paths.failoverStatePath,
      turnsRoot: paths.turnsDirectory,
      generatedAt: testNow,
      runLock: {
        state: 'unlocked',
        pid: null,
        startedAt: null,
        mode: null,
        command: null,
        reason: null,
      },
      automation: {
        inboxScanCursor: null,
        autoReplyScanCursor: null,
        autoReplyChannels: [],
        autoReplyBacklogChannels: [],
        autoReplyPrimed: false,
        updatedAt: null,
      },
      outbox: {
        total: 1,
        pending: 0,
        sending: 0,
        retryable: 0,
        sent: 1,
        failed: 0,
        abandoned: 0,
        oldestPendingAt: null,
        nextAttemptAt: null,
      },
      diagnostics: {
        schema: 'murph.assistant-diagnostics.v1',
        updatedAt: testNow,
        lastEventAt: testNow,
        lastErrorAt: null,
        counters: {
          turnsStarted: 1,
          turnsCompleted: 1,
          turnsDeferred: 0,
          turnsFailed: 0,
          providerAttempts: 1,
          providerFailures: 0,
          providerFailovers: 0,
          deliveriesQueued: 0,
          deliveriesSent: 0,
          deliveriesFailed: 0,
          deliveriesRetryable: 0,
          outboxDrains: 1,
          outboxRetries: 0,
          automationScans: 1,
        },
        recentWarnings: [],
      },
      failover: {
        schema: 'murph.assistant-failover-state.v1',
        updatedAt: testNow,
        routes: [],
      },
      quarantine: {
        total: 0,
        byKind: {},
        recent: [],
      },
      runtimeBudget: {
        schema: 'murph.assistant-runtime-budget.v1',
        updatedAt: testNow,
        caches: [],
        maintenance: {
          lastRunAt: null,
          staleQuarantinePruned: 0,
          staleLocksCleared: 0,
          notes: [],
        },
      },
      recentTurns: [BASE_RECEIPT],
      warnings: [],
    },
  })

  const result = await runAssistantDoctor(vaultRoot)

  assert.equal(result.ok, true)
  assert.equal(result.sessionCount, 1)
  assert.equal(result.transcriptFileCount, 1)
  assert.equal(result.receiptCount, 1)
  assert.equal(result.outboxIntentCount, 1)
  assert.equal(result.quarantineCount, 0)
  assert.equal(result.vault, vaultRoot)
  assert.equal(result.stateRoot, paths.assistantStateRoot)
  assertCheckStatus(result, 'session-files', 'pass')
  assertCheckStatus(result, 'transcript-files', 'pass')
  assertCheckStatus(result, 'assistant-state-permissions', 'pass')
  assertCheckStatus(result, 'assistant-session-secrets', 'pass')
  assertCheckStatus(result, 'automation-state', 'pass')
  assertCheckStatus(result, 'turn-receipts', 'pass')
  assertCheckStatus(result, 'outbox-intents', 'pass')
  assertCheckStatus(result, 'diagnostic-events', 'pass')
  assertCheckStatus(result, 'runtime-events', 'pass')
  assertCheckStatus(result, 'receipt-outbox-links', 'pass')
  assertCheckStatus(result, 'quarantine-artifacts', 'pass')
})

test('runAssistantDoctor uses the write lock in repair mode and surfaces warning-only findings', async () => {
  const { vaultRoot, paths } = await createAssistantStateFixture()

  doctorSecurityMocks.inspectAndRepairAssistantStateSecrecy.mockResolvedValueOnce({
    malformedSessionSecretSidecars: 0,
    orphanSessionSecretSidecars: 2,
    permissionAudit: {
      incorrectEntries: 1,
      issues: [],
      repairedEntries: 1,
      scannedDirectories: 2,
      scannedFiles: 2,
      scannedOtherEntries: 0,
    },
    sessionFilesScanned: 1,
    sessionInlineSecretFiles: 0,
    sessionInlineSecretHeaders: 0,
    sessionSecretSidecarFiles: 2,
  })
  runtimeMocks.summarizeAssistantQuarantines.mockResolvedValueOnce({
    byKind: {
      session: 1,
    },
    recent: [],
    total: 1,
  })

  await writeJson(
    path.join(paths.sessionsDirectory, `${BASE_SESSION.sessionId}.json`),
    toPersistedSessionFile(BASE_SESSION),
  )
  await writeJson(
    path.join(paths.transcriptsDirectory, 'session-orphan.jsonl'),
    {
      createdAt: testNow,
      kind: 'assistant',
      schema: 'murph.assistant-transcript-entry.v1',
      text: 'orphan transcript',
    },
    true,
  )
  await writeJson(
    path.join(paths.turnsDirectory, `${BASE_RECEIPT.turnId}.json`),
    {
      ...BASE_RECEIPT,
      deliveryIntentId: 'intent-missing',
      sessionId: 'session-missing',
    },
  )
  await writeJson(
    path.join(paths.outboxDirectory, `${BASE_OUTBOX_INTENT.intentId}.json`),
    {
      ...BASE_OUTBOX_INTENT,
      sentAt: null,
      status: 'pending',
      updatedAt: '2026-04-08T11:30:00.000Z',
    },
  )

  const result = await runAssistantDoctor(vaultRoot, {
    repair: true,
  })

  assert.equal(stateMocks.withAssistantRuntimeWriteLock.mock.calls.length, 1)
  assert.equal(result.ok, true)
  assertCheckStatus(result, 'transcript-files', 'warn')
  assertCheckStatus(result, 'assistant-state-permissions', 'warn')
  assertCheckStatus(result, 'assistant-session-secrets', 'warn')
  assertCheckStatus(result, 'turn-receipts', 'warn')
  assertCheckStatus(result, 'outbox-intents', 'warn')
  assertCheckStatus(result, 'receipt-outbox-links', 'warn')
  assertCheckStatus(result, 'diagnostic-events', 'pass')
  assertCheckStatus(result, 'runtime-events', 'pass')
  assertCheckStatus(result, 'diagnostics-snapshot', 'pass')
  assertCheckStatus(result, 'failover-state', 'pass')
  assertCheckStatus(result, 'status-snapshot', 'pass')
  assertCheckStatus(result, 'runtime-budget', 'pass')
  assertCheckStatus(result, 'quarantine-artifacts', 'warn')
})

test('runAssistantDoctor reports salvaged jsonl tails without classifying them as failures', async () => {
  const { vaultRoot, paths } = await createAssistantStateFixture()

  await writeJson(
    path.join(paths.sessionsDirectory, `${BASE_SESSION.sessionId}.json`),
    toPersistedSessionFile(BASE_SESSION),
  )
  await writeFile(
    path.join(paths.transcriptsDirectory, `${BASE_SESSION.sessionId}.jsonl`),
    `${JSON.stringify({
      createdAt: testNow,
      kind: 'assistant',
      schema: 'murph.assistant-transcript-entry.v1',
      text: 'clean line',
    })}\n{"schema":"murph.assistant-transcript-entry.v1"`,
    'utf8',
  )
  await writeFile(
    paths.diagnosticEventsPath,
    `${JSON.stringify({
      at: testNow,
      code: null,
      component: 'automation',
      dataJson: null,
      intentId: null,
      kind: 'diagnostics.event.recorded',
      level: 'info',
      message: 'diag',
      schema: 'murph.assistant-diagnostic-event.v1',
      sessionId: null,
      turnId: null,
    })}\n{"schema":"murph.assistant-diagnostic-event.v1"`,
    'utf8',
  )
  await writeFile(
    paths.runtimeEventsPath,
    `${JSON.stringify({
      at: testNow,
      component: 'automation',
      dataJson: null,
      entityId: null,
      entityType: null,
      kind: 'diagnostics.event.recorded',
      level: 'info',
      message: 'runtime',
      schema: 'murph.assistant-runtime-event.v1',
    })}\n{"schema":"murph.assistant-runtime-event.v1"`,
    'utf8',
  )

  const result = await runAssistantDoctor(vaultRoot)

  assert.equal(result.ok, true)
  assertCheckStatus(result, 'transcript-files', 'warn')
  assertCheckStatus(result, 'diagnostic-events', 'warn')
  assertCheckStatus(result, 'runtime-events', 'warn')
})

test('runAssistantDoctor warns about quarantined outbox intents separately from parse failures', async () => {
  const { vaultRoot, paths } = await createAssistantStateFixture()

  await writeJson(
    path.join(paths.sessionsDirectory, `${BASE_SESSION.sessionId}.json`),
    toPersistedSessionFile(BASE_SESSION),
  )
  await writeJson(
    path.join(paths.outboxDirectory, `${BASE_OUTBOX_INTENT.intentId}.json`),
    BASE_OUTBOX_INTENT,
  )
  await mkdir(paths.outboxQuarantineDirectory, { recursive: true })
  await writeJson(
    path.join(paths.outboxQuarantineDirectory, 'intent_demo.meta.json'),
    {
      quarantinedAt: testNow,
    },
  )

  const result = await runAssistantDoctor(vaultRoot)

  assert.equal(result.ok, true)
  const outboxCheck = getCheck(result, 'outbox-intents')
  assert.equal(outboxCheck.status, 'warn')
  assert.match(outboxCheck.message, /quarantined/u)
})

test('runAssistantDoctor ignores non-json receipt and outbox files', async () => {
  const { vaultRoot, paths } = await createAssistantStateFixture()

  await writeJson(
    path.join(paths.sessionsDirectory, `${BASE_SESSION.sessionId}.json`),
    toPersistedSessionFile(BASE_SESSION),
  )
  await writeFile(path.join(paths.turnsDirectory, 'note.txt'), 'skip me', 'utf8')
  await writeFile(path.join(paths.outboxDirectory, 'note.txt'), 'skip me', 'utf8')

  const result = await runAssistantDoctor(vaultRoot)

  assert.equal(result.ok, true)
  assert.equal(result.receiptCount, 0)
  assert.equal(result.outboxIntentCount, 0)
  assertCheckStatus(result, 'turn-receipts', 'pass')
  assertCheckStatus(result, 'outbox-intents', 'pass')
})

test('runAssistantDoctor surfaces unexpected directory read failures', async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-doctor-enotdir-'))
  tempRoots.push(vaultRoot)
  currentPaths = {
    ...resolveAssistantStatePaths(vaultRoot),
    turnsDirectory: path.join(vaultRoot, 'not-a-directory'),
  }

  await mkdir(currentPaths.sessionsDirectory, { recursive: true })
  await writeFile(currentPaths.turnsDirectory, 'file', 'utf8')

  await assert.rejects(() => runAssistantDoctor(vaultRoot))
})

test('runAssistantDoctor fails when assistant artifacts or secrecy metadata are malformed', async () => {
  const { vaultRoot, paths } = await createAssistantStateFixture()

  doctorSecurityMocks.inspectAndRepairAssistantStateSecrecy.mockResolvedValueOnce({
    malformedSessionSecretSidecars: 1,
    orphanSessionSecretSidecars: 0,
    permissionAudit: {
      incorrectEntries: 2,
      issues: [
        {
          path: paths.assistantStateRoot,
          repaired: false,
          reason: 'world-readable',
        },
      ],
      repairedEntries: 0,
      scannedDirectories: 1,
      scannedFiles: 1,
      scannedOtherEntries: 0,
    },
    sessionFilesScanned: 1,
    sessionInlineSecretFiles: 1,
    sessionInlineSecretHeaders: 1,
    sessionSecretSidecarFiles: 1,
  })

  await writeFile(path.join(paths.sessionsDirectory, 'broken.json'), '{bad', 'utf8')
  await writeFile(
    path.join(paths.transcriptsDirectory, `${BASE_SESSION.sessionId}.jsonl`),
    `not-json\n${JSON.stringify({
      createdAt: testNow,
      kind: 'assistant',
      schema: 'murph.assistant-transcript-entry.v1',
      text: 'still present',
    })}\n`,
    'utf8',
  )
  await writeFile(paths.automationStatePath, '{bad', 'utf8')
  await writeFile(path.join(paths.turnsDirectory, 'broken.json'), '{bad', 'utf8')
  await writeFile(path.join(paths.outboxDirectory, 'broken.json'), '{bad', 'utf8')
  await writeFile(
    paths.diagnosticEventsPath,
    `not-json\n${JSON.stringify({
      at: testNow,
      code: null,
      component: 'automation',
      dataJson: null,
      intentId: null,
      kind: 'still-present',
      level: 'info',
      message: 'diagnostic line',
      schema: 'murph.assistant-diagnostic-event.v1',
      sessionId: null,
      turnId: null,
    })}\n`,
    'utf8',
  )
  await writeFile(
    paths.runtimeEventsPath,
    `not-json\n${JSON.stringify({
      at: testNow,
      component: 'automation',
      dataJson: null,
      entityId: null,
      entityType: null,
      kind: 'diagnostics.event.recorded',
      level: 'info',
      message: 'runtime line',
      schema: 'murph.assistant-runtime-event.v1',
    })}\n`,
    'utf8',
  )
  await writeFile(paths.diagnosticSnapshotPath, '{bad', 'utf8')
  await writeFile(paths.failoverStatePath, '{bad', 'utf8')
  await writeFile(paths.statusPath, '{}', 'utf8')
  await writeFile(paths.resourceBudgetPath, '{bad', 'utf8')

  const result = await runAssistantDoctor(vaultRoot)

  assert.equal(result.ok, false)
  assertCheckStatus(result, 'session-files', 'fail')
  assertCheckStatus(result, 'transcript-files', 'fail')
  assertCheckStatus(result, 'assistant-state-permissions', 'fail')
  assertCheckStatus(result, 'assistant-session-secrets', 'fail')
  assertCheckStatus(result, 'automation-state', 'fail')
  assertCheckStatus(result, 'turn-receipts', 'fail')
  assertCheckStatus(result, 'outbox-intents', 'fail')
  assertCheckStatus(result, 'diagnostic-events', 'fail')
  assertCheckStatus(result, 'runtime-events', 'fail')
  assertCheckStatus(result, 'diagnostics-snapshot', 'fail')
  assertCheckStatus(result, 'failover-state', 'fail')
  assertCheckStatus(result, 'status-snapshot', 'fail')
  assertCheckStatus(result, 'runtime-budget', 'fail')
})

function getCheck(
  result: Awaited<ReturnType<typeof runAssistantDoctor>>,
  name: string,
) {
  const check = result.checks.find((entry) => entry.name === name)
  assert.ok(check, `expected doctor check ${name}`)
  return check
}

function assertCheckStatus(
  result: Awaited<ReturnType<typeof runAssistantDoctor>>,
  name: string,
  status: AssistantDoctorCheckStatus,
) {
  assert.equal(getCheck(result, name).status, status)
}

async function createAssistantStateFixture() {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'assistant-doctor-'))
  tempRoots.push(vaultRoot)
  currentPaths = resolveAssistantStatePaths(vaultRoot)
  await Promise.all([
    mkdir(currentPaths.sessionsDirectory, { recursive: true }),
    mkdir(currentPaths.transcriptsDirectory, { recursive: true }),
    mkdir(currentPaths.turnsDirectory, { recursive: true }),
    mkdir(currentPaths.outboxDirectory, { recursive: true }),
    mkdir(path.dirname(currentPaths.diagnosticEventsPath), { recursive: true }),
    mkdir(path.dirname(currentPaths.runtimeEventsPath), { recursive: true }),
  ])
  return {
    paths: currentPaths,
    vaultRoot,
  }
}

async function writeJson(filePath: string, value: unknown, trailingNewline = false) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value)}${trailingNewline ? '\n' : ''}`, 'utf8')
}

async function writeJsonl(filePath: string, values: unknown[]) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${values.map((value) => JSON.stringify(value)).join('\n')}\n`, 'utf8')
}
