import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initializeVault, upsertAutomation } from '@murphai/core'
import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'

const commitMocks = vi.hoisted(() => ({
  commitSentDelivery: vi.fn(),
}))

vi.mock(
  '../src/assistant/cron/group-challenge-delivery-commit.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../src/assistant/cron/group-challenge-delivery-commit.ts')
    >()),
    commitAssistantGroupChallengeSentDelivery: commitMocks.commitSentDelivery,
  }),
)

import {
  listCanonicalAssistantCronRecords,
  resolveCanonicalRuntimeState,
} from '../src/assistant/cron/canonical-jobs.ts'
import {
  reconcileAssistantCronDeliveryIntent,
} from '../src/assistant/cron/delivery-reconciliation.ts'
import {
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'

const tempRoots: string[] = []
const OCCURRENCE_AT = '2026-07-19T08:00:00.000Z'

beforeEach(() => {
  commitMocks.commitSentDelivery.mockReset().mockResolvedValue({
    closeoutApplied: true,
    dispatchRecord: 'recorded',
    pointerRecordsRemoved: 1,
  })
})

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })))
})

describe('group challenge terminal delivery reconciliation', () => {
  it('commits terminal sent evidence before clearing the pending occurrence', async () => {
    const fixture = await createPendingChallengeFixture()

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: fixture.intent,
      paths: fixture.paths,
      vault: fixture.vault,
    })).resolves.toEqual({ reconciled: 1 })

    expect(commitMocks.commitSentDelivery).toHaveBeenCalledWith({
      expectedAutomationId: fixture.automationId,
      intent: fixture.intent,
      pendingOccurrenceAt: OCCURRENCE_AT,
      vault: fixture.vault,
    })
    const runtime = await readAssistantCronCanonicalRuntimeStore(fixture.paths)
    expect(runtime.jobs).toEqual([])
  })

  it('leaves reconciliation pending when terminal page closeout fails, then retries', async () => {
    const fixture = await createPendingChallengeFixture()
    const archiveError = new Error('injected challenge archive failure')
    commitMocks.commitSentDelivery.mockRejectedValueOnce(archiveError)

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: fixture.intent,
      paths: fixture.paths,
      vault: fixture.vault,
    })).rejects.toBe(archiveError)

    const pending = await readAssistantCronCanonicalRuntimeStore(fixture.paths)
    expect(pending.jobs[0]?.state.pendingDeliveryIntentId).toBe(
      fixture.intent.intentId,
    )
    expect(pending.jobs[0]?.state.pendingOccurrenceAt).toBe(OCCURRENCE_AT)

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: fixture.intent,
      paths: fixture.paths,
      vault: fixture.vault,
    })).resolves.toEqual({ reconciled: 1 })
    expect(commitMocks.commitSentDelivery).toHaveBeenCalledTimes(2)
    const retried = await readAssistantCronCanonicalRuntimeStore(fixture.paths)
    expect(retried.jobs).toEqual([])
  })

  it('consumes terminal sent state when the challenge record cannot be committed', async () => {
    const fixture = await createPendingChallengeFixture()
    commitMocks.commitSentDelivery.mockResolvedValueOnce({
      closeoutApplied: false,
      dispatchRecord: 'not_recorded',
      pointerRecordsRemoved: 0,
    })

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: fixture.intent,
      paths: fixture.paths,
      vault: fixture.vault,
    })).resolves.toEqual({ reconciled: 1 })

    const reconciled = await readAssistantCronCanonicalRuntimeStore(fixture.paths)
    expect(reconciled.jobs).not.toContainEqual(expect.objectContaining({
      state: expect.objectContaining({
        pendingDeliveryIntentId: fixture.intent.intentId,
      }),
    }))
    await expect(reconcileAssistantCronDeliveryIntent({
      intent: fixture.intent,
      paths: fixture.paths,
      vault: fixture.vault,
    })).resolves.toEqual({ reconciled: 0 })
    expect(commitMocks.commitSentDelivery).toHaveBeenCalledTimes(1)
  })

  it('rejects a pending intent whose automation authority names another runtime job', async () => {
    const fixture = await createPendingChallengeFixture()
    const mismatchedIntent = assistantOutboxIntentSchema.parse({
      ...fixture.intent,
      automationAuthority: {
        automationId: 'automation_other_challenge',
        expectedUpdatedAt:
          fixture.intent.automationAuthority?.expectedUpdatedAt,
      },
    })

    await expect(reconcileAssistantCronDeliveryIntent({
      intent: mismatchedIntent,
      paths: fixture.paths,
      vault: fixture.vault,
    })).rejects.toMatchObject({
      code: 'scheduled_challenge_delivery_commit_invalid',
    })
    expect(commitMocks.commitSentDelivery).not.toHaveBeenCalled()
    const pending = await readAssistantCronCanonicalRuntimeStore(fixture.paths)
    expect(pending.jobs[0]?.state.pendingDeliveryIntentId).toBe(
      fixture.intent.intentId,
    )
    expect(pending.jobs[0]?.state.pendingOccurrenceAt).toBe(OCCURRENCE_AT)
  })
})

async function createPendingChallengeFixture() {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'murph-challenge-reconcile-'))
  tempRoots.push(vault)
  await initializeVault({
    createdAt: '2026-07-18T00:00:00.000Z',
    vaultRoot: vault,
  })
  const automation = (await upsertAutomation({
    activeUntil: '2026-07-20T08:00:00.000Z',
    continuityPolicy: 'preserve',
    instructions: 'Run the exact bound Summer Steps challenge dispatch.',
    now: new Date('2026-07-18T12:00:00.000Z'),
    route: {
      channel: 'linq',
      deliverySource: null,
      deliveryTarget: null,
      identityId: null,
      participantId: null,
      threadId: 'group-thread',
      threadIsDirect: false,
    },
    schedule: { kind: 'dailyLocal', localTime: '08:00' },
    scheduledTask: {
      kind: 'group_challenge',
      knowledgeSlug: 'summer-steps',
      projectionScopeKey: 'steps-days.v0',
    },
    status: 'active',
    title: 'Summer Steps dispatch',
    vaultRoot: vault,
  })).record
  const paths = resolveAssistantStatePaths(vault)
  const source = (await listCanonicalAssistantCronRecords(vault, ['active']))[0]
  if (!source) {
    throw new Error('Expected canonical group challenge source.')
  }
  const runtime = resolveCanonicalRuntimeState(source, {
    jobs: [],
    version: 1,
  })
  const intent = buildSentIntent(automation)
  await writeAssistantCronCanonicalRuntimeStore(paths, {
    jobs: [{
      ...runtime,
      state: {
        ...runtime.state,
        pendingDeliveryIntentId: intent.intentId,
        pendingOccurrenceAt: OCCURRENCE_AT,
      },
    }],
    version: 1,
  })
  return {
    automationId: automation.automationId,
    intent,
    paths,
    vault,
  }
}

function buildSentIntent(
  automation: Awaited<ReturnType<typeof upsertAutomation>>['record'],
): AssistantOutboxIntent {
  return assistantOutboxIntentSchema.parse({
    actorId: null,
    attemptCount: 1,
    automationAuthority: {
      automationId: automation.automationId,
      expectedUpdatedAt: automation.updatedAt,
    },
    bindingDelivery: { kind: 'thread', target: 'group-thread' },
    channel: 'linq',
    createdAt: OCCURRENCE_AT,
    dedupeKey: 'dedupe-group-challenge-reconciliation',
    delivery: null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: 'group-challenge-reconciliation',
    deliveryTransportIdempotent: true,
    explicitTarget: null,
    groupChallengeDispatch: {
      occurrenceAt: OCCURRENCE_AT,
      preparedBody: 'Medium: text\nFrame: finish-line ruling',
      scheduledTask: {
        kind: 'group_challenge',
        knowledgeSlug: 'summer-steps',
        projectionScopeKey: 'steps-days.v0',
      },
    },
    identityId: null,
    intentId: 'outbox_group_challenge_reconciliation',
    lastAttemptAt: '2026-07-19T08:01:00.000Z',
    lastError: null,
    media: [],
    message: 'Summer Steps standings are in.',
    nextAttemptAt: null,
    replyToMessageId: null,
    schema: 'murph.assistant-outbox-intent.v1',
    sentAt: '2026-07-19T08:01:00.000Z',
    sessionId: 'asst_group_challenge_reconciliation',
    status: 'sent',
    subject: null,
    targetFingerprint: 'target-group-challenge-reconciliation',
    threadId: 'group-thread',
    threadIsDirect: false,
    turnId: 'turn_group_challenge_reconciliation',
    updatedAt: '2026-07-19T08:01:00.000Z',
  })
}
