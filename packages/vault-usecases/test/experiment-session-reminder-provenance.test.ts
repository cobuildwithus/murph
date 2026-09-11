import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createExperiment, initializeVault, readJsonlRecords } from '@murphai/core'
import { assistantOutboxIntentSchema } from '@murphai/operator-config/assistant-cli-contracts'
import { test, vi } from 'vitest'

import {
  logExperimentSessionRecord,
  logExperimentSessionRecordFromInput,
} from '../src/usecases/experiment-journal-vault.js'
import { createIntegratedVaultServices } from '../src/vault-services.js'

const occurrenceAt = '2026-08-10T15:00:00.000Z'
const intentId = 'outbox_experiment_reminder_01'

async function withExperiment(
  run: (input: { experimentId: string; vault: string }) => Promise<void>,
): Promise<void> {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-reminder-reader-'))
  try {
    await initializeVault({ vaultRoot: vault })
    const created = await createExperiment({
      vaultRoot: vault,
      slug: 'reminder-reader-sauna',
      title: 'Sauna',
      startedOn: '2026-08-01',
      status: 'active',
      runPlan: {
        interventionStart: '2026-08-01',
        interventionEnd: '2026-08-31',
        modality: 'sauna',
        targetSessions: 8,
        minimumUsefulSessions: 4,
      },
    })
    await run({ experimentId: created.experiment.id, vault })
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
}

function reminderIntent(experimentId: string) {
  return assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    intentId,
    sessionId: 'session_reminder',
    turnId: 'turn_reminder',
    createdAt: occurrenceAt,
    updatedAt: occurrenceAt,
    lastAttemptAt: occurrenceAt,
    nextAttemptAt: null,
    sentAt: occurrenceAt,
    attemptCount: 1,
    status: 'sent',
    message: 'Session time.',
    dedupeKey: 'experiment-reminder',
    targetFingerprint: 'private-reminder',
    channel: 'linq',
    identityId: null,
    actorId: 'member-demo',
    threadId: 'thread-demo',
    threadIsDirect: true,
    bindingDelivery: null,
    explicitTarget: null,
    automationAuthority: {
      automationId: 'automation_reminder',
      supportSeriesId: `experiment:${experimentId}`,
      expectedUpdatedAt: occurrenceAt,
    },
    scheduledOccurrenceAt: occurrenceAt,
    plannedOccurrenceAt: occurrenceAt,
    delivery: {
      kind: 'message',
      channel: 'linq',
      idempotencyKey: null,
      target: 'thread-demo',
      targetKind: 'thread',
      sentAt: occurrenceAt,
      messageLength: 13,
      providerMessageId: 'message-demo',
      providerThreadId: 'thread-demo',
    },
    lastError: null,
  })
}

test('reminder logging passes the exact vault and intent id to the injected owner reader', async () => {
  await withExperiment(async ({ experimentId, vault }) => {
    const readAssistantOutboxIntent = vi.fn(async () => reminderIntent(experimentId))
    const result = await logExperimentSessionRecord({
      vault,
      lookup: experimentId,
      reminderIntentId: intentId,
    }, { readAssistantOutboxIntent })

    assert.deepEqual(readAssistantOutboxIntent.mock.calls, [[vault, intentId]])
    assert.equal(result.created, true)
    const records = await readJsonlRecords({ vaultRoot: vault, relativePath: result.ledgerFile })
    assert.equal(records.find((record) => record.id === result.eventId)?.occurredAt, occurrenceAt)
  })
})

test('manual session logging needs no outbox reader and never calls an injected reader', async () => {
  await withExperiment(async ({ experimentId, vault }) => {
    const input = { vault, lookup: experimentId, occurredAt: occurrenceAt }
    assert.equal((await logExperimentSessionRecord(input)).created, true)
    const readAssistantOutboxIntent = vi.fn(async () => {
      throw new Error('Manual sessions must not read assistant runtime state.')
    })
    assert.equal((await logExperimentSessionRecord(input, { readAssistantOutboxIntent })).created, true)
    assert.equal(readAssistantOutboxIntent.mock.calls.length, 0)
  })
})

test('reminder logging fails closed without its reader, for a missing intent, and for an id substitution', async () => {
  await withExperiment(async ({ experimentId, vault }) => {
    const input = { vault, lookup: experimentId, reminderIntentId: intentId }
    await assert.rejects(() => logExperimentSessionRecord(input), { code: 'runtime_unavailable' })
    await assert.rejects(() => logExperimentSessionRecord(input, {
      readAssistantOutboxIntent: async () => null,
    }), { code: 'contract_invalid' })
    await assert.rejects(() => logExperimentSessionRecord(input, {
      readAssistantOutboxIntent: async () => ({
        ...reminderIntent(experimentId),
        intentId: 'outbox_different_intent',
      }),
    }), { code: 'contract_invalid' })

    const progress = await createIntegratedVaultServices().query.showExperimentProgress({
      vault,
      lookup: experimentId,
      requestId: null,
    })
    assert.deepEqual(progress.progress.adherence.sessionEventIds, [])
  })
})

test('invalid reminder ids are rejected before invoking the owner reader', async () => {
  await withExperiment(async ({ experimentId, vault }) => {
    const readAssistantOutboxIntent = vi.fn(async () => reminderIntent(experimentId))
    await assert.rejects(() => logExperimentSessionRecord({
      vault,
      lookup: experimentId,
      reminderIntentId: '../outbox_other',
    }, { readAssistantOutboxIntent }), { code: 'invalid_option' })
    assert.equal(readAssistantOutboxIntent.mock.calls.length, 0)
  })
})

test('JSON payloads cannot supply reminder proof through direct or lazy integrated services', async () => {
  await withExperiment(async ({ experimentId, vault }) => {
    const inputFile = path.join(vault, 'session.json')
    await writeFile(inputFile, JSON.stringify({
      reminderIntentId: intentId,
      plannedOccurrenceAt: '2026-08-11T15:00:00.000Z',
      reminderProof: { plannedOccurrenceAt: '2026-08-11T15:00:00.000Z' },
      intent: reminderIntent(experimentId),
      dependencies: { readAssistantOutboxIntent: reminderIntent(experimentId) },
    }))
    const input = { vault, lookup: experimentId, inputFile, requestId: null }
    await assert.rejects(() => logExperimentSessionRecordFromInput(input), {
      code: 'runtime_unavailable',
    })
    const readAssistantOutboxIntent = vi.fn(async () => null)
    const dependencies = { readAssistantOutboxIntent }
    await assert.rejects(() => logExperimentSessionRecordFromInput(input, dependencies), {
      code: 'contract_invalid',
    })
    const services = createIntegratedVaultServices(dependencies)
    await assert.rejects(() => services.core.logExperimentSessionJson(input), {
      code: 'contract_invalid',
    })
    assert.deepEqual(readAssistantOutboxIntent.mock.calls, [[vault, intentId], [vault, intentId]])

    const trustedServices = createIntegratedVaultServices({
      readAssistantOutboxIntent: async () => reminderIntent(experimentId),
    })
    const result = await trustedServices.core.logExperimentSessionJson(input)
    const records = await readJsonlRecords({ vaultRoot: vault, relativePath: result.ledgerFile })
    assert.equal(records.find((record) => record.id === result.eventId)?.occurredAt, occurrenceAt)
    const replay = await logExperimentSessionRecordFromInput(input, {
      readAssistantOutboxIntent: async () => reminderIntent(experimentId),
    })
    assert.equal(replay.eventId, result.eventId)
    assert.equal(replay.created, false)
  })
})
