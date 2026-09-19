import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createExperiment, initializeVault, readJsonlRecords } from '@murphai/core'
import { assistantOutboxIntentSchema } from '@murphai/operator-config/assistant-cli-contracts'
import { saveAssistantOutboxIntent } from '@murphai/assistant-engine/assistant-outbox'
import { test } from 'vitest'
import { Cli } from 'incur'

import { createCliVaultUsecaseServices } from '../src/vault-cli-services.js'

const logExperimentSessionRecord = (
  input: Omit<Parameters<ReturnType<typeof createCliVaultUsecaseServices>['core']['logExperimentSession']>[0], 'requestId'>,
) => createCliVaultUsecaseServices().core.logExperimentSession({
  ...input,
  requestId: null,
})

const occurrenceDate = new Date()
occurrenceDate.setUTCDate(occurrenceDate.getUTCDate() - 1)
occurrenceDate.setUTCHours(15, 0, 0, 0)
const occurrenceAt = occurrenceDate.toISOString()
const crossingReminderDate = new Date(occurrenceDate)
crossingReminderDate.setUTCHours(23, 55, 0, 0)
const crossingReminderAt = crossingReminderDate.toISOString()
const plannedOccurrenceAt = new Date(
  crossingReminderDate.getTime() + 15 * 60 * 1000,
).toISOString()
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
  automationId?: string
  experimentId: string
  intentId: string
  plannedOccurrenceAt?: string | null
  scheduledOccurrenceAt?: string
  status?: 'pending' | 'sent'
  supportSeriesId?: string
  threadIsDirect?: boolean
  vaultRoot: string
}): Promise<void> {
  const message = 'Sauna session time. Reply when you finish.'
  const status = input.status ?? 'sent'
  const scheduledOccurrenceAt = input.scheduledOccurrenceAt ?? occurrenceAt
  const intent = assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    intentId: input.intentId,
    sessionId: `session_${input.intentId}`,
    turnId: `turn_${input.intentId}`,
    createdAt: scheduledOccurrenceAt,
    updatedAt: scheduledOccurrenceAt,
    lastAttemptAt: scheduledOccurrenceAt,
    nextAttemptAt: null,
    sentAt: status === 'sent' ? scheduledOccurrenceAt : null,
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
      automationId: input.automationId ?? automationId,
      supportSeriesId:
        input.supportSeriesId ?? `experiment:${input.experimentId}`,
      expectedUpdatedAt: scheduledOccurrenceAt,
    },
    scheduledOccurrenceAt,
    plannedOccurrenceAt:
      input.plannedOccurrenceAt === undefined
        ? scheduledOccurrenceAt
        : input.plannedOccurrenceAt,
    explicitTarget: null,
    delivery:
      status === 'sent'
        ? {
            kind: 'message',
            channel: 'linq',
            idempotencyKey: null,
            target: 'thread-1',
            targetKind: 'thread',
            sentAt: scheduledOccurrenceAt,
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
  await saveAssistantOutboxIntent(input.vaultRoot, intent)
}

test('delivered reminder provenance owns one deterministic experiment occurrence without a current automation read', async () => {
  await withExperiment(async ({ experimentId, vaultRoot }) => {
    await writeReminderIntent({
      automationId: 'automation_first_session_prep',
      experimentId,
      intentId: firstIntentId,
      plannedOccurrenceAt,
      scheduledOccurrenceAt: crossingReminderAt,
      vaultRoot,
    })
    await writeReminderIntent({
      automationId: 'automation_planned_session_support',
      experimentId,
      intentId: retryIntentId,
      plannedOccurrenceAt,
      scheduledOccurrenceAt: plannedOccurrenceAt,
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
    const sequentialReplay = await logExperimentSessionRecord({
      vault: vaultRoot,
      lookup: experimentId,
      reminderIntentId: retryIntentId,
    })

    assert.equal([first, replay].filter((result) => result.created).length, 1)
    assert.equal(replay.eventId, first.eventId)
    assert.equal(sequentialReplay.created, false)
    assert.equal(sequentialReplay.eventId, first.eventId)
    if (
      !('progress' in first)
      || !('progress' in replay)
      || !('progress' in sequentialReplay)
    ) {
      assert.fail('reminder-backed writes must return canonical progress readback')
    }
    assert.equal(first.progress?.adherence.completedSessions, 1)
    assert.deepEqual(first.progress?.adherence.sessionEventIds, [first.eventId])
    assert.equal(replay.progress?.adherence.completedSessions, 1)
    assert.deepEqual(replay.progress?.adherence.sessionEventIds, [first.eventId])
    assert.equal(sequentialReplay.progress?.adherence.completedSessions, 1)
    assert.deepEqual(
      sequentialReplay.progress?.adherence.sessionEventIds,
      [first.eventId],
    )
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

test('distinct planned occurrences retain distinct canonical session effects', async () => {
  await withExperiment(async ({ experimentId, vaultRoot }) => {
    const laterOccurrenceAt = new Date(
      Date.parse(occurrenceAt) + 60 * 60 * 1000,
    ).toISOString()
    await writeReminderIntent({
      automationId: 'automation_session_one',
      experimentId,
      intentId: firstIntentId,
      plannedOccurrenceAt: occurrenceAt,
      scheduledOccurrenceAt: occurrenceAt,
      vaultRoot,
    })
    await writeReminderIntent({
      automationId: 'automation_session_two',
      experimentId,
      intentId: retryIntentId,
      plannedOccurrenceAt: laterOccurrenceAt,
      scheduledOccurrenceAt: laterOccurrenceAt,
      vaultRoot,
    })

    const first = await logExperimentSessionRecord({
      vault: vaultRoot,
      lookup: experimentId,
      reminderIntentId: firstIntentId,
    })
    const second = await logExperimentSessionRecord({
      vault: vaultRoot,
      lookup: experimentId,
      reminderIntentId: retryIntentId,
    })

    assert.notEqual(second.eventId, first.eventId)
    assert.equal(first.created, true)
    assert.equal(second.created, true)
    if (!('progress' in second)) {
      assert.fail('reminder-backed writes must return canonical progress readback')
    }
    assert.equal(second.progress?.adherence.completedSessions, 2)
    assert.deepEqual(
      second.progress?.adherence.sessionEventIds,
      [first.eventId, second.eventId],
    )
  })
})

test('reminder-backed logging records a planned session after midnight instead of the earlier reminder date', async () => {
  await withExperiment(async ({ experimentId, vaultRoot }) => {
    await writeReminderIntent({
      experimentId,
      intentId: firstIntentId,
      plannedOccurrenceAt,
      scheduledOccurrenceAt: crossingReminderAt,
      vaultRoot,
    })

    const result = await logExperimentSessionRecord({
      vault: vaultRoot,
      lookup: experimentId,
      reminderIntentId: firstIntentId,
    })
    const records = await readJsonlRecords({
      vaultRoot,
      relativePath: result.ledgerFile,
    })
    const event = records.find((record) => record.id === result.eventId)

    assert.equal(event?.occurredAt, plannedOccurrenceAt)
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
      plannedOccurrenceAt: null,
      vaultRoot,
    })
    await assert.rejects(
      () =>
        logExperimentSessionRecord({
          vault: vaultRoot,
          lookup: experimentId,
          reminderIntentId: firstIntentId,
        }),
      /has no planned occurrence provenance/u,
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

test('default and scoped CLI composition both resolve delivered reminder provenance through the owner', async () => {
  await withExperiment(async ({ experimentId, vaultRoot }) => {
    await writeReminderIntent({ experimentId, intentId: firstIntentId, vaultRoot })
    const { createDefaultVaultServices } = await import('../src/vault-cli-bootstrap.js')
    const first = await createDefaultVaultServices().core.logExperimentSession({
      vault: vaultRoot,
      lookup: experimentId,
      reminderIntentId: firstIntentId,
      requestId: null,
    })
    assert.equal(first.created, true)

    const { registerScopedVaultCliCommand } = await import('../src/vault-cli-command-routing.js')
    const cli = Cli.create('vault-cli', { description: 'reminder provenance test' })
    await registerScopedVaultCliCommand({ cli, root: 'experiment' })
    const output: string[] = []
    await cli.serve([
      'experiment', 'session', 'log', experimentId,
      '--vault', vaultRoot,
      '--reminder-intent-id', firstIntentId,
      '--full-output', '--format', 'json',
    ], {
      env: process.env,
      exit() {},
      stdout(chunk) { output.push(chunk) },
    })
    const replay = JSON.parse(output.join('')) as {
      data: { eventId: string; created: boolean }
    }
    assert.equal(replay.data.eventId, first.eventId)
    assert.equal(replay.data.created, false)
    assert.equal(await countEventIdInLedger({
      eventId: first.eventId,
      ledgerFile: first.ledgerFile,
      vaultRoot,
    }), 1)
  })
})
