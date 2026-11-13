import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getAssistantCronAutomationInspection } from '../src/assistant/cron/inspection.js'
import { createAssistantOutboxIntent, saveAssistantOutboxIntent } from '../src/assistant/outbox.js'
import { writeAssistantCronCanonicalRuntimeStore, type AssistantCronCanonicalRuntimeState } from '../src/assistant/cron/runtime-state.js'
import { appendAssistantCronRun } from '../src/assistant/cron/store.js'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.js'

const roots: string[] = []
const at = '2030-01-17T10:00:00.000Z'
const jobId = 'automation_inspection'
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))) })

async function fixture(state: Partial<AssistantCronCanonicalRuntimeState> = {}) {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-cron-inspection-'))
  roots.push(vault)
  const paths = resolveAssistantStatePaths(vault)
  await writeAssistantCronCanonicalRuntimeStore(paths, { version: 1, jobs: [{
    schema: 'murph.assistant-canonical-cron-runtime-state.v1', jobId,
    alias: null, sessionId: null, createdAt: at, updatedAt: at,
    state: { activatedAt: at, pendingOccurrenceAt: null, retryAfterAt: null,
      lastRunAt: null, lastSucceededAt: null, lastFailedAt: null, consecutiveFailures: 0,
      lastError: null, pendingDeliveryIntentId: null, runningAt: null, runningClaimId: null,
      runningPid: null, ...state },
  }] })
  return { vault, paths }
}

describe('automation execution inspection', () => {
  it.each([
    ['idle', {}],
    ['waiting_occurrence', { pendingOccurrenceAt: at }],
    ['retrying', { pendingOccurrenceAt: at, retryAfterAt: at }],
    ['running', { pendingOccurrenceAt: at, retryAfterAt: at, runningAt: at, runningPid: 1 }],
    ['waiting_delivery', { pendingDeliveryIntentId: 'aoi_11111111111111111111111111111111' }],
  ] as const)('distinguishes %s without consuming or repairing runtime work', async (phase, state) => {
    const { vault, paths } = await fixture(state)
    const before = await readFile(paths.cronAutomationStatePath, 'utf8')
    expect(await getAssistantCronAutomationInspection(vault, jobId)).toMatchObject({ status: 'available', current: { phase } })
    expect(await readFile(paths.cronAutomationStatePath, 'utf8')).toBe(before)
  })

  it('returns bounded newest-first attempt outcomes without response bodies or credentials', async () => {
    const { vault, paths } = await fixture({ lastFailedAt: at, lastError: 'Service unavailable; api_key=synthetic-secret' })
    for (let index = 0; index < 12; index++) {
      const timestamp = new Date(Date.parse(at) + index * 60_000).toISOString()
      await appendAssistantCronRun(paths, {
        schema: 'murph.assistant-cron-run.v1', runId: `acr_${String(index).padStart(32, '0')}`,
        jobId, trigger: 'scheduled', startedAt: timestamp, finishedAt: timestamp,
        scheduledOccurrenceAt: timestamp, sessionId: null, response: 'PRIVATE_RESPONSE_SENTINEL', responseLength: 25,
        outcome: index === 11 ? 'failed' : 'delivered', reason: index === 11 ? 'provider_unavailable' : 'sent',
        error: index === 11 ? 'Service unavailable; api_key=synthetic-secret' : null,
      })
    }
    const result = await getAssistantCronAutomationInspection(vault, jobId)
    if (result.status !== 'available') throw new Error('Expected available inspection')
    // Absent nulls, constant limits and outcome-restating reasons are omitted.
    expect(result).not.toHaveProperty('historyLimit')
    expect(result).not.toHaveProperty('delivery')
    expect(result.historyTruncated).toBe(true)
    expect(result.current).toEqual({ phase: 'idle', error: expect.stringContaining('Service unavailable') })
    const newest = new Date(Date.parse(at) + 11 * 60_000).toISOString()
    expect(result.recentRuns[0]).toEqual({ finishedAt: newest, occurrenceAt: newest, outcome: 'failed',
      reason: 'provider_unavailable', error: expect.stringContaining('Service unavailable') })
    expect(result.recentRuns.slice(1)).toEqual(Array.from({ length: 9 }, (_, index) => {
      const timestamp = new Date(Date.parse(at) + (10 - index) * 60_000).toISOString()
      return { finishedAt: timestamp, occurrenceAt: timestamp, outcome: 'delivered' }
    }))
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_RESPONSE_SENTINEL|synthetic-secret|sessionId|runId|runningPid/)
    expect(result.nextStep).toContain('option to reschedule')
    expect(result.interpretation).toContain('After failure, say the message may not have gone out')
    expect(result.interpretation).toContain('A retry is scheduled only when current.retryAt or delivery.nextAttemptAt is present')
    expect(result.interpretation).toContain('use occurrenceProjection for the next scheduled occurrence')
    expect(result.interpretation).not.toContain('delivery_pending')
  })

  it('returns only the guidance that applies to an all-delivered idle history', async () => {
    const { vault, paths } = await fixture()
    await appendAssistantCronRun(paths, {
      schema: 'murph.assistant-cron-run.v1', runId: `acr_${'1'.repeat(32)}`,
      jobId, trigger: 'scheduled', startedAt: at, finishedAt: at,
      scheduledOccurrenceAt: at, sessionId: null, response: null, responseLength: 0,
      outcome: 'delivered', reason: 'sent', error: null,
    })
    const result = await getAssistantCronAutomationInspection(vault, jobId)
    expect(result).toEqual({
      status: 'available',
      current: { phase: 'idle' },
      recentRuns: [{ finishedAt: at, occurrenceAt: at, outcome: 'delivered' }],
      nextStep: 'Explain the recorded outcome and use the stored schedule and occurrence projection for future timing.',
      interpretation: 'This is retained attempt history, newest first, not a complete lifetime history. '
        + 'Only delivered or delivery.status=sent confirms sending, not reading. '
        + 'Do not treat a consumed occurrence, an empty retained history, or a null next occurrence as proof of delivery.',
    })
  })

  it.each(['retryable', 'sent', 'failed', 'abandoned'] as const)('shows exact outstanding delivery evidence when %s', async (status) => {
    const { vault, paths } = await fixture()
    const intent = await createAssistantOutboxIntent({ vault, message: 'PRIVATE_MESSAGE_SENTINEL',
      sessionId: 'as_11111111111111111111111111111111', turnId: 'at_11111111111111111111111111111111', createdAt: at })
    await saveAssistantOutboxIntent(vault, { ...intent, status, attemptCount: 1,
      lastAttemptAt: at, nextAttemptAt: status === 'retryable' ? at : null, sentAt: status === 'sent' ? at : null })
    const runtime = JSON.parse(await readFile(paths.cronAutomationStatePath, 'utf8'))
    runtime.jobs[0].state.pendingDeliveryIntentId = intent.intentId
    await writeAssistantCronCanonicalRuntimeStore(paths, runtime)
    const result = await getAssistantCronAutomationInspection(vault, jobId)
    expect(result).toMatchObject({ status: 'available', current: { phase: 'waiting_delivery' }, delivery: {
      status, attemptCount: 1, lastAttemptAt: at, ...(status === 'sent' ? { sentAt: at } : {}),
      ...(status === 'retryable' ? { nextAttemptAt: at } : {}) } })
    if (status !== 'sent') expect(result).not.toHaveProperty('delivery.sentAt')
    if (status !== 'retryable') expect(result).not.toHaveProperty('delivery.nextAttemptAt')
    expect(result).toMatchObject({ interpretation: expect.stringContaining('use the outstanding delivery status') })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MESSAGE_SENTINEL')
  })
})
