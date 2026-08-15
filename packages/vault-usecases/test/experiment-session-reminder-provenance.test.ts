import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createExperiment, initializeVault, readJsonlRecords } from '@murphai/core'
import { assistantOutboxIntentSchema } from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantStatePaths } from '@murphai/runtime-state/node'
import { test } from 'vitest'

import { logExperimentSessionRecord } from '../src/usecases/experiment-journal-vault.js'

const occurrenceDate = new Date()
occurrenceDate.setUTCDate(occurrenceDate.getUTCDate() - 1)
occurrenceDate.setUTCHours(15, 0, 0, 0)
const occurrenceAt = occurrenceDate.toISOString()
const experimentStartedOn = formatLocalDate(addUtcDays(occurrenceDate, -7))
const experimentInterventionEnd = formatLocalDate(addUtcDays(occurrenceDate, 60))
const firstIntentId = 'outbox_experiment_reminder_01'
const retryIntentId = 'outbox_experiment_reminder_02'
const automationId = 'automation_experiment_reminder_01'

function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setUTCDate(copy.getUTCDate() + days)
  return copy
}

function formatLocalDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function countEventIdInLedger(input: {
  eventId: string
  ledgerFile: string
  vaultRoot: string
}): Promise<number> {
  const records = await readJsonlRecords({
    vaultRoot: input.vaultRoot,
    relativePath: input.ledgerFile,
  })
  return records.filter((record) => record.id === input.eventId).length
}

async function withExperiment(
  run: (input: { experimentId: string; vaultRoot: string }) => Promise<void>,
): Promise<void> {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-reminder-session-'))
  try {
    await initializeVault({ vaultRoot })
    const created = await createExperiment({
      vaultRoot,
      slug: 'reminder-backed-sauna',
      title: 'Reminder-backed sauna',
      startedOn: experimentStartedOn,
      status: 'active',
      runPlan: {
        interventionStart: experimentStartedOn,
        interventionEnd: experimentInterventionEnd,
        modality: 'sauna',
        targetSessions: 8,
        minimumUsefulSessions: 4,
      },
    })
    await run({
      experimentId: created.experiment.id,
      vaultRoot,
    })
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}

async function writeReminderIntent(input: {
  experimentId: string
  intentId: string
  status?: 'pending' | 'sent'
  supportSeriesId?: string
  threadIsDirect?: boolean
  vaultRoot: string
}): Promise<void> {
  const message = 'Sauna session time. Reply when you finish.'
  const status = input.status ?? 'sent'
  const intent = assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    intentId: input.intentId,
    sessionId: `session_${input.intentId}`,
    turnId: `turn_${input.intentId}`,
    createdAt: occurrenceAt,
    updatedAt: occurrenceAt,
    lastAttemptAt: occurrenceAt,
    nextAttemptAt: null,
    sentAt: status === 'sent' ? occurrenceAt : null,
    attemptCount: status === 'sent' ? 1 : 0,
    status,
    message,
    subject: null,
    operation: null,
    dedupeKey: `experiment-reminder-dedupe:${input.intentId}`,
    targetFingerprint: 'experiment-reminder-target',
    channel: 'linq',
    identityId: null,
    actorId: 'member-1',
    threadId: 'thread-1',
    threadIsDirect: input.threadIsDirect ?? true,
    replyToMessageId: null,
    bindingDelivery: null,
    deliverySource: null,
    automationAuthority: {
      automationId,
      supportSeriesId:
        input.supportSeriesId ?? `experiment:${input.experimentId}`,
      expectedUpdatedAt: occurrenceAt,
    },
    scheduledOccurrenceAt: occurrenceAt,
    explicitTarget: null,
    delivery:
      status === 'sent'
        ? {
            kind: 'message',
            channel: 'linq',
            idempotencyKey: null,
            target: 'thread-1',
            targetKind: 'thread',
            sentAt: occurrenceAt,
            messageLength: message.length,
            providerMessageId: `linq-message:${input.intentId}`,
            providerThreadId: 'thread-1',
          }
        : null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: null,
    deliveryTransportIdempotent: false,
    lastError: null,
  })
  const outboxDirectory = resolveAssistantStatePaths(input.vaultRoot).outboxDirectory
  await mkdir(outboxDirectory, { recursive: true })
  await writeFile(
    path.join(outboxDirectory, `${input.intentId}.json`),
    `${JSON.stringify(intent)}\n`,
    'utf8',
  )
}

test('delivered reminder provenance owns one deterministic experiment occurrence without a current automation read', async () => {
  await withExperiment(async ({ experimentId, vaultRoot }) => {
    await writeReminderIntent({
      experimentId,
      intentId: firstIntentId,
      vaultRoot,
    })
    await writeReminderIntent({
      experimentId,
      intentId: retryIntentId,
      vaultRoot,
    })

    const [first, replay] = await Promise.all([
      logExperimentSessionRecord({
        vault: vaultRoot,
        lookup: experimentId,
        reminderIntentId: firstIntentId,
      }),
      logExperimentSessionRecord({
        vault: vaultRoot,
        lookup: experimentId,
        reminderIntentId: retryIntentId,
      }),
    ])

    assert.equal([first, replay].filter((result) => result.created).length, 1)
    assert.equal(replay.eventId, first.eventId)
    if (!('progress' in first) || !('progress' in replay)) {
      assert.fail('reminder-backed writes must return canonical progress readback')
    }
    assert.equal(first.progress?.adherence.completedSessions, 1)
    assert.deepEqual(first.progress?.adherence.sessionEventIds, [first.eventId])
    assert.equal(replay.progress?.adherence.completedSessions, 1)
    assert.deepEqual(replay.progress?.adherence.sessionEventIds, [first.eventId])
    assert.equal(
      await countEventIdInLedger({
        eventId: first.eventId,
        ledgerFile: first.ledgerFile,
        vaultRoot,
      }),
      1,
    )
  })
})

test('reminder-backed session logging rejects transport, owner, and occurrence substitutions', async () => {
  await withExperiment(async ({ experimentId, vaultRoot }) => {
    await writeReminderIntent({
      experimentId,
      intentId: firstIntentId,
      supportSeriesId: 'experiment:exp_other_owner',
      vaultRoot,
    })
    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
        }),
      /does not own experiment/u,
    )

    await writeReminderIntent({
      experimentId,
      intentId: firstIntentId,
      status: 'pending',
      vaultRoot,
    })
    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
        }),
      /not a provider-accepted private reminder message/u,
    )

    await writeReminderIntent({
      experimentId,
      intentId: firstIntentId,
      threadIsDirect: false,
      vaultRoot,
    })
    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
        }),
      /not a provider-accepted private reminder message/u,
    )

    await writeReminderIntent({
      experimentId,
      intentId: firstIntentId,
      vaultRoot,
    })
    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
          occurredAt: '2026-08-10T16:00:00.000Z',
        }),
      /Do not pass date, occurredAt, or source/u,
    )
    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
          date: '2026-08-10',
        }),
      /Do not pass date, occurredAt, or source/u,
    )
    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
          source: 'device',
        }),
      /Do not pass date, occurredAt, or source/u,
    )
  })
})

test('reminder occurrence replays reject semantic changes instead of silently rewriting or duplicating the event', async () => {
  await withExperiment(async ({ experimentId, vaultRoot }) => {
    await writeReminderIntent({
      experimentId,
      intentId: firstIntentId,
      vaultRoot,
    })
    const created = await logExperimentSessionRecord({
      vault: vaultRoot,
      lookup: experimentId,
      reminderIntentId: firstIntentId,
      sessionStatus: 'completed',
    })

    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
          sessionStatus: 'missed',
        }),
      /already logged with different sessionStatus/u,
    )
    assert.equal(
      await countEventIdInLedger({
        eventId: created.eventId,
        ledgerFile: created.ledgerFile,
        vaultRoot,
      }),
      1,
    )
  })
})
