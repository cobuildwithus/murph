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
    expect(result).toMatchObject({ status: 'available', historyLimit: 10, historyTruncated: true,
      current: { phase: 'idle', retryAt: null }, recentRuns: [expect.objectContaining({ outcome: 'failed' }), ...Array.from({ length: 9 }, () => expect.objectContaining({ outcome: 'delivered' }))] })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_RESPONSE_SENTINEL|synthetic-secret|sessionId|runId|runningPid/)
    expect(JSON.stringify(result)).toContain('Service unavailable')
    expect(result).toMatchObject({ nextStep: expect.stringContaining('option to reschedule') })
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
    expect(result).toMatchObject({ status: 'available', delivery: { status, attemptCount: 1, sentAt: status === 'sent' ? at : null } })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MESSAGE_SENTINEL')
  })
})
