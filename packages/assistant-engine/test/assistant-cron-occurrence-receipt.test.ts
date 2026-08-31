import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  assistantCronJobSchema,
  type AssistantCronJob,
  type AssistantCronRunOutcome,
  type AssistantCronRunRecord,
  type AssistantOutboxIntentStatus,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  getAssistantCronAutomationOccurrenceReceipt,
  projectAssistantAutomationOccurrenceReceipt,
} from '../src/assistant/cron/occurrence-receipt.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import {
  appendAssistantCronRun,
  writeAssistantCronStore,
} from '../src/assistant/cron/store.ts'
import {
  appendAssistantDeviceActivityCronJobMetadata,
  buildAssistantDeviceActivityCronJobId,
  buildAssistantDeviceActivityDeliveryIdempotencyKey,
} from '../src/assistant/device-activity-cron-tags.ts'
import { createAssistantOutboxIntent } from '../src/assistant/outbox.ts'
import { resolveAssistantOutboxIntentPath } from '../src/assistant/outbox/intents.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const AUTOMATION_ID = 'automation_01J00000000000000000000000'
const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  )
})

describe('assistant automation occurrence receipts', () => {
  it('does not turn absent retained history into a never-ran claim', () => {
    expect(projectAssistantAutomationOccurrenceReceipt({
      latestRun: null,
      pendingDeliveryIntent: null,
      pendingOccurrenceAt: null,
      runningAt: null,
    })).toEqual({ history: 'not_observed' })
  })

  it('projects a newer in-flight occurrence without inventing generation or send evidence', () => {
    expect(projectAssistantAutomationOccurrenceReceipt({
      latestRun: createRun({
        finishedAt: '2026-08-29T12:01:00.000Z',
        outcome: 'delivered',
      }),
      pendingDeliveryIntent: null,
      pendingOccurrenceAt: '2026-08-30T12:00:00.000Z',
      runningAt: '2026-08-30T12:00:01.000Z',
    })).toEqual({
      delivered: 'unknown',
      finishedAt: null,
      generated: 'unknown',
      history: 'observed',
      outcome: 'pending',
      scheduledAt: '2026-08-30T12:00:00.000Z',
      sent: 'unknown',
      startedAt: '2026-08-30T12:00:01.000Z',
      trigger: 'unknown',
    })
  })

  it('maps the legacy delivered outcome to provider-sent with handset delivery unconfirmed', () => {
    expect(projectAssistantAutomationOccurrenceReceipt(baseProjectionInput(
      createRun({ outcome: 'delivered' }),
    ))).toEqual({
      delivered: 'unconfirmed',
      finishedAt: '2026-08-30T12:01:00.000Z',
      generated: 'confirmed',
      history: 'observed',
      outcome: 'sent',
      scheduledAt: '2026-08-30T12:00:00.000Z',
      sent: 'confirmed',
      startedAt: '2026-08-30T12:00:01.000Z',
      trigger: 'scheduled',
    })
  })

  it.each([
    {
      expected: {
        delivered: 'not_reached',
        outcome: 'pending',
        sent: 'pending',
      },
      pending: false,
      status: 'pending' as const,
    },
    {
      expected: {
        delivered: 'unknown',
        outcome: 'pending',
        sent: 'unknown',
      },
      pending: true,
      status: 'retryable' as const,
    },
    {
      expected: {
        delivered: 'unconfirmed',
        outcome: 'sent',
        sent: 'confirmed',
      },
      pending: false,
      status: 'sent' as const,
    },
    {
      expected: {
        delivered: 'not_reached',
        outcome: 'failed',
        sent: 'not_reached',
      },
      pending: false,
      status: 'failed' as const,
    },
    {
      expected: {
        delivered: 'unknown',
        outcome: 'failed',
        sent: 'unknown',
      },
      pending: false,
      status: 'abandoned' as const,
    },
  ])('refines delivery-pending from exact outbox $status evidence', ({
    expected,
    pending,
    status,
  }) => {
    const receipt = projectAssistantAutomationOccurrenceReceipt({
      ...baseProjectionInput(createRun({ outcome: 'delivery_pending' })),
      pendingDeliveryIntent: createOutboxEvidence(status, pending),
    })
    expect(receipt).toEqual(expect.objectContaining({
      ...expected,
      generated: 'confirmed',
      history: 'observed',
    }))
  })

  it.each([
    'sending',
    'retryable',
    'failed',
  ] as const)('keeps persisted provider dispatch evidence for $status', (status) => {
    expect(projectAssistantAutomationOccurrenceReceipt({
      ...baseProjectionInput(createRun({ outcome: 'delivery_pending' })),
      pendingDeliveryIntent: createOutboxEvidence(status, false, true),
    })).toEqual(expect.objectContaining({
      delivered: 'unconfirmed',
      generated: 'confirmed',
      outcome: 'sent',
      sent: 'confirmed',
    }))
  })

  it.each([
    {
      expected: {
        delivered: 'not_reached',
        generated: 'not_reached',
        outcome: 'skipped',
        sent: 'not_reached',
      },
      run: createRun({ outcome: 'expired' }),
    },
    {
      expected: {
        delivered: 'not_reached',
        generated: 'confirmed',
        outcome: 'skipped',
        sent: 'not_reached',
      },
      run: createRun({
        notificationDecision: {
          kind: 'send_message',
          reasonCode: 'provider_send_message',
        },
        outcome: 'skipped_gate',
      }),
    },
    {
      expected: {
        delivered: 'not_reached',
        generated: 'not_reached',
        outcome: 'skipped',
        sent: 'not_reached',
      },
      run: createRun({
        notificationDecision: {
          kind: 'skip',
          reasonCode: 'provider_skip',
        },
        outcome: 'no_op',
      }),
    },
    {
      expected: {
        delivered: 'not_reached',
        generated: 'confirmed',
        outcome: 'no_message',
        sent: 'not_reached',
      },
      run: createRun({
        notificationDecision: {
          kind: 'send_message',
          reasonCode: 'provider_send_message',
        },
        outcome: 'no_op',
      }),
    },
    {
      expected: {
        delivered: 'unknown',
        generated: 'unknown',
        outcome: 'failed',
        sent: 'unknown',
      },
      run: createRun({ outcome: 'failed' }),
    },
  ])('keeps terminal $expected.outcome evidence distinct', ({ expected, run }) => {
    expect(projectAssistantAutomationOccurrenceReceipt(
      baseProjectionInput(run),
    )).toEqual(expect.objectContaining(expected))
  })

  it('reads the newest retained canonical run without rewriting its journal', async () => {
    const context = await createTempVaultContext('assistant-occurrence-receipt-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await appendAssistantCronRun(paths, createRun({
      finishedAt: '2026-08-29T12:01:00.000Z',
      outcome: 'failed',
      startedAt: '2026-08-29T12:00:01.000Z',
    }))
    await appendAssistantCronRun(paths, createRun({ outcome: 'delivered' }))
    const runsPath = path.join(paths.cronRunsDirectory, `${AUTOMATION_ID}.jsonl`)
    const before = await readFile(runsPath, 'utf8')

    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
    )).resolves.toMatchObject({
      delivered: 'unconfirmed',
      history: 'observed',
      outcome: 'sent',
      startedAt: '2026-08-30T12:00:01.000Z',
      sent: 'confirmed',
    })
    await expect(readFile(runsPath, 'utf8')).resolves.toBe(before)
  })

  it('keeps status-only legacy success fully ambiguous', () => {
    expect(projectAssistantAutomationOccurrenceReceipt(baseProjectionInput({
      ...createRun({ outcome: 'delivered' }),
      reason: 'legacy_succeeded',
      status: 'succeeded',
    }))).toMatchObject({
      delivered: 'unknown',
      generated: 'unknown',
      history: 'observed',
      outcome: 'unknown',
      sent: 'unknown',
    })
  })

  it('preserves generation evidence without upgrading a legacy success to sent', async () => {
    const context = await createTempVaultContext('assistant-occurrence-legacy-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await mkdir(paths.cronRunsDirectory, { recursive: true })
    const runsPath = path.join(paths.cronRunsDirectory, `${AUTOMATION_ID}.jsonl`)
    await writeFile(runsPath, `${JSON.stringify({
      error: null,
      finishedAt: '2026-08-30T12:01:00.000Z',
      jobId: AUTOMATION_ID,
      response: 'Generated legacy response.',
      responseLength: 'Generated legacy response.'.length,
      runId: 'cronrun_legacy_ambiguous_success',
      schema: 'murph.assistant-cron-run.v1',
      sessionId: null,
      startedAt: '2026-08-30T12:00:01.000Z',
      status: 'succeeded',
      trigger: 'scheduled',
    })}\n`, 'utf8')

    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
    )).resolves.toMatchObject({
      delivered: 'unknown',
      generated: 'confirmed',
      history: 'observed',
      outcome: 'unknown',
      sent: 'unknown',
    })
  })

  it('correlates the exact canonical outbox pointer without rewriting any source', async () => {
    const context = await createTempVaultContext('assistant-occurrence-outbox-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await appendAssistantCronRun(paths, createRun({ outcome: 'delivery_pending' }))
    const intent = await createAssistantOutboxIntent({
      automationAuthority: {
        automationId: AUTOMATION_ID,
        expectedUpdatedAt: '2026-08-30T11:59:00.000Z',
      },
      channel: 'linq',
      dedupeToken: 'occurrence-receipt-exact-intent',
      explicitTarget: 'chat_synthetic_occurrence_receipt',
      identityId: 'identity_synthetic_occurrence_receipt',
      message: 'Private content excluded from the receipt.',
      scheduledOccurrenceAt: '2026-08-30T12:00:00.000Z',
      sessionId: 'session_synthetic_occurrence_receipt',
      threadId: 'thread_synthetic_occurrence_receipt',
      threadIsDirect: true,
      turnId: 'turn_synthetic_occurrence_receipt',
      vault: context.vaultRoot,
    })
    const runtimeRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: AUTOMATION_ID,
      now: '2026-08-30T11:59:00.000Z',
    })
    runtimeRecord.state.pendingDeliveryIntentId = intent.intentId
    runtimeRecord.state.pendingOccurrenceAt = '2026-08-30T12:00:00.000Z'
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [runtimeRecord],
      version: 1,
    })
    const runsPath = path.join(paths.cronRunsDirectory, `${AUTOMATION_ID}.jsonl`)
    const intentPath = resolveAssistantOutboxIntentPath(
      paths.outboxDirectory,
      intent.intentId,
    )
    const sources = [runsPath, paths.cronAutomationStatePath, intentPath]
    const before = await Promise.all(sources.map((source) => readFile(source)))

    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
    )).resolves.toMatchObject({
      delivered: 'not_reached',
      generated: 'confirmed',
      history: 'observed',
      outcome: 'pending',
      sent: 'pending',
    })
    const after = await Promise.all(sources.map((source) => readFile(source)))
    expect(after).toEqual(before)

    const corruptIntent = Buffer.from('{"private":"malformed outbox"}\n')
    await writeFile(intentPath, corruptIntent)
    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
    )).resolves.toEqual({ history: 'unavailable' })
    await expect(readFile(intentPath)).resolves.toEqual(corruptIntent)

    await writeFile(intentPath, before[2] as Buffer)
    const corruptRuntime = Buffer.from('{"private":"malformed runtime"}\n')
    await writeFile(paths.cronAutomationStatePath, corruptRuntime)
    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
    )).resolves.toEqual({ history: 'unavailable' })
    await expect(readFile(paths.cronAutomationStatePath)).resolves.toEqual(
      corruptRuntime,
    )
  })

  it('derives device-activity history from the inspected parent cursor', async () => {
    const context = await createTempVaultContext('assistant-occurrence-device-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    const schedule = {
      after: '2026-08-30T11:58:00.000Z',
      afterEntityId: 'activity_synthetic_latest',
      afterOccurredAt: '2026-08-30T11:30:00.000Z',
      kind: 'deviceActivity' as const,
      source: 'whoop' as const,
    }
    const jobId = buildAssistantDeviceActivityCronJobId({
      entityId: schedule.afterEntityId,
      occurredAt: schedule.afterOccurredAt,
      parentAutomationId: AUTOMATION_ID,
      triggeredAt: schedule.after,
    })
    await appendAssistantCronRun(paths, createRun({
      jobId,
      outcome: 'delivered',
    }))

    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
    )).resolves.toEqual({ history: 'not_observed' })
    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
      { deviceActivitySchedule: schedule },
    )).resolves.toMatchObject({
      delivered: 'unconfirmed',
      history: 'observed',
      outcome: 'sent',
      sent: 'confirmed',
    })
    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
      {
        deviceActivitySchedule: {
          after: schedule.after,
          kind: 'deviceActivity',
        },
      },
    )).resolves.toEqual({ history: 'not_observed' })
  })

  it('requires matching parent and occurrence metadata for device delivery evidence', async () => {
    const context = await createTempVaultContext('assistant-occurrence-device-outbox-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    const schedule = {
      after: '2026-08-30T11:58:00.000Z',
      afterEntityId: 'activity_synthetic_pending',
      afterOccurredAt: '2026-08-30T11:30:00.000Z',
      kind: 'deviceActivity' as const,
    }
    const jobId = buildAssistantDeviceActivityCronJobId({
      entityId: schedule.afterEntityId,
      occurredAt: schedule.afterOccurredAt,
      parentAutomationId: AUTOMATION_ID,
      triggeredAt: schedule.after,
    })
    const occurrenceKey = jobId.slice('cron_device_activity_'.length)
    const metadata = {
      authorityKey: 'a'.repeat(40),
      occurrenceKey,
      parentAutomationId: AUTOMATION_ID,
    }
    const intent = await createAssistantOutboxIntent({
      channel: 'linq',
      deliveryIdempotencyKey:
        buildAssistantDeviceActivityDeliveryIdempotencyKey({
          discriminator: 'receipt-test',
          metadata,
        }),
      explicitTarget: 'chat_synthetic_device_receipt',
      identityId: 'identity_synthetic_device_receipt',
      message: 'Private device activity response.',
      sessionId: 'session_synthetic_device_receipt',
      threadId: 'thread_synthetic_device_receipt',
      threadIsDirect: true,
      turnId: 'turn_synthetic_device_receipt',
      vault: context.vaultRoot,
    })
    await appendAssistantCronRun(paths, createRun({
      jobId,
      outcome: 'delivery_pending',
    }))
    await writeAssistantCronStore(paths, {
      jobs: [createDeviceActivityJob({
        jobId,
        metadata,
        pendingDeliveryIntentId: intent.intentId,
      })],
      version: 1,
    })

    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
      { deviceActivitySchedule: schedule },
    )).resolves.toMatchObject({
      history: 'observed',
      outcome: 'pending',
      sent: 'pending',
    })

    const intentPath = resolveAssistantOutboxIntentPath(
      paths.outboxDirectory,
      intent.intentId,
    )
    const storedIntent = JSON.parse(await readFile(intentPath, 'utf8')) as Record<string, unknown>
    storedIntent.deliveryIdempotencyKey =
      buildAssistantDeviceActivityDeliveryIdempotencyKey({
        discriminator: 'receipt-test',
        metadata: {
          ...metadata,
          parentAutomationId: 'automation_other_parent',
        },
      })
    const mismatchedBytes = `${JSON.stringify(storedIntent)}\n`
    await writeFile(intentPath, mismatchedBytes, 'utf8')
    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
      { deviceActivitySchedule: schedule },
    )).resolves.toEqual({ history: 'unavailable' })
    await expect(readFile(intentPath, 'utf8')).resolves.toBe(mismatchedBytes)
  })

  it('reports corrupt retained history unavailable without quarantining or rewriting it', async () => {
    const context = await createTempVaultContext('assistant-occurrence-corrupt-')
    tempRoots.push(context.parentRoot)
    const paths = resolveAssistantStatePaths(context.vaultRoot)
    await mkdir(paths.cronRunsDirectory, { recursive: true })
    const runsPath = path.join(paths.cronRunsDirectory, `${AUTOMATION_ID}.jsonl`)
    const corrupt = '{"private":"malformed committed history"}\n'
    await writeFile(runsPath, corrupt, 'utf8')

    await expect(getAssistantCronAutomationOccurrenceReceipt(
      context.vaultRoot,
      AUTOMATION_ID,
    )).resolves.toEqual({ history: 'unavailable' })
    await expect(readFile(runsPath, 'utf8')).resolves.toBe(corrupt)
  })
})

function baseProjectionInput(latestRun: AssistantCronRunRecord) {
  return {
    latestRun,
    pendingDeliveryIntent: null,
    pendingOccurrenceAt: null,
    runningAt: null,
  }
}

function createOutboxEvidence(
  status: AssistantOutboxIntentStatus,
  deliveryConfirmationPending: boolean,
  dispatchConfirmed = false,
) {
  return {
    deliveryConfirmationPending,
    dispatchConfirmed,
    status,
  }
}

function createRun(input: {
  finishedAt?: string
  jobId?: string
  notificationDecision?: AssistantCronRunRecord['notificationDecision']
  outcome: AssistantCronRunOutcome
  responseLength?: number
  startedAt?: string
}): AssistantCronRunRecord {
  return {
    error: input.outcome === 'failed' ? 'synthetic failure' : null,
    finishedAt: input.finishedAt ?? '2026-08-30T12:01:00.000Z',
    jobId: input.jobId ?? AUTOMATION_ID,
    notificationDecision: input.notificationDecision ?? null,
    outcome: input.outcome,
    reason: input.outcome,
    response: null,
    responseLength: input.responseLength ?? 0,
    runId: 'cronrun_01J00000000000000000000000',
    scheduledOccurrenceAt: '2026-08-30T12:00:00.000Z',
    schema: 'murph.assistant-cron-run.v1',
    sessionId: null,
    startedAt: input.startedAt ?? '2026-08-30T12:00:01.000Z',
    trigger: 'scheduled',
  }
}

function createDeviceActivityJob(input: {
  jobId: string
  metadata: {
    authorityKey: string
    occurrenceKey: string
    parentAutomationId: string
  }
  pendingDeliveryIntentId: string
}): AssistantCronJob {
  return assistantCronJobSchema.parse({
    createdAt: '2026-08-30T11:58:00.000Z',
    enabled: true,
    jobId: input.jobId,
    keepAfterRun: false,
    name: appendAssistantDeviceActivityCronJobMetadata(
      'Synthetic device activity occurrence',
      input.metadata,
    ),
    prompt: 'Summarize the synthetic activity.',
    schedule: {
      at: '2026-08-30T12:00:00.000Z',
      kind: 'at',
    },
    schema: 'murph.assistant-cron-job.v1',
    state: {
      consecutiveFailures: 0,
      lastError: null,
      lastFailedAt: null,
      lastRunAt: '2026-08-30T12:00:00.000Z',
      lastSucceededAt: null,
      nextRunAt: null,
      pendingDeliveryIntentId: input.pendingDeliveryIntentId,
      runningAt: null,
      runningPid: null,
    },
    target: {
      alias: null,
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: 'chat_synthetic_device_receipt',
      identityId: 'identity_synthetic_device_receipt',
      participantId: null,
      sessionId: null,
      threadId: 'thread_synthetic_device_receipt',
    },
    updatedAt: '2026-08-30T12:01:00.000Z',
  })
}
