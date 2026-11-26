import { initializeVault } from '@murphai/core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { sendAssistantNotificationLocal } from '../src/assistant-service.js'
import { runAssistantCronJobNow } from '../src/assistant/cron.ts'
import { queueClinicalChange } from '../src/assistant/cron/clinical-change.ts'
import { readAssistantCronStore } from '../src/assistant/cron/store.ts'
import { createAssistantOutboxIntent, listAssistantOutboxIntents, sendAssistantOutboxDispatchMessage } from '../src/assistant/outbox.ts'
import { pruneAssistantGeneratedDeliveryResidue } from '../src/assistant/runtime-residue.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'

vi.mock('../src/assistant-service.js', () => ({ sendAssistantNotificationLocal: vi.fn() }))

describe('daily hospital notification integration', () => {
  it('selects the checkpointed reply on restore and discards a longer second generation', async () => {
    const vault = await mkdtemp(path.join(tmpdir(), 'clinical-saved-'))
    try {
      await initializeVault({ vaultRoot: vault })
      const runId = 'crr_' + 'q'.repeat(32)
      const savedTurnId = 'turn_' + '1'.repeat(32)
      const occurredAt = new Date().toISOString()
      const decision = { mode: 'detail' as const, threadId: 'synthetic-private', savedTurnId }
      const replay = () => queueClinicalChange({ vault, runId, occurredAt, decision })
      expect(await replay()).toMatchObject({ savedReplyResult: { turnId: savedTurnId, status: 'missing' } })
      const stage = (turnId: string, suffix: string) => {
        const key = 'clinical-change:v1:' + runId + ':detail:' + turnId + suffix
        return createAssistantOutboxIntent({ vault, channel: 'linq', threadId: decision.threadId, threadIsDirect: true,
          turnId, sessionId: 'synthetic-session', dedupeToken: key, deliveryIdempotencyKey: key, message: 'Synthetic reply.' })
      }
      const first = await stage(savedTurnId, ':bubble:0')
      expect((await pruneAssistantGeneratedDeliveryResidue({ vault })).clinicalReplies).toBeUndefined()
      const final = await stage(savedTurnId, '')
      expect((await pruneAssistantGeneratedDeliveryResidue({ vault })).clinicalReplies).toEqual([{ runId, turnId: savedTurnId }])
      for (const suffix of [':bubble:0', ':bubble:1', '']) await stage('turn_' + '2'.repeat(32), suffix)
      expect(await replay()).toMatchObject({ deliveryIntentIds: [first.intentId, final.intentId] })
      expect((await readAssistantCronStore(resolveAssistantStatePaths(vault))).jobs).toEqual([])
    } finally { await rm(vault, { recursive: true, force: true }) }
  })

  it.each(['notice', 'detail', 'off'] as const)('daily clinical notification journey %s', async mode => {
    const vault = await mkdtemp(path.join(tmpdir(), 'clinical-notice-journey-'))
    try {
      await initializeVault({ vaultRoot: vault, timezone: 'UTC' })
      const threadId = 'synthetic-private-thread'
      const decision = mode === 'off' ? { mode } : { mode, threadId }
      const input = { decision, runId: 'synthetic-origin', occurredAt: new Date().toISOString(), vault }
      await queueClinicalChange(input)
      await queueClinicalChange(input)
      const intents = await listAssistantOutboxIntents(vault)
      const { jobs } = await readAssistantCronStore(resolveAssistantStatePaths(vault))
      expect(intents).toHaveLength(mode === 'notice' ? 1 : 0)
      expect(jobs).toHaveLength(mode === 'detail' ? 1 : 0)
      if (mode === 'notice') {
        expect(intents[0]).toMatchObject({ message: 'New records came in. Want me to go through them?',
          channel: 'linq', threadId, threadIsDirect: true, answeredMailboxItemIds: [],
          deliveryIdempotencyKey: 'clinical-change:v1:synthetic-origin:notice' })
      }
      if (mode === 'detail') {
        const job = jobs[0]!
        expect(job).toMatchObject({ keepAfterRun: false, schedule: { kind: 'at' }, clinicalChange: { runId: input.runId } })
        const resolveScheduledLinqRoute = vi.fn(async () => ({ target: threadId, threadIsDirect: true }))
        const result = await runAssistantCronJobNow({ vault, job: job.jobId, trigger: 'scheduled',
          executionContext: { hosted: { memberId: 'synthetic-member', userEnvKeys: [], resolveScheduledLinqRoute } },
        })
        expect(resolveScheduledLinqRoute).toHaveBeenCalledWith(expect.objectContaining({
          homeRouteFallbackAllowed: false, idempotencyKey: 'clinical-change:v1:synthetic-origin:detail', target: threadId, targetKind: 'thread',
        }))
        expect(result.run).toMatchObject({ outcome: 'skipped_gate', reason: 'linq_health_preflight' })
        expect(sendAssistantNotificationLocal).not.toHaveBeenCalled()
        expect(result.runErrorCode).toBe('ASSISTANT_LINQ_EGRESS_CLINICAL_IMESSAGE_ONLY_UNAVAILABLE')
        await expect(sendAssistantOutboxDispatchMessage({
          vault, channel: 'email', threadId: 'alternate-synthetic-thread', message: 'Synthetic message',
          sessionId: 'synthetic-session', turnId: 'synthetic-turn', deliveryIdempotencyKey: 'clinical-change:v1:synthetic-origin:detail:bubble:2',
        })).rejects.toMatchObject({ code: 'clinical_imessage_only_unavailable' })
        expect(await listAssistantOutboxIntents(vault)).toHaveLength(0)
      }
    } finally { await rm(vault, { recursive: true, force: true }) }
  })
})
