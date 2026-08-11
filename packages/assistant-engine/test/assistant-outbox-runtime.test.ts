import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/outbound-channel.ts', () => ({
  deliverAssistantMessageOverBinding: vi.fn(),
}))

import type {
  AssistantCronJob,
  AssistantChannelDelivery,
  AssistantDeliveryError,
  AssistantOutboxIntent,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { buildAutomationSupportSeriesTag } from '@murphai/contracts'
import {
  createExperiment,
  initializeVault,
  patchAutomation,
  scaffoldAutomationPayload,
  showAutomation,
  updateExperiment,
  upsertAutomation,
} from '@murphai/core'
import { serializeHostedEmailThreadTarget } from '@murphai/runtime-state'
import { readMaterializedExportPackReceipt } from '@murphai/vault-usecases/export-packs'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import {
  renderAssistantResponseCardText,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import { resolveAssistantGeneratedImageDelivery } from '../src/assistant/response-media.ts'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  hasAssistantSeenFirstContact,
  resolveAssistantFirstContactStateDocIds,
} from '../src/assistant/first-contact.ts'
import { ASSISTANT_GENERATED_DELIVERY_DIRECTORY } from '../src/assistant/generated-delivery-files.ts'
import {
  completeAssistantOnboarding,
  reopenAssistantOnboarding,
  resolveAssistantOnboardingStatePath,
} from '../src/assistant/onboarding-state.ts'
import {
  MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
} from '../src/assistant/onboarding-goal-checkin-automation.ts'
import {
  MURPH_ONBOARDING_FOLLOWUP_AUTOMATION,
} from '../src/assistant/onboarding-followup-automation.ts'
import { applyMurphManagedAutomations } from '../src/assistant/managed-automations.ts'
import { readAssistantDiagnosticsSnapshot } from '../src/assistant/diagnostics.ts'
import {
  buildAssistantOutboxSummary,
  beginAssistantOutboxIntentMirrorDispatch,
  beginAssistantOutboxIntentMirrorPreparedDispatch,
  createAssistantOutboxIntent,
  dispatchAssistantOutboxIntent,
  drainAssistantOutboxLocal,
  deliverAssistantOutboxReaction,
  deliverAssistantOutboxMessage,
  listAssistantOutboxIntentsLocal,
  readAssistantOutboxIntentMirrorState,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { pruneAssistantTerminalOutboxIntents } from '../src/assistant/outbox/store.ts'
import {
  buildAssistantCronNotificationDedupeToken,
} from '../src/assistant/cron/notification-delivery.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import { computeAssistantCronNextRunAt } from '../src/assistant/cron/schedule.ts'
import { listAssistantCronJobs } from '../src/assistant-cron.ts'
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  createAssistantTurnReceipt,
  readAssistantTurnReceipt,
  resolveAssistantTurnReceiptPath,
  updateAssistantTurnReceipt,
} from '../src/assistant/turns.ts'
import {
  findAssistantAutoReplyDeliveryIntentIds,
} from '../src/assistant/automation/evidence.ts'
import {
  deliverAssistantProgressUpdate,
} from '../src/assistant/delivery-service.ts'
import {
  hashAssistantOutboxIdentity,
  hashAssistantOutboxLegacyMediaDedupeIdentity,
  resolveAssistantOutboxIntentPath,
} from '../src/assistant/outbox/intents.ts'
import type {
  AssistantChannelDependencies,
} from '../src/assistant/channels/types.ts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { LinqFetch } from '@murphai/operator-config/linq-runtime'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.ts'
import {
  deliverAssistantMessageOverBinding,
} from '../src/outbound-channel.ts'
import { sendLinqMessage } from '../src/assistant/channels/runtime.ts'
import { createTempVaultContext } from './test-helpers.ts'
import {
  onboardingFollowupPredecessorDefinitions,
} from './onboarding-followup-predecessor-fixtures.ts'

const mockedDeliverAssistantMessageOverBinding = vi.mocked(
  deliverAssistantMessageOverBinding,
)

const TEST_LINQ_DELIVERY_SOURCE: NonNullable<
  AssistantOutboxIntent['deliverySource']
> = {
  kind: 'linq',
  fromPhoneNumber: '+15550000',
}

const NUTRITION_RESPONSE_CARD: AssistantResponseCard = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_100, status: 'under_target' },
    proteinGrams: { target: 100, status: 'on_target' },
    carbsGrams: { target: 220, status: 'on_target' },
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}

const CHALLENGE_STANDINGS_RESPONSE_CARD: AssistantResponseCard = {
  kind: 'challenge_standings',
  version: 1,
  format: 'individual',
  title: 'Weird Health Week',
  subtitle: 'Day 4 of 7',
  objective: { kind: 'ranking' },
  entries: [{
    label: 'Maya',
    points: 120,
    coverage: 'complete',
    detail: null,
  }],
  footer: null,
}

const WORKOUT_RESPONSE_CARD: AssistantResponseCard = {
  kind: 'compact_table',
  version: 1,
  title: 'Push day',
  subtitle: null,
  footer: null,
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: [{
      name: 'Bench press',
      sets: [
        {
          status: 'completed',
          target: '185 lb × 8',
          actual: '185 lb × 8',
        },
        {
          status: 'pending',
          target: '185 lb × 6–8',
          actual: null,
        },
      ],
    }],
  },
}

const tempRoots: string[] = []
let intentSequence = 0

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  mockedDeliverAssistantMessageOverBinding.mockReset()
  intentSequence = 0
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant outbox runtime', () => {
  it('retires claimed export packs only after confirmed delivery', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-export-pack-retirement-',
    )
    const manifestPath = (packId: string) =>
      path.join(vaultRoot, `exports/packs/${packId}/manifest.json`)
    const sentManifestPath = manifestPath('sent-pack')
    const failedManifestPath = manifestPath('failed-pack')
    const changedManifestPath = manifestPath('changed-pack')
    const missingManifestPath = manifestPath('missing-pack')
    await Promise.all(
      ['sent-pack', 'failed-pack', 'changed-pack', 'missing-pack'].map(
        async (packId) => {
          const target = manifestPath(packId)
          await mkdir(path.dirname(target), { recursive: true })
          await writeFile(target, JSON.stringify({ packId }))
        },
      ),
    )

    const [sentReceipt, failedReceipt, changedReceipt, missingReceipt] =
      await Promise.all([
        readMaterializedExportPackReceipt(vaultRoot, 'sent-pack'),
        readMaterializedExportPackReceipt(vaultRoot, 'failed-pack'),
        readMaterializedExportPackReceipt(vaultRoot, 'changed-pack'),
        readMaterializedExportPackReceipt(vaultRoot, 'missing-pack'),
      ])
    await writeFile(
      changedManifestPath,
      JSON.stringify({ generation: 2, packId: 'changed-pack' }),
    )
    await rm(path.dirname(missingManifestPath), { force: true, recursive: true })

    const media = (...receipts: (typeof sentReceipt)[]) => [{
      approvalGeneration: null,
      approvalId: null,
      contentType: 'application/zip',
      filename: 'vault.zip',
      kind: 'vault_file' as const,
      ref: `${ASSISTANT_GENERATED_DELIVERY_DIRECTORY}/vault.zip`,
      retireExportPacks: receipts,
      sha256: 'a'.repeat(64),
      sizeBytes: 42,
    }]
    const sentIntent = await createIntent(vaultRoot, {
      channel: 'linq',
      media: media(sentReceipt, changedReceipt, missingReceipt),
      message: 'vault.zip',
    })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({ channel: 'linq' }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })

    const sent = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: sentIntent.intentId,
      vault: vaultRoot,
    })
    expect(sent.intent.status).toBe('sent')
    await expect(
      readAssistantOutboxIntent(vaultRoot, sentIntent.intentId),
    ).resolves.toMatchObject({ status: 'sent' })
    await expect(readFile(sentManifestPath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(changedManifestPath, 'utf8')).resolves.toContain(
      '"generation":2',
    )

    const failedIntent = await createIntent(vaultRoot, {
      channel: 'linq',
      media: media(failedReceipt),
      message: 'vault.zip',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('channel rejected the file'), {
        code: 'CHANNEL_REJECTED',
        context: { retryable: false },
      }),
    )
    const failed = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: failedIntent.intentId,
      vault: vaultRoot,
    })
    expect(failed.intent.status).toBe('failed')
    await expect(readFile(failedManifestPath, 'utf8')).resolves.toContain(
      'failed-pack',
    )
  })

  it('dedupes non-terminal intents, allows retries after permanent failure, and rejects blank messages', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-dedupe-')

    const first = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-token',
      message: '  hello from outbox  ',
      sessionId: 'session-dedupe',
      turnId: 'turn-dedupe',
    })
    expect(first.message).toBe('hello from outbox')

    const deduped = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-token',
      message: 'hello from outbox',
      sessionId: 'session-dedupe',
      turnId: 'turn-dedupe',
    })
    expect(deduped.intentId).toBe(first.intentId)
    expect(deduped.createdAt).toBe(first.createdAt)

    await saveAssistantOutboxIntent(vaultRoot, {
      ...first,
      lastError: {
        code: 'CHANNEL_REQUIRED',
        message: 'channel required',
      },
      nextAttemptAt: null,
      status: 'failed',
      updatedAt: '2026-04-08T00:02:00.000Z',
    })

    const recreated = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:03:00.000Z',
      dedupeToken: 'stable-token',
      message: 'hello from outbox',
      sessionId: 'session-dedupe',
      turnId: 'turn-dedupe',
    })
    expect(recreated.intentId).not.toBe(first.intentId)

    await expect(readAssistantOutboxIntent(vaultRoot, 'missing-intent')).resolves.toBeNull()

    await expect(
      createIntent(vaultRoot, {
        message: '   ',
        sessionId: 'session-blank',
        turnId: 'turn-blank',
      }),
    ).rejects.toThrow('Assistant outbox messages must include text or response media.')
  })

  it('persists native reply intent explicitly while omitting it from legacy messages', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-native-reply-state-')
    const legacy = await createIntent(vaultRoot, {
      channel: 'linq',
      message: 'legacy contextual message',
      replyToMessageId: 'linq-context-message',
      sessionId: 'session-native-reply-legacy',
      turnId: 'turn-native-reply-legacy',
    })
    const marked = await createIntent(vaultRoot, {
      channel: 'linq',
      message: 'selected native reply',
      nativeReplyRequested: true,
      replyToMessageId: 'linq-selected-message',
      sessionId: 'session-native-reply-marked',
      turnId: 'turn-native-reply-marked',
    })

    expect(legacy.nativeReplyRequested).toBeUndefined()
    expect(marked.nativeReplyRequested).toBe(true)
    await expect(readRawOutboxIntent(vaultRoot, legacy.intentId)).resolves.not
      .toHaveProperty('nativeReplyRequested')
    await expect(readRawOutboxIntent(vaultRoot, marked.intentId)).resolves
      .toMatchObject({
        nativeReplyRequested: true,
        replyToMessageId: 'linq-selected-message',
      })

    const retryable = await saveAssistantOutboxIntent(vaultRoot, {
      ...marked,
      lastError: {
        code: 'ASSISTANT_DELIVERY_RETRYABLE',
        message: 'retry later',
      },
      nextAttemptAt: '2026-04-12T01:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-12T00:30:00.000Z',
    })
    expect(retryable.nativeReplyRequested).toBe(true)
    await expect(readAssistantOutboxIntent(vaultRoot, marked.intentId)).resolves
      .toMatchObject({
        nativeReplyRequested: true,
        replyToMessageId: 'linq-selected-message',
        status: 'retryable',
      })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        providerMessageId: 'linq-native-reply-delivered',
        target: 'thread-1',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })
    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: marked.intentId,
      vault: vaultRoot,
    })
    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding.mock.calls[0]?.[0])
      .toMatchObject({
        nativeReplyRequested: true,
        replyToMessageId: 'linq-selected-message',
      })

    for (const channel of ['linq', 'telegram'] as const) {
      for (const replyToMessageId of [
        'ain_private-ref',
        'hid_private-ref',
        'hbid:private-ref',
        'hbidx:private-ref',
        'linq:ain_private-ref',
        'linq:hid_private-ref',
        'provider:hbid:private-ref',
        'provider:hbidx:private-ref',
        'h1_0123456789abcdef01234567',
        '[REDACTED message]',
      ]) {
        await expect(createAssistantOutboxIntent({
          channel,
          message: 'invalid native reply target',
          nativeReplyRequested: true,
          replyToMessageId,
          sessionId: `session-native-reply-invalid-${channel}`,
          turnId: `turn-native-reply-invalid-${channel}`,
          vault: vaultRoot,
        })).rejects.toMatchObject({
          code: 'ASSISTANT_NATIVE_REPLY_TARGET_INVALID',
        })
      }
    }
  })

  it('fails closed before mutating a same-token message target or native reply marker', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-native-reply-dedupe-')
    const first = await createAssistantOutboxIntent({
      channel: 'linq',
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-native-reply-token',
      message: 'selected reply',
      nativeReplyRequested: true,
      replyToMessageId: 'linq-message-a',
      sessionId: 'session-native-reply-dedupe',
      threadId: 'linq-thread-native-reply',
      threadIsDirect: true,
      turnId: 'turn-native-reply-dedupe',
      vault: vaultRoot,
    })
    const exactRetry = await createAssistantOutboxIntent({
      channel: 'linq',
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-native-reply-token',
      message: 'selected reply',
      nativeReplyRequested: true,
      replyToMessageId: 'linq-message-a',
      sessionId: 'session-native-reply-dedupe',
      threadId: 'linq-thread-native-reply',
      threadIsDirect: true,
      turnId: 'turn-native-reply-dedupe',
      vault: vaultRoot,
    })
    expect(exactRetry.intentId).toBe(first.intentId)

    await expect(createAssistantOutboxIntent({
      channel: 'linq',
      createdAt: '2026-04-08T00:02:00.000Z',
      dedupeToken: 'stable-native-reply-token',
      message: 'selected reply',
      replyToMessageId: 'linq-message-a',
      sessionId: 'session-native-reply-dedupe',
      threadId: 'linq-thread-native-reply',
      threadIsDirect: true,
      turnId: 'turn-native-reply-dedupe',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    })
    await expect(createAssistantOutboxIntent({
      channel: 'linq',
      createdAt: '2026-04-08T00:03:00.000Z',
      dedupeToken: 'stable-native-reply-token',
      message: 'selected reply',
      nativeReplyRequested: true,
      replyToMessageId: 'linq-message-b',
      sessionId: 'session-native-reply-dedupe',
      threadId: 'linq-thread-native-reply',
      threadIsDirect: true,
      turnId: 'turn-native-reply-dedupe',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    })
    await expect(deliverAssistantOutboxReaction({
      channel: 'linq',
      dedupeToken: 'stable-native-reply-token',
      dispatchMode: 'queue-only',
      explicitTarget: 'linq-thread-native-reply',
      reaction: 'thumbs_up',
      sessionId: 'session-native-reply-dedupe',
      targetMessageId: 'linq-message-a',
      turnId: 'turn-native-reply-dedupe',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    })

    await expect(readAssistantOutboxIntent(vaultRoot, first.intentId)).resolves
      .toMatchObject({
        nativeReplyRequested: true,
        replyToMessageId: 'linq-message-a',
        updatedAt: '2026-04-08T00:00:00.000Z',
      })
  })

  it('fails closed when delivery-idempotency fallback finds a different marked effect', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-native-reply-idempotency-fallback-',
    )
    const legacy = await createAssistantOutboxIntent({
      channel: 'linq',
      dedupeToken: null,
      deliveryIdempotencyKey: 'hosted-native-reply-fallback',
      message: 'legacy contextual message',
      replyToMessageId: 'linq-message-fallback',
      sessionId: 'session-native-reply-fallback',
      threadId: 'linq-thread-fallback',
      threadIsDirect: true,
      turnId: 'turn-native-reply-fallback',
      vault: vaultRoot,
    })

    await expect(createAssistantOutboxIntent({
      channel: 'linq',
      dedupeToken: 'hosted-native-reply-fallback',
      deliveryIdempotencyKey: 'hosted-native-reply-fallback',
      message: 'legacy contextual message',
      nativeReplyRequested: true,
      replyToMessageId: 'linq-message-fallback',
      sessionId: 'session-native-reply-fallback',
      threadId: 'linq-thread-fallback',
      threadIsDirect: true,
      turnId: 'turn-native-reply-fallback',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    })
    await expect(deliverAssistantOutboxReaction({
      channel: 'linq',
      dedupeToken: 'hosted-native-reply-fallback',
      deliveryIdempotencyKey: 'hosted-native-reply-fallback',
      dispatchMode: 'queue-only',
      explicitTarget: 'linq-thread-fallback',
      reaction: 'thumbs_up',
      sessionId: 'session-native-reply-fallback',
      targetMessageId: 'linq-message-fallback',
      turnId: 'turn-native-reply-fallback',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    })
    await expect(readAssistantOutboxIntent(vaultRoot, legacy.intentId)).resolves
      .toMatchObject({
        operation: null,
        replyToMessageId: 'linq-message-fallback',
      })
  })

  it('persists answered mailbox item ids and defaults other sends to none', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-answered-mailbox-')
    const groupedMailboxItemIds = Array.from(
      { length: 45 },
      (_, index) => `mailbox_item_grouped_${index}`,
    )

    const replyIntent = await createIntent(vaultRoot, {
      answeredMailboxItemIds: [
        'mailbox_item_answered_1',
        'mailbox_item_answered_1',
        ' mailbox_item_answered_2 ',
      ],
      message: 'auto reply with answered mailbox ids',
      sessionId: 'session-answered-mailbox',
      turnId: 'turn-answered-mailbox',
    })
    const reminderIntent = await createIntent(vaultRoot, {
      message: 'scheduled reminder without answered mailbox ids',
      sessionId: 'session-reminder-no-answered-mailbox',
      turnId: 'turn-reminder-no-answered-mailbox',
    })
    const reviewedCompletionIntent = await createIntent(vaultRoot, {
      answeredMailboxItemIds: ['aask_done_outbox_proof'],
      message: 'reviewed completion answer',
      reviewedAssistantAskCompletionExpiresAt: '2026-04-08T00:15:00.000Z',
      sessionId: 'session-reviewed-completion-proof',
      turnId: 'turn-reviewed-completion-proof',
    })
    const groupedAutoReply = await deliverAssistantOutboxMessage({
      answeredMailboxItemIds: groupedMailboxItemIds,
      channel: 'linq',
      dispatchMode: 'queue-only',
      message: 'grouped auto-reply with more than forty answered items',
      sessionId: 'session-grouped-auto-reply',
      threadId: 'linq-thread-grouped',
      threadIsDirect: true,
      turnId: 'turn-grouped-auto-reply',
      turnTrigger: 'automation-auto-reply',
      vault: vaultRoot,
    })

    await expect(readAssistantOutboxIntent(vaultRoot, replyIntent.intentId))
      .resolves.toMatchObject({
        answeredMailboxItemIds: [
          'mailbox_item_answered_1',
          'mailbox_item_answered_2',
        ],
      })
    await expect(readAssistantOutboxIntent(vaultRoot, reminderIntent.intentId))
      .resolves.toMatchObject({
        answeredMailboxItemIds: [],
      })
    await expect(
      readAssistantOutboxIntent(vaultRoot, reviewedCompletionIntent.intentId),
    ).resolves.toMatchObject({
      answeredMailboxItemIds: ['aask_done_outbox_proof'],
      reviewedAssistantAskCompletionExpiresAt: '2026-04-08T00:15:00.000Z',
    })
    expect(groupedAutoReply.kind).toBe('queued')
    expect(groupedAutoReply.intent.answeredMailboxItemIds).toEqual(
      groupedMailboxItemIds,
    )
    await expect(
      createIntent(vaultRoot, {
        answeredMailboxItemIds: Array.from(
          { length: 101 },
          (_, index) => `mailbox_item_too_many_${index}`,
        ),
        message: 'this should fail before truncating answered mailbox ids',
        sessionId: 'session-too-many-answered-mailbox',
        turnId: 'turn-too-many-answered-mailbox',
      }),
    ).rejects.toThrow('answered mailbox item ids exceed the 100 item limit')
  })

  it('persists new group email proof only under the generic outbox field', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-group-email-proof-rollback-',
    )
    const groupEmailAuthorizationProof = 'a'.repeat(64)
    const parentTarget = serializeHostedEmailThreadTarget({
      groupId: 'group_123',
      subject: 'Group subject',
      targetKind: 'group',
    })
    const targets = [
      parentTarget,
      serializeHostedEmailThreadTarget({
        groupId: 'group_123',
        recipientMemberId: 'member_123',
        subject: 'Group subject',
        targetKind: 'group',
      }),
    ]

    for (const [index, explicitTarget] of targets.entries()) {
      const intent = await createAssistantOutboxIntent({
        channel: 'email',
        deliveryIdempotencyKey: `group-email-effect:proof:${index}`,
        explicitTarget,
        groupEmailAuthorizationProof,
        message: 'Group email body',
        sessionId: `session_group_email_${index}`,
        threadIsDirect: false,
        turnId: `turn_group_email_${index}`,
        vault: vaultRoot,
      })
      const paths = resolveAssistantStatePaths(vaultRoot)
      const persisted = JSON.parse(await readFile(
        resolveAssistantOutboxIntentPath(paths.outboxDirectory, intent.intentId),
        'utf8',
      )) as Record<string, unknown>

      expect(Object.keys(persisted).filter((key) =>
        key.endsWith('AuthorizationProof')
      )).toEqual(['groupEmailAuthorizationProof'])
      expect(persisted.groupEmailAuthorizationProof).toBe(
        groupEmailAuthorizationProof,
      )
      await expect(readAssistantOutboxIntent(vaultRoot, intent.intentId))
        .resolves.toMatchObject({
          groupEmailAuthorizationProof,
        })
    }
  })

  it('monotonically widens answered mailbox ids when a grouped reply is rebatched', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-grouped-answered-upgrade-',
    )
    const deliveryInput = {
      channel: 'linq',
      dedupeToken: 'grouped-reply-effect-anchor',
      deliveryIdempotencyKey: 'grouped-reply-effect-anchor',
      dispatchMode: 'queue-only' as const,
      message: 'one reply for the grouped burst',
      sessionId: 'session-grouped-answered-upgrade',
      threadId: 'linq-thread-grouped-answered-upgrade',
      threadIsDirect: false,
      turnId: 'turn-grouped-answered-upgrade',
      turnTrigger: 'automation-auto-reply' as const,
      vault: vaultRoot,
    }

    const first = await deliverAssistantOutboxMessage({
      ...deliveryInput,
      answeredMailboxItemIds: ['mailbox_item_newest'],
    })
    const upgraded = await deliverAssistantOutboxMessage({
      ...deliveryInput,
      answeredMailboxItemIds: [
        'mailbox_item_older',
        'mailbox_item_newest',
      ],
      turnId: 'turn-grouped-answered-rebatch',
    })
    const preserved = await deliverAssistantOutboxMessage({
      ...deliveryInput,
      answeredMailboxItemIds: ['mailbox_item_newest'],
      turnId: 'turn-grouped-answered-replay',
    })

    expect(first.kind).toBe('queued')
    expect(upgraded.kind).toBe('queued')
    expect(upgraded.intent.intentId).toBe(first.intent.intentId)
    expect(preserved.intent.intentId).toBe(first.intent.intentId)
    expect(preserved.intent.answeredMailboxItemIds).toEqual([
      'mailbox_item_newest',
      'mailbox_item_older',
    ])
    await expect(readAssistantOutboxIntent(vaultRoot, first.intent.intentId))
      .resolves.toMatchObject({
        answeredMailboxItemIds: [
          'mailbox_item_newest',
          'mailbox_item_older',
        ],
      })

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: upgraded.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-grouped-answered-upgrade',
        providerThreadId: 'linq-thread-grouped-answered-upgrade',
        sentAt: '2026-04-08T03:02:00.000Z',
        target: 'linq-thread-grouped-answered-upgrade',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      intentId: preserved.intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenLastCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds: [
          'mailbox_item_newest',
          'mailbox_item_older',
        ],
      }),
      undefined,
    )

    const terminalReplay = await deliverAssistantOutboxMessage({
      ...deliveryInput,
      answeredMailboxItemIds: [
        'mailbox_item_newest',
        'mailbox_item_older',
        'mailbox_item_after_send',
      ],
      turnId: 'turn-grouped-answered-terminal-replay',
    })

    expect(terminalReplay.kind).toBe('failed')
    expect(terminalReplay.deliveryError).toMatchObject({
      code: 'ASSISTANT_OUTBOX_ANSWERED_ITEMS_UNCOVERED',
      diagnosticContext: {
        retryable: true,
      },
    })
    expect(terminalReplay.intent.intentId).toBe(first.intent.intentId)
    expect(terminalReplay.intent.answeredMailboxItemIds).toEqual([
      'mailbox_item_newest',
      'mailbox_item_older',
    ])
    await expect(readAssistantOutboxIntent(vaultRoot, first.intent.intentId))
      .resolves.toMatchObject({
        answeredMailboxItemIds: [
          'mailbox_item_newest',
          'mailbox_item_older',
        ],
        status: 'sent',
      })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('freezes grouped answered mailbox ids when provider dispatch starts', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-grouped-answered-dispatch-fence-',
    )
    const deliveryInput = {
      answeredMailboxItemIds: ['mailbox_item_before_dispatch'],
      channel: 'linq',
      dedupeToken: 'grouped-reply-dispatch-fence',
      deliveryIdempotencyKey: 'grouped-reply-dispatch-fence',
      dispatchMode: 'queue-only' as const,
      message: 'one reply for the frozen grouped burst',
      sessionId: 'session-grouped-dispatch-fence',
      threadId: 'linq-thread-grouped-dispatch-fence',
      threadIsDirect: false,
      turnId: 'turn-grouped-dispatch-fence',
      turnTrigger: 'automation-auto-reply' as const,
      vault: vaultRoot,
    }
    const queued = await deliverAssistantOutboxMessage(deliveryInput)

    let markProviderEntered: (() => void) | undefined
    const providerEntered = new Promise<void>((resolve) => {
      markProviderEntered = resolve
    })
    let releaseProvider: (() => void) | undefined
    const providerReleased = new Promise<void>((resolve) => {
      releaseProvider = resolve
    })
    mockedDeliverAssistantMessageOverBinding.mockImplementationOnce(
      async () => {
        markProviderEntered?.()
        await providerReleased
        return {
          delivery: createDelivery({
            channel: 'linq',
            idempotencyKey: queued.intent.deliveryIdempotencyKey,
            providerMessageId: 'provider-grouped-dispatch-fence',
            providerThreadId: deliveryInput.threadId,
            sentAt: '2026-04-08T03:03:00.000Z',
            target: deliveryInput.threadId,
            targetKind: 'thread',
          }),
          deliveryDeduplicated: false,
          deliveryTransportIdempotent: true,
          outboxIntentId: null,
          session: undefined,
        }
      },
    )

    const dispatch = dispatchAssistantOutboxIntent({
      intentId: queued.intent.intentId,
      vault: vaultRoot,
    })
    await providerEntered

    const lateRebatch = await deliverAssistantOutboxMessage({
      ...deliveryInput,
      answeredMailboxItemIds: [
        'mailbox_item_before_dispatch',
        'mailbox_item_after_dispatch',
      ],
      turnId: 'turn-grouped-dispatch-fence-late',
    })
    releaseProvider?.()
    const dispatched = await dispatch

    expect(lateRebatch.kind).toBe('failed')
    expect(lateRebatch.deliveryError).toMatchObject({
      code: 'ASSISTANT_OUTBOX_ANSWERED_ITEMS_UNCOVERED',
      diagnosticContext: {
        retryable: true,
      },
    })
    expect(lateRebatch.intent.status).toBe('sending')
    expect(lateRebatch.intent.answeredMailboxItemIds).toEqual([
      'mailbox_item_before_dispatch',
    ])
    expect(dispatched.intent.status).toBe('sent')
    expect(dispatched.intent.answeredMailboxItemIds).toEqual([
      'mailbox_item_before_dispatch',
    ])
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds: ['mailbox_item_before_dispatch'],
      }),
      undefined,
    )
    await expect(readAssistantOutboxIntent(vaultRoot, queued.intent.intentId))
      .resolves.toMatchObject({
        answeredMailboxItemIds: ['mailbox_item_before_dispatch'],
        status: 'sent',
      })
  })

  it('persists auto-reply intent provenance when receipt repair has no receipt', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-auto-reply-provenance-')

    const intent = await createAssistantOutboxIntent({
      actorId: 'telegram-user-1',
      channel: 'telegram',
      message: 'auto reply',
      sessionId: 'session_auto_reply_provenance',
      threadId: 'telegram-thread-1',
      threadIsDirect: true,
      turnId: 'turn_auto_reply_provenance',
      turnTrigger: 'automation-auto-reply',
      vault: vaultRoot,
    })

    await rm(
      resolveAssistantTurnReceiptPath(
        resolveAssistantStatePaths(vaultRoot),
        intent.turnId,
      ),
      { force: true },
    )
    expect(await readAssistantTurnReceipt(vaultRoot, intent.turnId)).toBeNull()

    await expect(
      findAssistantAutoReplyDeliveryIntentIds({
        intents: [
          {
            intentId: intent.intentId,
            turnId: intent.turnId,
          },
        ],
        vault: vaultRoot,
      }),
    ).resolves.toEqual(new Set([intent.intentId]))
  })

  it('persists auto-reply provenance when a malformed-receipt retry dedupes to an existing intent', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-auto-reply-dedupe-provenance-')

    const legacyIntent = await createAssistantOutboxIntent({
      actorId: 'telegram-user-1',
      channel: 'telegram',
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-auto-reply-token',
      message: 'auto reply',
      sessionId: 'session_auto_reply_dedupe_provenance',
      threadId: 'telegram-thread-1',
      threadIsDirect: true,
      turnId: 'turn_auto_reply_dedupe_provenance',
      vault: vaultRoot,
    })

    await writeFile(
      resolveAssistantTurnReceiptPath(
        resolveAssistantStatePaths(vaultRoot),
        legacyIntent.turnId,
      ),
      '{not-json',
      'utf8',
    )

    const dedupedIntent = await createAssistantOutboxIntent({
      actorId: 'telegram-user-1',
      channel: 'telegram',
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-auto-reply-token',
      message: 'auto reply',
      sessionId: 'session_auto_reply_dedupe_provenance',
      threadId: 'telegram-thread-1',
      threadIsDirect: true,
      turnId: 'turn_auto_reply_dedupe_provenance',
      turnTrigger: 'automation-auto-reply',
      vault: vaultRoot,
    })

    expect(dedupedIntent.intentId).toBe(legacyIntent.intentId)
    expect(await readAssistantTurnReceipt(vaultRoot, legacyIntent.turnId)).toBeNull()
    await expect(
      findAssistantAutoReplyDeliveryIntentIds({
        intents: [
          {
            intentId: legacyIntent.intentId,
            turnId: legacyIntent.turnId,
          },
        ],
        vault: vaultRoot,
      }),
    ).resolves.toEqual(new Set([legacyIntent.intentId]))
  })

  it('repairs a targetless unmarked queued dedupe hit before the first dispatch attempt', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-target-repair-')

    const stale = await createAssistantOutboxIntent({
      channel: 'linq',
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-target-repair-token',
      message: 'queued reminder',
      sessionId: 'session-target-repair',
      threadId: null,
      threadIsDirect: null,
      turnId: 'turn-target-repair',
      vault: vaultRoot,
    })
    expect(stale.bindingDelivery).toBeNull()

    const repaired = await createAssistantOutboxIntent({
      channel: 'linq',
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-target-repair-token',
      media: [
        {
          alt: null,
          kind: 'image',
          source: null,
          url: 'https://cdn.example.test/reminder/retry.png',
        },
      ],
      message: 'rewritten retry reminder',
      replyToMessageId: 'linq-message-target-repair',
      sessionId: 'session-target-repair',
      threadId: 'linq-thread-target-repair',
      threadIsDirect: true,
      turnId: 'turn-target-repair',
      vault: vaultRoot,
    })

    expect(repaired.intentId).toBe(stale.intentId)
    expect(repaired.bindingDelivery).toEqual({
      kind: 'thread',
      target: 'linq-thread-target-repair',
    })
    expect(repaired.threadId).toBe('linq-thread-target-repair')
    expect(repaired.threadIsDirect).toBe(true)
    expect(repaired.media).toEqual([])
    expect(repaired.message).toBe('queued reminder')
    expect(repaired.replyToMessageId).toBe('linq-message-target-repair')
    expect(repaired.targetFingerprint).not.toBe(stale.targetFingerprint)
    expect(repaired.updatedAt).toBe('2026-04-08T00:01:00.000Z')
  })

  it('keeps the original email subject when repairing a targetless queued dedupe hit', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-subject-repair-')

    const stale = await createAssistantOutboxIntent({
      channel: 'email',
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-subject-repair-token',
      message: 'queued email reminder',
      sessionId: 'session-subject-repair',
      subject: 'Original subject',
      turnId: 'turn-subject-repair',
      vault: vaultRoot,
    })
    expect(stale.bindingDelivery).toBeNull()
    expect(stale.explicitTarget).toBeNull()

    const repaired = await createAssistantOutboxIntent({
      channel: 'email',
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-subject-repair-token',
      explicitTarget: 'recipient@example.test',
      message: 'rewritten retry email reminder',
      sessionId: 'session-subject-repair',
      subject: 'Retry subject',
      turnId: 'turn-subject-repair',
      vault: vaultRoot,
    })

    expect(repaired.intentId).toBe(stale.intentId)
    expect(repaired.explicitTarget).toBe('recipient@example.test')
    expect(repaired.message).toBe('queued email reminder')
    expect(repaired.subject).toBe('Original subject')
    expect(repaired.targetFingerprint).not.toBe(stale.targetFingerprint)
    expect(repaired.updatedAt).toBe('2026-04-08T00:01:00.000Z')
  })

  it('leaves attempted targetless dedupe hits unchanged', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-target-repair-attempted-')

    const stale = await createAssistantOutboxIntent({
      channel: 'telegram',
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-attempted-target-repair-token',
      message: 'queued reminder',
      sessionId: 'session-attempted-target-repair',
      threadId: null,
      threadIsDirect: null,
      turnId: 'turn-attempted-target-repair',
      vault: vaultRoot,
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...stale,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T00:00:30.000Z',
      updatedAt: '2026-04-08T00:00:30.000Z',
    })

    const unchanged = await createAssistantOutboxIntent({
      channel: 'telegram',
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-attempted-target-repair-token',
      message: 'queued reminder',
      sessionId: 'session-attempted-target-repair',
      threadId: 'telegram-thread-target-repair',
      threadIsDirect: true,
      turnId: 'turn-attempted-target-repair',
      vault: vaultRoot,
    })

    expect(unchanged.intentId).toBe(stale.intentId)
    expect(unchanged.bindingDelivery).toBeNull()
    expect(unchanged.threadId).toBeNull()
    expect(unchanged.targetFingerprint).toBe(stale.targetFingerprint)
    expect(unchanged.attemptCount).toBe(1)
    expect(unchanged.updatedAt).toBe('2026-04-08T00:00:30.000Z')
  })

  it('repairs missing receipt linkage when an outbox create retry hits an existing intent', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-dedupe-repair-')
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'queue this message',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-dedupe-repair',
      turnId: 'turn-dedupe-repair',
      vault: vaultRoot,
    })

    const first = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'stable-repair-token',
      message: 'hello from outbox',
      sessionId: 'session-dedupe-repair',
      turnId: 'turn-dedupe-repair',
    })
    await updateAssistantTurnReceipt({
      vault: vaultRoot,
      turnId: 'turn-dedupe-repair',
      mutate(receipt) {
        return {
          ...receipt,
          completedAt: '2026-04-08T00:05:00.000Z',
          deliveryDisposition: 'not-requested',
          deliveryIntentId: null,
          status: 'completed',
          timeline: receipt.timeline.filter((event) => event.kind !== 'delivery.queued'),
          updatedAt: '2026-04-08T00:05:00.000Z',
        }
      },
    })

    const deduped = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-repair-token',
      message: 'hello from outbox',
      sessionId: 'session-dedupe-repair',
      turnId: 'turn-dedupe-repair',
    })

    expect(deduped.intentId).toBe(first.intentId)
    const receipt = await readAssistantTurnReceipt(vaultRoot, 'turn-dedupe-repair')
    expect(receipt?.deliveryDisposition).toBe('queued')
    expect(receipt?.deliveryIntentId).toBe(first.intentId)
    expect(receipt?.updatedAt).toBe('2026-04-08T00:05:00.000Z')
    expect(receipt?.completedAt).toBe('2026-04-08T00:05:00.000Z')
    expect(
      receipt?.timeline.filter((event) => event.kind === 'delivery.queued'),
    ).toHaveLength(1)
  })

  it('persists and dispatches response cards through the existing outbox owner', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-card-')
    const rendered = renderAssistantResponseCardText(NUTRITION_RESPONSE_CARD)
    for (const target of [
      '2,100 calories (under target)',
      '100g protein (on target)',
      '220g carbs (on target)',
      '40g fat (on target)',
      '30g fiber (under target)',
    ]) {
      expect(rendered).toContain(target)
    }
    const intent = await createAssistantOutboxIntent({
      actorId: '+15550001',
      card: NUTRITION_RESPONSE_CARD,
      channel: 'linq',
      dedupeToken: 'stable-response-card-token',
      message: 'model-authored text must not become the durable card message',
      sessionId: 'session-response-card',
      threadId: 'thread-response-card',
      threadIsDirect: true,
      turnId: 'turn-response-card',
      vault: vaultRoot,
    })

    expect(intent.card).toEqual(NUTRITION_RESPONSE_CARD)
    expect(intent.media).toEqual([])
    expect(intent.message).toBe(rendered)
    await expect(readRawOutboxIntent(vaultRoot, intent.intentId)).resolves
      .toMatchObject({
        card: NUTRITION_RESPONSE_CARD,
        media: [],
        message: rendered,
      })

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        providerMessageId: 'linq-response-card-delivered',
        target: 'thread-response-card',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        card: NUTRITION_RESPONSE_CARD,
        media: [],
        message: rendered,
      }),
      expect.objectContaining({
        persistLinqAppCardTextFallback: expect.any(Function),
      }),
    )

    await expect(createAssistantOutboxIntent({
      card: NUTRITION_RESPONSE_CARD,
      channel: 'linq',
      media: [{
        alt: null,
        kind: 'image',
        source: null,
        url: 'https://cdn.example.test/nutrition.png',
      }],
      message: rendered,
      sessionId: 'session-response-card-conflict',
      threadId: 'thread-response-card',
      threadIsDirect: true,
      turnId: 'turn-response-card-conflict',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
    })

    await expect(createAssistantOutboxIntent({
      card: NUTRITION_RESPONSE_CARD,
      channel: 'linq',
      message: rendered,
      sessionId: 'session-response-card-group-conflict',
      threadId: 'thread-response-card-group',
      threadIsDirect: false,
      turnId: 'turn-response-card-group-conflict',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_RESPONSE_CARD_DIRECT_AUDIENCE_REQUIRED',
    })
  })

  it('persists and dispatches challenge standings cards for Linq groups only', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-group-challenge-card-',
    )
    const rendered = renderAssistantResponseCardText(
      CHALLENGE_STANDINGS_RESPONSE_CARD,
    )
    const intent = await createAssistantOutboxIntent({
      card: CHALLENGE_STANDINGS_RESPONSE_CARD,
      channel: 'linq',
      dedupeToken: 'stable-group-challenge-card-token',
      message: 'model-authored text must not become the durable card message',
      sessionId: 'session-group-challenge-card',
      threadId: 'thread-group-challenge-card',
      threadIsDirect: false,
      turnId: 'turn-group-challenge-card',
      vault: vaultRoot,
    })

    expect(intent.card).toEqual(CHALLENGE_STANDINGS_RESPONSE_CARD)
    expect(intent.message).toBe(rendered)
    expect(intent.threadIsDirect).toBe(false)

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        providerMessageId: 'linq-group-challenge-card-delivered',
        target: 'thread-group-challenge-card',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        card: CHALLENGE_STANDINGS_RESPONSE_CARD,
        message: rendered,
        threadIsDirect: false,
      }),
      expect.any(Object),
    )

    await expect(createAssistantOutboxIntent({
      card: CHALLENGE_STANDINGS_RESPONSE_CARD,
      channel: 'linq',
      message: rendered,
      sessionId: 'session-direct-challenge-card',
      threadId: 'thread-direct-challenge-card',
      threadIsDirect: true,
      turnId: 'turn-direct-challenge-card',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_CHALLENGE_RESPONSE_CARD_GROUP_AUDIENCE_REQUIRED',
    })

    await expect(createAssistantOutboxIntent({
      card: CHALLENGE_STANDINGS_RESPONSE_CARD,
      channel: 'telegram',
      message: rendered,
      sessionId: 'session-telegram-group-challenge-card',
      threadId: 'thread-telegram-group-challenge-card',
      threadIsDirect: false,
      turnId: 'turn-telegram-group-challenge-card',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_CHALLENGE_RESPONSE_CARD_GROUP_AUDIENCE_REQUIRED',
    })
  })

  it('round-trips workout cards through local outbox save, list, and read owners', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-workout-card-',
    )
    const intent = await createAssistantOutboxIntent({
      actorId: '+15550001',
      card: WORKOUT_RESPONSE_CARD,
      channel: 'linq',
      dedupeToken: 'stable-workout-card-token',
      message: 'ignored model prose',
      sessionId: 'session-workout-card',
      threadId: 'thread-workout-card',
      threadIsDirect: true,
      turnId: 'turn-workout-card',
      vault: vaultRoot,
    })

    const retryable = await saveAssistantOutboxIntent(vaultRoot, {
      ...intent,
      lastError: {
        code: 'ASSISTANT_DELIVERY_RETRYABLE',
        message: 'retry later',
      },
      nextAttemptAt: '2026-08-09T20:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-08-09T19:46:00.000Z',
    })

    await expect(
      readAssistantOutboxIntent(vaultRoot, retryable.intentId),
    ).resolves.toMatchObject({
      card: WORKOUT_RESPONSE_CARD,
      status: 'retryable',
    })
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([
      expect.objectContaining({
        card: WORKOUT_RESPONSE_CARD,
        intentId: retryable.intentId,
        status: 'retryable',
      }),
    ])
  })

  it('persists one text-only fallback identity before acceptance and reuses it after restart', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-card-fallback-restart-',
    )
    const intent = await createAssistantOutboxIntent({
      actorId: '+15550001',
      card: NUTRITION_RESPONSE_CARD,
      channel: 'linq',
      dedupeToken: 'stable-card-fallback-restart',
      deliverySource: TEST_LINQ_DELIVERY_SOURCE,
      message: 'ignored model prose',
      sessionId: 'session-card-fallback-restart',
      threadId: 'thread-card-fallback-restart',
      threadIsDirect: true,
      turnId: 'turn-card-fallback-restart',
      vault: vaultRoot,
    })
    const originalIdempotencyKey = `assistant-outbox:${intent.intentId}`
    const fallbackIdempotencyKey = `${originalIdempotencyKey}:fallback`
    const processTerminated = new Error('simulated process termination')
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>()
    const providerRequests: Array<Record<string, unknown>> = []
    const fetchImplementation: LinqFetch = vi.fn(async (url, init) => {
      const body = typeof init.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : {}
      providerRequests.push(body)
      if (url.endsWith('/capability/check_imessage')) {
        return new Response(JSON.stringify({ available: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const message = body.message as {
        parts?: Array<{ type?: string }>
      } | undefined
      if (message?.parts?.[0]?.type === 'imessage_app') {
        return new Response(JSON.stringify({ error: 'unsupported app card' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 400,
        })
      }
      return new Response(JSON.stringify({
        message: { id: 'linq-card-fallback-text' },
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await useActualOutboundDeliveryImplementation()
    sendLinq.mockImplementationOnce(async (request) => {
      expect(request).toMatchObject({
        card: NUTRITION_RESPONSE_CARD,
        idempotencyKey: originalIdempotencyKey,
      })
      const delivered = await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation,
        ...(request.persistAppCardTextFallback
          ? {
              persistAppCardTextFallback:
                request.persistAppCardTextFallback,
            }
          : {}),
      })
      await expect(readAssistantOutboxIntent(vaultRoot, intent.intentId)).resolves
        .toMatchObject({
          card: null,
          deliveryIdempotencyKey: fallbackIdempotencyKey,
          status: 'sending',
        })
      expect(delivered.idempotencyKey).toBe(fallbackIdempotencyKey)
      throw processTerminated
    })

    await expect(dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      dispatchHooks: {
        shouldRethrowDispatchError: ({ error }) => error === processTerminated,
      },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-07-31T01:00:00.000Z'),
      vault: vaultRoot,
    })).rejects.toBe(processTerminated)

    const interrupted = await readAssistantOutboxIntent(vaultRoot, intent.intentId)
    expect(interrupted).toMatchObject({
      card: null,
      delivery: null,
      deliveryIdempotencyKey: fallbackIdempotencyKey,
      status: 'sending',
    })

    sendLinq.mockImplementationOnce(async (request) => {
      return await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation,
      })
    })
    const replayed = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-07-31T01:15:00.000Z'),
      vault: vaultRoot,
    })

    expect(sendLinq).toHaveBeenCalledTimes(2)
    expect(sendLinq.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: fallbackIdempotencyKey,
      message: renderAssistantResponseCardText(NUTRITION_RESPONSE_CARD),
    })
    expect(sendLinq.mock.calls[1]?.[0]).not.toHaveProperty('card')
    expect(providerRequests).toHaveLength(4)
    expect(providerRequests.slice(1).map((request) => (
      request.message as { idempotency_key?: string }
    ).idempotency_key)).toEqual([
      originalIdempotencyKey,
      fallbackIdempotencyKey,
      fallbackIdempotencyKey,
    ])
    expect(replayed.intent).toMatchObject({
      card: null,
      deliveryIdempotencyKey: fallbackIdempotencyKey,
      status: 'sent',
      delivery: {
        idempotencyKey: fallbackIdempotencyKey,
        providerMessageId: 'linq-card-fallback-text',
      },
    })
  })

  it('terminalizes an exhausted private Linq attachment upload without a new reservation', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-attachment-exhausted-',
    )
    const imageBytes = new Uint8Array([11, 12, 13, 14])
    const intent = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'linq_chat_attachment_exhausted',
      media: [{
        alt: 'Private generated image',
        contentType: 'image/png',
        filename: 'generated.png',
        kind: 'vault_image',
        ref: 'raw/captures/generated.png',
        sha256: 'a'.repeat(64),
        sizeBytes: imageBytes.byteLength,
        source: 'gpt-image-2',
      }],
      message: 'Private generated image',
      threadId: 'linq_chat_attachment_exhausted',
    })
    const providerFetch = vi.fn<LinqFetch>(async (url) => {
      if (!url.endsWith('/attachments')) {
        throw new Error(`Unexpected Linq provider request: ${url}`)
      }
      return new Response(JSON.stringify({
        attachment_id: 'attachment_exhausted',
        expires_at: '2026-08-06T21:00:00.000Z',
        http_method: 'PUT',
        required_headers: {
          'content-type': 'image/png',
        },
        upload_url: 'https://uploads.example.test/private/exhausted',
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const publicFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '0',
        },
        status: 503,
      }))
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async (request) => await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: providerFetch,
        loadVaultImage: async () => imageBytes,
        publicFetchImplementation: publicFetch,
      }),
    )

    await useActualOutboundDeliveryImplementation()
    const failed = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-08-06T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(failed.intent).toMatchObject({
      lastError: {
        code: 'LINQ_API_REQUEST_FAILED',
        diagnosticContext: expect.objectContaining({
          operation: 'create_attachment_upload',
          retryable: false,
        }),
      },
      nextAttemptAt: null,
      status: 'failed',
    })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(publicFetch).toHaveBeenCalledTimes(3)
    expect(sendLinq).toHaveBeenCalledTimes(1)

    const later = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      intentId: intent.intentId,
      now: new Date('2026-08-07T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(later.intent.status).toBe('failed')
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(publicFetch).toHaveBeenCalledTimes(3)
    expect(sendLinq).toHaveBeenCalledTimes(1)
  })

  it('abandons an ambiguous Linq attachment reservation without replaying it', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-attachment-reservation-ambiguous-',
    )
    const imageBytes = new Uint8Array([31, 32, 33, 34])
    const intent = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'linq_chat_attachment_ambiguous',
      media: [{
        alt: 'Private image with ambiguous reservation',
        contentType: 'image/png',
        filename: 'ambiguous.png',
        kind: 'vault_image',
        ref: 'raw/captures/ambiguous.png',
        sha256: 'c'.repeat(64),
        sizeBytes: imageBytes.byteLength,
        source: 'gpt-image-2',
      }],
      message: 'Private image with ambiguous reservation',
      threadId: 'linq_chat_attachment_ambiguous',
    })
    const providerFetch = vi.fn<LinqFetch>(async (url) => {
      if (!url.endsWith('/attachments')) {
        throw new Error(`Unexpected Linq provider request: ${url}`)
      }
      throw new TypeError('connection ended before the reservation response')
    })
    const publicFetch = vi.fn(async () => new Response(null, { status: 204 }))
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async (request) => await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: providerFetch,
        loadVaultImage: async () => imageBytes,
        publicFetchImplementation: publicFetch,
      }),
    )

    await useActualOutboundDeliveryImplementation()
    const abandoned = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-08-06T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(abandoned.intent).toMatchObject({
      lastError: {
        code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      },
      nextAttemptAt: null,
      status: 'abandoned',
    })
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(publicFetch).not.toHaveBeenCalled()
    expect(sendLinq).toHaveBeenCalledTimes(1)

    const later = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      intentId: intent.intentId,
      now: new Date('2026-08-07T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(later.intent.status).toBe('abandoned')
    expect(providerFetch).toHaveBeenCalledTimes(1)
    expect(publicFetch).not.toHaveBeenCalled()
    expect(sendLinq).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      context: { failureStage: 'transport', timedOut: true },
      label: 'timeout',
    },
    {
      context: { failureStage: 'http', status: 408 },
      label: 'HTTP 408',
    },
    {
      context: { failureStage: 'http', status: 503 },
      label: 'HTTP 503',
    },
  ])('abandons an ambiguous Linq attachment reservation after $label', async ({
    context,
    label,
  }) => {
    const { vaultRoot } = await createAssistantVault(
      `assistant-outbox-linq-attachment-reservation-${label.replaceAll(' ', '-')}-`,
    )
    const intent = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'linq_chat_attachment_reservation_ambiguous',
      message: 'Private image with ambiguous reservation',
      threadId: 'linq_chat_attachment_reservation_ambiguous',
    })
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async () => {
        throw new VaultCliError(
          'LINQ_API_REQUEST_FAILED',
          'Linq attachment reservation ended without definitive no-effect proof.',
          {
            ...context,
            method: 'POST',
            operation: 'create_attachment_upload',
            provider: 'linq',
            retryable: false,
          },
        )
      },
    )

    await useActualOutboundDeliveryImplementation()
    const abandoned = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-08-06T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(abandoned.intent).toMatchObject({
      lastError: {
        code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
      },
      nextAttemptAt: null,
      status: 'abandoned',
    })

    const later = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      intentId: intent.intentId,
      now: new Date('2026-08-07T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(later.intent.status).toBe('abandoned')
    expect(sendLinq).toHaveBeenCalledTimes(1)
  })

  it('recovers a private Linq attachment inside one outbox dispatch and sends once', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-attachment-recovered-',
    )
    const imageBytes = new Uint8Array([21, 22, 23, 24])
    const intent = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'linq_chat_attachment_recovered',
      media: [{
        alt: 'Recovered private image',
        contentType: 'image/webp',
        filename: 'recovered.webp',
        kind: 'vault_image',
        ref: 'raw/captures/recovered.webp',
        sha256: 'b'.repeat(64),
        sizeBytes: imageBytes.byteLength,
        source: 'gpt-image-2',
      }],
      message: 'Recovered private image',
      threadId: 'linq_chat_attachment_recovered',
    })
    const finalMessageBodies: Array<Record<string, unknown>> = []
    const providerFetch = vi.fn<LinqFetch>(async (url, init) => {
      if (url.endsWith('/attachments')) {
        return new Response(JSON.stringify({
          attachment_id: 'attachment_recovered',
          expires_at: '2026-08-06T21:00:00.000Z',
          http_method: 'PUT',
          required_headers: {
            'content-type': 'image/webp',
          },
          upload_url: 'https://uploads.example.test/private/recovered',
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/chats/linq_chat_attachment_recovered/messages')) {
        if (typeof init.body !== 'string') {
          throw new Error('Expected a serialized Linq message body.')
        }
        finalMessageBodies.push(JSON.parse(init.body) as Record<string, unknown>)
        return new Response(JSON.stringify({
          message: { id: 'linq_image_message_recovered' },
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`Unexpected Linq provider request: ${url}`)
    })
    let uploadAttempt = 0
    const publicFetch = vi.fn(async () => {
      uploadAttempt += 1
      if (uploadAttempt < 3) {
        return new Response(JSON.stringify({ error: 'temporarily unavailable' }), {
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '0',
          },
          status: 503,
        })
      }
      return new Response(null, { status: 204 })
    })
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async (request) => await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: providerFetch,
        loadVaultImage: async () => imageBytes,
        publicFetchImplementation: publicFetch,
      }),
    )

    await useActualOutboundDeliveryImplementation()
    const sent = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: intent.intentId,
      now: new Date('2026-08-06T20:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(sent.intent).toMatchObject({
      delivery: {
        channel: 'linq',
        providerMessageId: 'linq_image_message_recovered',
        target: 'linq_chat_attachment_recovered',
      },
      status: 'sent',
    })
    expect(providerFetch).toHaveBeenCalledTimes(2)
    expect(publicFetch).toHaveBeenCalledTimes(3)
    expect(sendLinq).toHaveBeenCalledTimes(1)
    expect(finalMessageBodies).toHaveLength(1)
    expect(finalMessageBodies[0]).toMatchObject({
      message: {
        parts: [
          { type: 'text', value: 'Recovered private image' },
          { attachment_id: 'attachment_recovered', type: 'media' },
        ],
      },
    })
  })

  it('reuses the first frozen card for one scheduled closeout occurrence', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-card-transport-identity-',
    )
    const scheduledCloseout: Pick<AssistantCronJob, 'jobId' | 'state' | 'target'> = {
      jobId: 'cron_daily_meal_closeout',
      state: {
        nextRunAt: '2026-07-29T01:00:00.000Z',
        lastRunAt: null,
        lastSucceededAt: null,
        lastFailedAt: null,
        consecutiveFailures: 0,
        lastError: null,
        runningAt: null,
        runningPid: null,
      },
      target: {
        alias: null,
        channel: 'linq',
        deliverySource: {
          fromPhoneNumber: '+15550000',
          kind: 'linq',
        },
        sessionId: null,
        identityId: 'identity-closeout',
        participantId: '+15550001',
        threadId: 'thread-response-card',
        deliveryTarget: null,
      },
    }
    const transportIdentity = buildAssistantCronNotificationDedupeToken({
      job: scheduledCloseout,
      trigger: 'scheduled',
    })
    expect(transportIdentity).not.toBeNull()

    const first = await createAssistantOutboxIntent({
      card: NUTRITION_RESPONSE_CARD,
      channel: 'linq',
      dedupeToken: transportIdentity,
      deliveryIdempotencyKey: transportIdentity,
      message: 'ignored model prose',
      sessionId: 'session-response-card-transport',
      threadId: 'thread-response-card-transport',
      threadIsDirect: true,
      turnId: 'turn-response-card-transport',
      vault: vaultRoot,
    })

    const retry = await createAssistantOutboxIntent({
      card: {
        ...NUTRITION_RESPONSE_CARD,
        totals: {
          ...NUTRITION_RESPONSE_CARD.totals,
          calories: {
            ...NUTRITION_RESPONSE_CARD.totals.calories,
            total: 1_491.25,
          },
        },
      },
      channel: 'linq',
      dedupeToken: transportIdentity,
      deliveryIdempotencyKey: transportIdentity,
      message: 'different ignored model prose',
      sessionId: 'session-response-card-transport',
      threadId: 'thread-response-card-transport',
      threadIsDirect: true,
      turnId: 'turn-response-card-transport',
      vault: vaultRoot,
    })

    expect(retry.intentId).toBe(first.intentId)
    expect(retry.card).toEqual(NUTRITION_RESPONSE_CARD)
    expect(retry.message).toBe(first.message)
    expect(retry.deliveryIdempotencyKey).toBe(first.deliveryIdempotencyKey)
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toHaveLength(1)
  })

  it('stores response media while explicit dedupe tokens ignore media drift', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-media-dedupe-')

    const first = await createIntent(vaultRoot, {
      channel: 'linq',
      dedupeToken: 'stable-media-token',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/setup.png',
          alt: 'Dead bug setup',
          source: 'dead-bug-setup',
        },
      ],
      message: 'same text',
      sessionId: 'session-media-dedupe',
      turnId: 'turn-media-dedupe',
    })
    const sameTextDifferentMedia = await createIntent(vaultRoot, {
      channel: 'linq',
      dedupeToken: 'stable-media-token',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/extend.png',
          alt: 'Dead bug extension',
          source: 'dead-bug-extend',
        },
      ],
      message: 'same text',
      sessionId: 'session-media-dedupe',
      turnId: 'turn-media-dedupe',
    })
    const sameTextSameMedia = await createIntent(vaultRoot, {
      channel: 'linq',
      dedupeToken: 'stable-media-token',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/setup.png',
          alt: 'Dead bug setup',
          source: 'dead-bug-setup',
        },
      ],
      message: 'same text',
      sessionId: 'session-media-dedupe',
      turnId: 'turn-media-dedupe',
    })

    expect(first.media).toEqual([
      {
        kind: 'image',
        url: 'https://cdn.example.test/dead-bug/setup.png',
        alt: 'Dead bug setup',
        source: 'dead-bug-setup',
      },
    ])
    expect(sameTextDifferentMedia.intentId).toBe(first.intentId)
    expect(sameTextSameMedia.intentId).toBe(first.intentId)
    await expect(readAssistantOutboxIntent(vaultRoot, first.intentId)).resolves
      .toMatchObject({
        media: first.media,
      })

  })

  it('dedupes same-token media retries against legacy media-sensitive intent keys', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-legacy-media-dedupe-')
    const legacyDedupeKey = '15f875b128b127b5cdaa25b207a6a055b6feb4ac'

    const first = await createIntent(vaultRoot, {
      channel: 'linq',
      dedupeToken: 'stable-legacy-media-token',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/setup.png',
          alt: 'Dead bug setup',
          source: 'dead-bug-setup',
        },
      ],
      message: 'same text',
      sessionId: 'session-legacy-media-dedupe',
      turnId: 'turn-legacy-media-dedupe',
    })
    expect(hashAssistantOutboxLegacyMediaDedupeIdentity({
      dedupeToken: ' stable-legacy-media-token ',
      media: first.media,
    })).toBe(legacyDedupeKey)
    expect(hashAssistantOutboxIdentity({
      dedupeToken: 'stable-legacy-media-token',
      media: first.media,
      message: first.message,
      subject: first.subject,
      sessionId: first.sessionId,
      turnId: first.turnId,
    })).not.toBe(legacyDedupeKey)
    await saveAssistantOutboxIntent(vaultRoot, {
      ...first,
      dedupeKey: legacyDedupeKey,
      updatedAt: '2026-04-08T00:02:00.000Z',
    })

    const retryWithDifferentMedia = await createIntent(vaultRoot, {
      channel: 'linq',
      dedupeToken: 'stable-legacy-media-token',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/retry.png',
          alt: 'Dead bug retry',
          source: 'dead-bug-retry',
        },
      ],
      message: 'same text',
      sessionId: 'session-legacy-media-dedupe',
      turnId: 'turn-legacy-media-dedupe',
    })

    expect(retryWithDifferentMedia.intentId).toBe(first.intentId)
    expect(retryWithDifferentMedia.dedupeKey).toBe(legacyDedupeKey)
    expect(retryWithDifferentMedia.media).toEqual(first.media)
  })

  it('dedupes hosted-key retries against legacy no-token active intents', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-legacy-idempotency-dedupe-')
    const deliveryIdempotencyKey = 'sha256:legacy-final-reply-key'

    const first = await createIntent(vaultRoot, {
      channel: 'linq',
      dedupeToken: null,
      deliveryIdempotencyKey,
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/legacy-idempotency.png',
          alt: 'Dead bug legacy idempotency',
          source: 'dead-bug-legacy-idempotency',
        },
      ],
      message: 'old final reply text',
      sessionId: 'session-legacy-idempotency-dedupe',
      turnId: 'turn-legacy-idempotency-dedupe',
    })
    expect(first.deliveryIdempotencyKey).toBe(deliveryIdempotencyKey)
    expect(hashAssistantOutboxIdentity({
      dedupeToken: deliveryIdempotencyKey,
      media: first.media,
      message: first.message,
      subject: first.subject,
      sessionId: first.sessionId,
      turnId: first.turnId,
    })).not.toBe(first.dedupeKey)

    const retry = await createIntent(vaultRoot, {
      channel: 'linq',
      dedupeToken: deliveryIdempotencyKey,
      deliveryIdempotencyKey,
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/retry-idempotency.png',
          alt: 'Dead bug retry idempotency',
          source: 'dead-bug-retry-idempotency',
        },
      ],
      message: 'changed final reply text',
      sessionId: 'session-legacy-idempotency-dedupe',
      turnId: 'turn-legacy-idempotency-dedupe',
    })

    expect(retry.intentId).toBe(first.intentId)
    expect(retry.dedupeKey).toBe(first.dedupeKey)
    expect(retry.message).toBe(first.message)
    expect(retry.media).toEqual(first.media)
  })

  it('prefers active stable dedupe-key intents before legacy media-sensitive matches', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-stable-before-legacy-')
    const dedupeToken = 'stable-key-wins-over-legacy-token'
    const legacyDedupeKey = hashAssistantOutboxLegacyMediaDedupeIdentity({
      dedupeToken,
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/legacy.png',
          alt: 'Dead bug legacy',
          source: 'dead-bug-legacy',
        },
      ],
    })
    if (!legacyDedupeKey) {
      throw new Error('Expected legacy dedupe key.')
    }

    const legacyIntent = await createIntent(vaultRoot, {
      channel: 'linq',
      createdAt: '2026-04-08T00:00:00.000Z',
      dedupeToken: 'legacy-placeholder-token',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/legacy.png',
          alt: 'Dead bug legacy',
          source: 'dead-bug-legacy',
        },
      ],
      message: 'same text',
      sessionId: 'session-stable-before-legacy',
      turnId: 'turn-stable-before-legacy',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...legacyIntent,
      dedupeKey: legacyDedupeKey,
      updatedAt: '2026-04-08T00:00:30.000Z',
    })

    const stableIntentSeed = await createIntent(vaultRoot, {
      channel: 'linq',
      createdAt: '2026-04-08T00:01:00.000Z',
      dedupeToken: 'stable-placeholder-token',
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/stable.png',
          alt: 'Dead bug stable',
          source: 'dead-bug-stable',
        },
      ],
      message: 'same text',
      sessionId: 'session-stable-before-legacy',
      turnId: 'turn-stable-before-legacy',
    })
    const stableDedupeKey = hashAssistantOutboxIdentity({
      dedupeToken,
      media: stableIntentSeed.media,
      message: stableIntentSeed.message,
      subject: stableIntentSeed.subject,
      sessionId: stableIntentSeed.sessionId,
      turnId: stableIntentSeed.turnId,
    })
    const stableIntent = {
      ...stableIntentSeed,
      dedupeKey: stableDedupeKey,
      updatedAt: '2026-04-08T00:01:30.000Z',
    }
    await saveAssistantOutboxIntent(vaultRoot, stableIntent)

    const retry = await createIntent(vaultRoot, {
      channel: 'linq',
      createdAt: '2026-04-08T00:02:00.000Z',
      dedupeToken,
      media: [
        {
          kind: 'image',
          url: 'https://cdn.example.test/dead-bug/retry.png',
          alt: 'Dead bug retry',
          source: 'dead-bug-retry',
        },
      ],
      message: 'same text',
      sessionId: 'session-stable-before-legacy',
      turnId: 'turn-stable-before-legacy',
    })

    expect(retry.intentId).toBe(stableIntent.intentId)
    expect(retry.intentId).not.toBe(legacyIntent.intentId)
    expect(retry.dedupeKey).toBe(stableIntent.dedupeKey)
    expect(retry.media).toEqual(stableIntent.media)
  })

  it('keeps same-text assistant segments distinct when their dedupe tokens differ', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-segment-dedupe-')

    const firstSegment = await createIntent(vaultRoot, {
      dedupeToken: 'assistant-segment:turn-segment-dedupe:0',
      message: 'Same final text.',
      sessionId: 'session-segment-dedupe',
      turnId: 'turn-segment-dedupe',
    })
    const secondSegment = await createIntent(vaultRoot, {
      dedupeToken: 'assistant-segment:turn-segment-dedupe:1',
      message: 'Same final text.',
      sessionId: 'session-segment-dedupe',
      turnId: 'turn-segment-dedupe',
    })
    const retryFirstSegment = await createIntent(vaultRoot, {
      dedupeToken: 'assistant-segment:turn-segment-dedupe:0',
      message: 'Same final text.',
      sessionId: 'session-segment-dedupe',
      turnId: 'turn-segment-dedupe',
    })

    expect(secondSegment.intentId).not.toBe(firstSegment.intentId)
    expect(retryFirstSegment.intentId).toBe(firstSegment.intentId)
  })

  it('lists intents oldest-first and quarantines malformed inventory files', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'))

    const { paths, vaultRoot } = await createAssistantVault('assistant-outbox-list-')
    const later = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:00:00.000Z',
      message: 'later intent',
      sessionId: 'session-list-later',
      turnId: 'turn-list-later',
    })
    const earlier = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:30:00+01:00',
      message: 'earlier intent',
      sessionId: 'session-list-earlier',
      turnId: 'turn-list-earlier',
    })

    await mkdir(path.join(paths.outboxDirectory, 'nested'), {
      recursive: true,
    })
    await writeFile(path.join(paths.outboxDirectory, 'notes.txt'), 'ignore me\n', 'utf8')
    const brokenPath = path.join(paths.outboxDirectory, 'broken.json')
    await writeFile(
      brokenPath,
      '{"schema":"murph.assistant-outbox-intent.v1"',
      'utf8',
    )

    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toMatchObject([
      { intentId: earlier.intentId, createdAt: earlier.createdAt },
      { intentId: later.intentId, createdAt: later.createdAt },
    ])
    await expect(readAssistantOutboxIntent(vaultRoot, 'broken')).resolves.toBeNull()

    const quarantined = await readdir(paths.outboxQuarantineDirectory)
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]).toMatch(/^broken\.\d+\.invalid\.json$/u)
    expect(await readAssistantOutboxIntent(vaultRoot, 'broken')).toBeNull()

    const diagnostics = await readAssistantDiagnosticsSnapshot(vaultRoot)
    expect(diagnostics.recentWarnings.at(-1)).toContain(
      '[ASSISTANT_OUTBOX_INTENT_INVALID]',
    )
  })

  it('orders same-timestamp bubble intents before the final reply by bubble ordinal', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-bubble-order-')
    const createdAt = '2026-04-08T00:01:00.000Z'
    const common = {
      createdAt,
      sessionId: 'session-bubble-order',
      turnId: 'turn-bubble-order',
    }

    await createIntent(vaultRoot, {
      ...common,
      dedupeToken: 'dedupe-final',
      deliveryIdempotencyKey: 'delivery-final',
      message: 'Final bubble',
    })
    await createIntent(vaultRoot, {
      ...common,
      dedupeToken: 'dedupe-bubble-1',
      deliveryIdempotencyKey: 'delivery-final:bubble:1',
      message: 'Second bubble',
    })
    await createIntent(vaultRoot, {
      ...common,
      dedupeToken: 'dedupe-bubble-0',
      deliveryIdempotencyKey: 'delivery-final:bubble:0',
      message: 'First bubble',
    })

    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toMatchObject([
      { message: 'First bubble' },
      { message: 'Second bubble' },
      { message: 'Final bubble' },
    ])
  })

  it('quarantines stale outbox intents with removed legacy fields instead of normalizing them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:05:00.000Z'))

    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-outbox-legacy-field-quarantine-',
    )
    const seeded = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:05:00.000Z',
      message: 'legacy field should quarantine',
      sessionId: 'session-legacy-field',
      turnId: 'turn-legacy-field',
    })

    await writeFile(
      path.join(paths.outboxDirectory, `${seeded.intentId}.json`),
      JSON.stringify({
        ...seeded,
        deliveryStateAuthority: 'legacy-local-runtime',
      }),
      'utf8',
    )

    await expect(
      readAssistantOutboxIntentMirrorState({
        intentId: seeded.intentId,
        vault: vaultRoot,
      }),
    ).resolves.toMatchObject({
      intent: null,
    })
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([])
    await expect(readAssistantOutboxIntent(vaultRoot, seeded.intentId)).resolves.toBeNull()

    const quarantined = await readdir(paths.outboxQuarantineDirectory)
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]).toMatch(
      new RegExp(`^${seeded.intentId}\\.\\d+\\.invalid\\.json$`, 'u'),
    )
  })

  it('prunes terminal outbox intents by age and count without touching active retries', async () => {
    const { paths, vaultRoot } = await createAssistantVault('assistant-outbox-retention-')

    const oldTerminal = await createIntent(vaultRoot, {
      createdAt: '2026-03-01T00:00:00.000Z',
      message: 'old terminal intent',
      sessionId: 'session-old-terminal',
      turnId: 'turn-old-terminal',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...oldTerminal,
      status: 'sent',
      sentAt: '2026-03-01T00:05:00.000Z',
      updatedAt: '2026-03-01T00:05:00.000Z',
    })

    const generatedRef = 'raw/captures/2026/04/generated/generated.webp'
    const generatedDelivery = await createIntent(vaultRoot, {
      channel: 'linq',
      createdAt: '2026-04-18T00:00:00.000Z',
      media: [{
        alt: 'Visible generated image',
        contentType: 'image/webp',
        filename: 'generated.webp',
        kind: 'vault_image',
        ref: generatedRef,
        sha256: 'a'.repeat(64),
        sizeBytes: 128,
        source: 'gpt-image-2',
      }],
      message: 'visible generated image',
      sessionId: 'session-generated-delivery',
      turnId: 'turn-generated-delivery',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...generatedDelivery,
      delivery: createDelivery({
        channel: 'linq',
        providerMessageId: 'generated-delivery-message',
        sentAt: '2026-04-18T00:05:00.000Z',
      }),
      sentAt: '2026-04-18T00:05:00.000Z',
      status: 'sent',
      updatedAt: '2026-04-18T00:05:00.000Z',
    })

    const recentTerminalIntents = Array.from({ length: 101 }, (_, index) => {
      const createdAt = new Date(Date.UTC(2026, 3, 19, 0, index, 0)).toISOString()
      const message = `terminal-${index}`
      const sessionId = `session-terminal-${index}`
      const turnId = `turn-terminal-${index}`
      return {
        ...oldTerminal,
        createdAt,
        dedupeKey: hashAssistantOutboxIdentity({
          dedupeToken: `${sessionId}:${turnId}`,
          media: oldTerminal.media,
          message,
          subject: oldTerminal.subject,
          sessionId,
          turnId,
        }),
        intentId: `outbox_${(index + 1).toString(16).padStart(32, '0')}`,
        message,
        nextAttemptAt: createdAt,
        sentAt: null,
        sessionId,
        status: index % 2 === 0 ? 'failed' : 'abandoned',
        turnId,
        updatedAt: createdAt,
      } satisfies AssistantOutboxIntent
    })

    const activeRetryable = {
      ...oldTerminal,
      createdAt: '2026-03-01T00:10:00.000Z',
      dedupeKey: hashAssistantOutboxIdentity({
        dedupeToken: 'session-active-retryable:turn-active-retryable',
        media: oldTerminal.media,
        message: 'active retryable intent',
        subject: oldTerminal.subject,
        sessionId: 'session-active-retryable',
        turnId: 'turn-active-retryable',
      }),
      intentId: `outbox_${'f'.repeat(32)}`,
      message: 'active retryable intent',
      nextAttemptAt: '2026-04-20T12:05:00.000Z',
      sentAt: null,
      sessionId: 'session-active-retryable',
      status: 'retryable',
      turnId: 'turn-active-retryable',
      updatedAt: '2026-04-20T12:00:00.000Z',
    } satisfies AssistantOutboxIntent
    await Promise.all(
      [...recentTerminalIntents, activeRetryable].map((intent) =>
        writeFile(
          resolveAssistantOutboxIntentPath(paths.outboxDirectory, intent.intentId),
          JSON.stringify(intent),
          'utf8',
        ),
      ),
    )

    await expect(
      pruneAssistantTerminalOutboxIntents({
        now: new Date('2026-04-20T12:00:00.000Z'),
        paths,
        vault: vaultRoot,
      }),
    ).resolves.toBe(2)

    const retained = await listAssistantOutboxIntentsLocal(vaultRoot)
    expect(retained).toHaveLength(102)
    expect(retained.filter((intent) => intent.status === 'retryable')).toHaveLength(1)
    expect(
      retained.some((intent) => intent.message === 'old terminal intent'),
    ).toBe(false)
    expect(retained.filter((intent) => intent.status !== 'retryable')).toHaveLength(101)
    expect(retained.some((intent) =>
      intent.intentId === generatedDelivery.intentId
    )).toBe(true)
    expect(resolveAssistantGeneratedImageDelivery({
      currentMedia: {
        contentType: 'image/webp',
        sha256: 'a'.repeat(64),
        sizeBytes: 128,
      },
      generatedImageOriginKnown: true,
      imageRef: generatedRef,
      intents: retained,
      sessionId: generatedDelivery.sessionId,
      transcriptEntries: [],
    })).toBe(true)

    await expect(
      pruneAssistantTerminalOutboxIntents({
        now: new Date('2026-05-02T00:06:00.000Z'),
        paths,
        vault: vaultRoot,
      }),
    ).resolves.toBe(1)
    const retainedAfterAgeCutoff = await listAssistantOutboxIntentsLocal(vaultRoot)
    expect(retainedAfterAgeCutoff.some((intent) =>
      intent.intentId === generatedDelivery.intentId
    )).toBe(false)
    expect(resolveAssistantGeneratedImageDelivery({
      currentMedia: {
        contentType: 'image/webp',
        sha256: 'a'.repeat(64),
        sizeBytes: 128,
      },
      generatedImageOriginKnown: true,
      imageRef: generatedRef,
      intents: retainedAfterAgeCutoff,
      sessionId: generatedDelivery.sessionId,
      transcriptEntries: [],
    })).toBe(false)
  })

  it('retains legacy group newsletter terminal occurrence evidence during outbox pruning', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-outbox-newsletter-retention-',
    )
    const deliveryIdempotencyKey =
      'group-newsletter:automation_newsletter:2026-07-12T13:00:00.000Z:group_123'
    const parentTarget = serializeHostedEmailThreadTarget({
      groupId: 'group_123',
      subject: 'Weekly health note',
      targetKind: 'group',
    })
    const childTarget = serializeHostedEmailThreadTarget({
      groupId: 'group_123',
      recipientMemberId: 'member_one',
      subject: 'Weekly health note',
      targetKind: 'group',
    })

    const parent = await createIntent(vaultRoot, {
      channel: 'email',
      createdAt: '2026-03-01T00:00:00.000Z',
      deliveryIdempotencyKey,
      explicitTarget: parentTarget,
      message: 'newsletter parent manifest',
      sessionId: 'session-newsletter-parent',
      threadIsDirect: false,
      turnId: 'turn-newsletter-parent',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...parent,
      sentAt: '2026-03-01T00:05:00.000Z',
      status: 'sent',
      updatedAt: '2026-03-01T00:05:00.000Z',
    })

    const sentChild = await createIntent(vaultRoot, {
      channel: 'email',
      createdAt: '2026-03-01T00:01:00.000Z',
      deliveryIdempotencyKey,
      explicitTarget: childTarget,
      message: 'newsletter sent recipient child',
      sessionId: 'session-newsletter-sent-child',
      threadIsDirect: false,
      turnId: 'turn-newsletter-sent-child',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...sentChild,
      sentAt: '2026-03-01T00:06:00.000Z',
      status: 'sent',
      updatedAt: '2026-03-01T00:06:00.000Z',
    })
    const failedChild = await createIntent(vaultRoot, {
      channel: 'email',
      createdAt: '2026-03-01T00:02:00.000Z',
      deliveryIdempotencyKey,
      explicitTarget: serializeHostedEmailThreadTarget({
        groupId: 'group_123',
        recipientMemberId: 'member_two',
        subject: 'Weekly health note',
        targetKind: 'group',
      }),
      message: 'newsletter failed recipient child',
      sessionId: 'session-newsletter-failed-child',
      threadIsDirect: false,
      turnId: 'turn-newsletter-failed-child',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...failedChild,
      lastError: {
        code: 'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED',
        message: 'pre-provider recipient authority changed',
      },
      status: 'abandoned',
      updatedAt: '2026-03-01T00:07:00.000Z',
    })

    const cronRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: 'automation_newsletter',
      now: '2026-03-01T00:00:00.000Z',
    })
    cronRecord.state.pendingOccurrenceAt = '2026-07-12T13:00:00.000Z'
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [cronRecord],
      version: 1,
    })

    await expect(
      pruneAssistantTerminalOutboxIntents({
        now: new Date('2026-04-20T12:00:00.000Z'),
        paths,
        vault: vaultRoot,
      }),
    ).resolves.toBe(0)

    const retained = await listAssistantOutboxIntentsLocal(vaultRoot)
    expect(retained.map((intent) => intent.intentId).sort()).toEqual(
      [failedChild.intentId, parent.intentId, sentChild.intentId].sort(),
    )
    expect(retained).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          intentId: parent.intentId,
          message: 'newsletter parent manifest',
          status: 'sent',
        }),
        expect.objectContaining({
          intentId: sentChild.intentId,
          message: 'newsletter sent recipient child',
          status: 'sent',
        }),
        expect.objectContaining({
          intentId: failedChild.intentId,
          message: 'newsletter failed recipient child',
          status: 'abandoned',
        }),
      ]),
    )

    cronRecord.state.pendingOccurrenceAt = null
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [cronRecord],
      version: 1,
    })
    await expect(
      pruneAssistantTerminalOutboxIntents({
        now: new Date('2026-04-20T12:00:00.000Z'),
        paths,
        vault: vaultRoot,
      }),
    ).resolves.toBe(3)
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([])
  })

  it('prunes terminal outbox intents by instant when timestamp offsets differ', async () => {
    const { paths, vaultRoot } = await createAssistantVault(
      'assistant-outbox-retention-offsets-',
    )

    for (let index = 0; index < 99; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 3, 19, 1, index, 0)).toISOString()
      const seeded = await createIntent(vaultRoot, {
        createdAt,
        message: `newer terminal ${index}`,
        sessionId: `session-newer-terminal-${index}`,
        turnId: `turn-newer-terminal-${index}`,
      })
      await saveAssistantOutboxIntent(vaultRoot, {
        ...seeded,
        status: 'failed',
        updatedAt: createdAt,
      })
    }

    const olderByInstant = await createIntent(vaultRoot, {
      createdAt: '2026-04-19T00:30:00+01:00',
      message: 'older by instant',
      sessionId: 'session-older-by-instant',
      turnId: 'turn-older-by-instant',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...olderByInstant,
      status: 'failed',
      updatedAt: '2026-04-19T00:30:00+01:00',
    })

    const newerByInstant = await createIntent(vaultRoot, {
      createdAt: '2026-04-19T00:00:00.000Z',
      message: 'newer by instant',
      sessionId: 'session-newer-by-instant',
      turnId: 'turn-newer-by-instant',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...newerByInstant,
      status: 'failed',
      updatedAt: '2026-04-19T00:00:00.000Z',
    })

    await expect(
      pruneAssistantTerminalOutboxIntents({
        now: new Date('2026-04-20T12:00:00.000Z'),
        paths,
        vault: vaultRoot,
      }),
    ).resolves.toBe(1)

    const retained = await listAssistantOutboxIntentsLocal(vaultRoot)
    expect(retained).toHaveLength(100)
    expect(retained.some((intent) => intent.message === 'older by instant')).toBe(
      false,
    )
    expect(retained.some((intent) => intent.message === 'newer by instant')).toBe(
      true,
    )
  })

  it('reconciles stale persisted deliveries without resending them', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-reconcile-')
    vi.useFakeTimers()

    const reconciledSeed = await createIntent(vaultRoot, {
      channel: 'linq',
      createdAt: '2026-04-08T01:00:00.000Z',
      explicitTarget: 'linq-thread-reconcile-a',
      identityId: 'phone_lookup_reconcile_a',
      message: 'needs reconciliation',
      threadId: 'linq-thread-reconcile-a',
      sessionId: 'session-reconcile-a',
      replyToMessageId: 'linq-msg-reconcile-a',
      turnId: 'turn-reconcile-a',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...reconciledSeed,
      attemptCount: 1,
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: 'existing-idempotency',
        providerMessageId: 'provider-pending',
        providerThreadId: 'linq-thread-reconcile-a',
        sentAt: '2026-04-08T01:01:00.000Z',
        target: 'linq-thread-reconcile-a',
        targetKind: 'thread',
      }),
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey: 'existing-idempotency',
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T01:01:00.000Z',
      lastError: createConfirmationPendingError(),
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T01:01:00.000Z',
    })

    const reconciled = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        resolveDeliveredIntent: async () =>
          createDelivery({
            channel: 'linq',
            idempotencyKey: 'existing-idempotency',
            providerMessageId: 'provider-reconciled',
            providerThreadId: 'linq-thread-reconcile-a',
            sentAt: '2026-04-08T01:03:00.000Z',
            target: 'linq-thread-reconcile-a',
            targetKind: 'thread',
          }),
      },
      intentId: reconciledSeed.intentId,
      now: new Date('2026-04-08T01:20:00.000Z'),
      vault: vaultRoot,
    })
    expect(reconciled.deliveryError).toBeNull()
    expect(reconciled.intent.status).toBe('sent')
    expect(expectMessageDelivery(reconciled.intent.delivery).providerMessageId).toBe(
      'provider-reconciled',
    )
    expect(reconciled.intent.deliveryConfirmationPending).toBe(false)

    const persistedRetrySeed = await createIntent(vaultRoot, {
      channel: 'linq',
      createdAt: '2026-04-08T02:00:00.000Z',
      explicitTarget: 'linq-thread-reconcile-b',
      identityId: 'phone_lookup_reconcile_b',
      message: 'still pending confirmation',
      threadId: 'linq-thread-reconcile-b',
      sessionId: 'session-reconcile-b',
      replyToMessageId: 'linq-msg-reconcile-b',
      turnId: 'turn-reconcile-b',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...persistedRetrySeed,
      attemptCount: 2,
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: 'pending-idempotency',
        providerMessageId: 'provider-still-pending',
        providerThreadId: 'linq-thread-reconcile-b',
        sentAt: '2026-04-08T02:01:00.000Z',
        target: 'linq-thread-reconcile-b',
        targetKind: 'thread',
      }),
      deliveryConfirmationPending: true,
      deliveryIdempotencyKey: 'pending-idempotency',
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T02:01:00.000Z',
      lastError: createConfirmationPendingError(),
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T02:01:00.000Z',
    })

    vi.setSystemTime(new Date('2026-04-08T02:20:00.000Z'))

    const reconciledFromPersistedDelivery = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        resolveDeliveredIntent: async () => null,
      },
      intentId: persistedRetrySeed.intentId,
      now: new Date('2026-04-08T02:20:00.000Z'),
      vault: vaultRoot,
    })
    expect(reconciledFromPersistedDelivery.deliveryError).toBeNull()
    expect(reconciledFromPersistedDelivery.intent.status).toBe('sent')
    expect(reconciledFromPersistedDelivery.intent.deliveryConfirmationPending).toBe(false)
    expect(expectMessageDelivery(reconciledFromPersistedDelivery.intent.delivery).providerMessageId).toBe(
      'provider-still-pending',
    )
  })

  it('delivers immediately, reuses sent dedupe hits, and supports queue-only mode', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-deliver-')
    const prepareDispatchIntent = vi.fn(async () => {})
    const persistDeliveredIntent = vi.fn(async () => {})

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        idempotencyKey: null,
        providerMessageId: 'provider-sent',
        sentAt: '2026-04-08T03:01:00.000Z',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })

    const sent = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dispatchHooks: {
        persistDeliveredIntent,
        prepareDispatchIntent,
      },
      identityId: 'participant-1',
      message: 'deliver this now',
      sessionId: 'session-deliver',
      threadId: 'thread-deliver',
      threadIsDirect: true,
      turnId: 'turn-deliver',
      vault: vaultRoot,
    })
    expect(sent.kind).toBe('sent')
    expect(sent.intent.status).toBe('sent')
    expect(sent.delivery?.idempotencyKey).toBe(
      `assistant-outbox:${sent.intent.intentId}`,
    )
    expect(prepareDispatchIntent).toHaveBeenCalledTimes(1)
    expect(persistDeliveredIntent).toHaveBeenCalledTimes(1)
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)

    const alreadySent = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      identityId: 'participant-1',
      message: 'deliver this now',
      sessionId: 'session-deliver',
      threadId: 'thread-deliver',
      threadIsDirect: true,
      turnId: 'turn-deliver',
      vault: vaultRoot,
    })
    expect(alreadySent.kind).toBe('sent')
    expect(alreadySent.intent.intentId).toBe(sent.intent.intentId)
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)

    const queued = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dispatchMode: 'queue-only',
      identityId: 'participant-queue',
      message: 'queue this',
      sessionId: 'session-queue',
      threadId: 'thread-queue',
      threadIsDirect: true,
      turnId: 'turn-queue',
      vault: vaultRoot,
    })
    expect(queued.kind).toBe('queued')
    expect(queued.intent.status).toBe('pending')
    await expectRawOutboxIntentMessage(vaultRoot, queued.intent.intentId, {
      media: [],
      message: 'queue this',
      replyToMessageId: null,
      subject: null,
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('dispatches Telegram reaction operations and preserves queued reaction intent shape', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-reaction-')
    const setTelegramMessageReaction = vi.fn(async (input: {
      reaction: 'heart' | 'thumbs_up' | 'laugh'
      target: string
      targetMessageId: string
    }) => ({
      reaction: input.reaction,
      target: input.target,
      targetKind: 'explicit' as const,
      targetMessageId: input.targetMessageId,
    }))

    const sent = await deliverAssistantOutboxReaction({
      channel: 'telegram',
      dependencies: {
        setTelegramMessageReaction,
      },
      explicitTarget: '123',
      reaction: 'thumbs_up',
      sessionId: 'session-reaction',
      targetMessageId: '45',
      turnId: 'turn-reaction',
      vault: vaultRoot,
    })

    expect(sent.kind).toBe('sent')
    expect(sent.intent.status).toBe('sent')
    expect(sent.intent.message).toBe('')
    expect(sent.intent.replyToMessageId).toBe('45')
    expect(sent.intent.operation).toEqual({
      kind: 'message-reaction',
      reaction: 'thumbs_up',
    })
    expect(sent.delivery).toMatchObject({
      kind: 'message-reaction',
      channel: 'telegram',
      reaction: 'thumbs_up',
      target: '123',
      targetKind: 'explicit',
      targetMessageId: '45',
    })
    expect(setTelegramMessageReaction).toHaveBeenCalledTimes(1)
    expect(setTelegramMessageReaction).toHaveBeenCalledWith({
      reaction: 'thumbs_up',
      signal: undefined,
      target: '123',
      targetMessageId: '45',
    })

    const queued = await deliverAssistantOutboxReaction({
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: '456',
      reaction: 'heart',
      sessionId: 'session-reaction-queue',
      targetMessageId: '67',
      turnId: 'turn-reaction-queue',
      vault: vaultRoot,
    })

    expect(queued.kind).toBe('queued')
    expect(queued.intent.status).toBe('pending')
    expect(queued.intent.message).toBe('')
    expect(queued.intent.replyToMessageId).toBe('67')
    expect(queued.intent.operation).toEqual({
      kind: 'message-reaction',
      reaction: 'heart',
    })
    await expect(readRawOutboxIntent(vaultRoot, queued.intent.intentId)).resolves
      .toMatchObject({
        operation: {
          kind: 'message-reaction',
          reaction: 'heart',
        },
      })
    expect(setTelegramMessageReaction).toHaveBeenCalledTimes(1)
  })

  it('dispatches Linq reaction operations through the channel adapter', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-linq-reaction-')
    const setLinqMessageReaction = vi.fn(async (input: {
      reaction: 'heart' | 'thumbs_up' | 'laugh'
      target: string
      targetMessageId: string
    }) => ({
      reaction: input.reaction,
      target: input.target,
      targetKind: 'thread' as const,
      targetMessageId: input.targetMessageId,
    }))

    const sent = await deliverAssistantOutboxReaction({
      answeredMailboxItemIds: ['mailbox-linq-reaction-1'],
      channel: 'linq',
      dependencies: {
        setLinqMessageReaction,
      },
      explicitTarget: 'linq-chat-123',
      reaction: 'heart',
      sessionId: 'session-linq-reaction',
      targetMessageId: 'linq-message-45',
      turnId: 'turn-linq-reaction',
      vault: vaultRoot,
    })

    expect(sent.kind).toBe('sent')
    expect(sent.intent.status).toBe('sent')
    expect(sent.intent.deliveryTransportIdempotent).toBe(false)
    expect(sent.intent.answeredMailboxItemIds).toEqual([
      'mailbox-linq-reaction-1',
    ])
    expect(sent.intent.operation).toEqual({
      kind: 'message-reaction',
      reaction: 'heart',
    })
    expect(sent.delivery).toMatchObject({
      kind: 'message-reaction',
      channel: 'linq',
      reaction: 'heart',
      target: 'linq-chat-123',
      targetKind: 'thread',
      targetMessageId: 'linq-message-45',
    })
    expect(setLinqMessageReaction).toHaveBeenCalledWith({
      reaction: 'heart',
      signal: undefined,
      target: 'linq-chat-123',
      targetMessageId: 'linq-message-45',
    })

    const queuedDirect = await createAssistantOutboxIntent({
      channel: 'linq',
      explicitTarget: 'linq-chat-456',
      message: 'ignored for reaction',
      operation: {
        kind: 'message-reaction',
        reaction: 'laugh',
      },
      replyToMessageId: 'linq-message-67',
      sessionId: 'session-linq-reaction-direct',
      turnId: 'turn-linq-reaction-direct',
      vault: vaultRoot,
    })
    expect(queuedDirect.deliveryTransportIdempotent).toBe(false)
    expect(queuedDirect.operation).toEqual({
      kind: 'message-reaction',
      reaction: 'laugh',
    })
  })

  it('retains an accepted Linq reaction receipt while exact-consume confirmation retries', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-reaction-confirmation-',
    )
    const setLinqMessageReaction = vi.fn(async (input: {
      reaction: 'heart' | 'thumbs_up' | 'laugh'
      target: string
      targetMessageId: string
    }) => ({
      reaction: input.reaction,
      target: input.target,
      targetKind: 'thread' as const,
      targetMessageId: input.targetMessageId,
    }))
    const persistDeliveredIntent = vi.fn(async (input: {
      intent: AssistantOutboxIntent
    }) => {
      expect(input.intent.answeredMailboxItemIds).toEqual([
        'mailbox-linq-reaction-confirmation',
      ])
      expect(input.intent.delivery).toMatchObject({
        channel: 'linq',
        kind: 'message-reaction',
        targetMessageId: 'linq-message-confirmation',
      })
      throw new Error('Web confirmation unavailable')
    })

    const first = await deliverAssistantOutboxReaction({
      answeredMailboxItemIds: ['mailbox-linq-reaction-confirmation'],
      channel: 'linq',
      dependencies: {
        setLinqMessageReaction,
      },
      dispatchHooks: {
        persistDeliveredIntent,
      },
      explicitTarget: 'linq-chat-confirmation',
      reaction: 'thumbs_up',
      sessionId: 'session-linq-reaction-confirmation',
      targetMessageId: 'linq-message-confirmation',
      turnId: 'turn-linq-reaction-confirmation',
      vault: vaultRoot,
    })

    expect(first.kind).toBe('queued')
    expect(first.intent).toMatchObject({
      answeredMailboxItemIds: ['mailbox-linq-reaction-confirmation'],
      delivery: {
        channel: 'linq',
        kind: 'message-reaction',
        targetMessageId: 'linq-message-confirmation',
      },
      deliveryConfirmationPending: true,
      deliveryTransportIdempotent: false,
      status: 'retryable',
    })
    expect(first.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    })
    expect(setLinqMessageReaction).toHaveBeenCalledTimes(1)
    expect(persistDeliveredIntent).toHaveBeenCalledTimes(1)

    const stillAwaitingConfirmation = await dispatchAssistantOutboxIntent({
      dependencies: {
        setLinqMessageReaction,
      },
      force: true,
      intentId: first.intent.intentId,
      now: new Date('2026-04-08T01:24:00.000Z'),
      vault: vaultRoot,
    })
    expect(stillAwaitingConfirmation.intent).toMatchObject({
      deliveryConfirmationPending: true,
      status: 'retryable',
    })
    expect(setLinqMessageReaction).toHaveBeenCalledTimes(1)

    const resolveDeliveredIntent = vi.fn(async (input: {
      intent: AssistantOutboxIntent
    }) => input.intent.delivery)
    const confirmed = await dispatchAssistantOutboxIntent({
      dependencies: {
        setLinqMessageReaction,
      },
      dispatchHooks: {
        resolveDeliveredIntent,
      },
      force: true,
      intentId: first.intent.intentId,
      now: new Date('2026-04-08T01:25:00.000Z'),
      vault: vaultRoot,
    })

    expect(confirmed.intent.status).toBe('sent')
    expect(confirmed.intent.answeredMailboxItemIds).toEqual([
      'mailbox-linq-reaction-confirmation',
    ])
    expect(resolveDeliveredIntent).toHaveBeenCalledTimes(1)
    expect(setLinqMessageReaction).toHaveBeenCalledTimes(1)
  })

  it('recovers a stale accepted Linq reaction receipt without replaying the provider', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-reaction-crash-recovery-',
    )
    const queued = await deliverAssistantOutboxReaction({
      answeredMailboxItemIds: ['mailbox-linq-reaction-crash'],
      channel: 'linq',
      dispatchMode: 'queue-only',
      explicitTarget: 'linq-chat-crash',
      reaction: 'heart',
      sessionId: 'session-linq-reaction-crash',
      targetMessageId: 'linq-message-crash',
      turnId: 'turn-linq-reaction-crash',
      vault: vaultRoot,
    })
    const deliveryIdempotencyKey =
      `assistant-outbox:${queued.intent.intentId}`
    await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      attemptCount: 1,
      delivery: {
        channel: 'linq',
        idempotencyKey: deliveryIdempotencyKey,
        kind: 'message-reaction',
        reaction: 'heart',
        sentAt: '2026-04-08T01:00:01.000Z',
        target: 'linq-chat-crash',
        targetKind: 'thread',
        targetMessageId: 'linq-message-crash',
      },
      deliveryIdempotencyKey,
      deliveryTransportIdempotent: false,
      lastAttemptAt: '2026-04-08T01:00:00.000Z',
      lastError: null,
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T01:00:01.000Z',
    })
    const setLinqMessageReaction = vi.fn()
    const resolveDeliveredIntent = vi.fn(async (input: {
      intent: AssistantOutboxIntent
    }) => input.intent.delivery)

    const recovered = await dispatchAssistantOutboxIntent({
      dependencies: {
        setLinqMessageReaction,
      },
      dispatchHooks: {
        resolveDeliveredIntent,
      },
      intentId: queued.intent.intentId,
      now: new Date('2026-04-08T01:20:00.000Z'),
      vault: vaultRoot,
    })

    expect(recovered.intent.status).toBe('sent')
    expect(recovered.intent.answeredMailboxItemIds).toEqual([
      'mailbox-linq-reaction-crash',
    ])
    expect(resolveDeliveredIntent).toHaveBeenCalledTimes(1)
    expect(setLinqMessageReaction).not.toHaveBeenCalled()
  })

  it('keeps deduped Linq reaction updates non-idempotent', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-reaction-update-',
    )
    const setLinqMessageReaction = vi.fn(async (input: {
      reaction: 'heart' | 'thumbs_up' | 'laugh'
      target: string
      targetMessageId: string
    }) => ({
      reaction: input.reaction,
      target: input.target,
      targetKind: 'thread' as const,
      targetMessageId: input.targetMessageId,
    }))

    const queued = await deliverAssistantOutboxReaction({
      channel: 'linq',
      dedupeToken: 'linq-reaction-slot',
      dispatchMode: 'queue-only',
      explicitTarget: 'linq-chat-update',
      reaction: 'heart',
      sessionId: 'session-linq-reaction-update',
      targetMessageId: 'linq-message-old',
      turnId: 'turn-linq-reaction-update',
      vault: vaultRoot,
    })
    expect(queued.kind).toBe('queued')
    expect(queued.intent.deliveryTransportIdempotent).toBe(false)

    const retryable = await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T01:00:00.000Z',
      lastError: {
        code: 'ASSISTANT_LINQ_REACTION_FAILED',
        message: 'old reaction failed',
      },
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T01:00:00.000Z',
    })

    const sent = await deliverAssistantOutboxReaction({
      answeredMailboxItemIds: ['mailbox-linq-reaction-update'],
      channel: 'linq',
      dedupeToken: 'linq-reaction-slot',
      dependencies: {
        setLinqMessageReaction,
      },
      explicitTarget: 'linq-chat-update',
      reaction: 'laugh',
      sessionId: retryable.sessionId,
      targetMessageId: 'linq-message-new',
      turnId: retryable.turnId,
      vault: vaultRoot,
    })

    expect(sent.kind).toBe('sent')
    expect(sent.intent.intentId).toBe(queued.intent.intentId)
    expect(sent.intent.answeredMailboxItemIds).toEqual([
      'mailbox-linq-reaction-update',
    ])
    expect(sent.intent.deliveryTransportIdempotent).toBe(false)
    expect(sent.intent.operation).toEqual({
      kind: 'message-reaction',
      reaction: 'laugh',
    })
    expect(sent.intent.replyToMessageId).toBe('linq-message-new')
    await expect(
      readAssistantOutboxIntent(vaultRoot, queued.intent.intentId),
    ).resolves.toMatchObject({
      answeredMailboxItemIds: ['mailbox-linq-reaction-update'],
      deliveryTransportIdempotent: false,
      operation: {
        kind: 'message-reaction',
        reaction: 'laugh',
      },
      replyToMessageId: 'linq-message-new',
    })
    expect(setLinqMessageReaction).toHaveBeenCalledTimes(1)
  })

  it('rederives Linq reaction idempotency on unchanged dedupe hits', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-reaction-dedupe-idempotency-',
    )
    const setLinqMessageReaction = vi.fn(async (input: {
      reaction: 'heart' | 'thumbs_up' | 'laugh'
      target: string
      targetMessageId: string
    }) => ({
      reaction: input.reaction,
      target: input.target,
      targetKind: 'thread' as const,
      targetMessageId: input.targetMessageId,
    }))

    const queued = await deliverAssistantOutboxReaction({
      channel: 'linq',
      dedupeToken: 'linq-reaction-same-slot',
      dispatchMode: 'queue-only',
      explicitTarget: 'linq-chat-same',
      reaction: 'heart',
      sessionId: 'session-linq-reaction-same',
      targetMessageId: 'linq-message-same',
      turnId: 'turn-linq-reaction-same',
      vault: vaultRoot,
    })
    expect(queued.kind).toBe('queued')

    const retryable = await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      attemptCount: 1,
      deliveryTransportIdempotent: true,
      lastAttemptAt: '2026-04-08T01:00:00.000Z',
      lastError: {
        code: 'ASSISTANT_LINQ_REACTION_FAILED',
        message: 'legacy idempotency flag',
      },
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T01:00:00.000Z',
    })

    const sent = await deliverAssistantOutboxReaction({
      channel: 'linq',
      dedupeToken: 'linq-reaction-same-slot',
      dependencies: {
        setLinqMessageReaction,
      },
      explicitTarget: 'linq-chat-same',
      reaction: 'heart',
      sessionId: retryable.sessionId,
      targetMessageId: 'linq-message-same',
      turnId: retryable.turnId,
      vault: vaultRoot,
    })

    expect(sent.kind).toBe('sent')
    expect(sent.intent.intentId).toBe(queued.intent.intentId)
    expect(sent.intent.deliveryTransportIdempotent).toBe(false)
    await expect(
      readAssistantOutboxIntent(vaultRoot, queued.intent.intentId),
    ).resolves.toMatchObject({
      deliveryTransportIdempotent: false,
      operation: {
        kind: 'message-reaction',
        reaction: 'heart',
      },
      replyToMessageId: 'linq-message-same',
    })
    expect(setLinqMessageReaction).toHaveBeenCalledTimes(1)
  })

  it('fails closed instead of redispatching stale non-idempotent Linq reactions', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-reaction-stale-sending-',
    )
    const setLinqMessageReaction = vi.fn(async (input: {
      reaction: 'heart' | 'thumbs_up' | 'laugh'
      target: string
      targetMessageId: string
    }) => ({
      reaction: input.reaction,
      target: input.target,
      targetKind: 'thread' as const,
      targetMessageId: input.targetMessageId,
    }))

    const queued = await deliverAssistantOutboxReaction({
      channel: 'linq',
      dispatchMode: 'queue-only',
      explicitTarget: 'linq-chat-stale',
      reaction: 'heart',
      sessionId: 'session-linq-reaction-stale',
      targetMessageId: 'linq-message-stale',
      turnId: 'turn-linq-reaction-stale',
      vault: vaultRoot,
    })
    expect(queued.intent.deliveryTransportIdempotent).toBe(false)
    await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      attemptCount: 1,
      delivery: null,
      deliveryConfirmationPending: false,
      lastAttemptAt: '2026-04-08T01:00:00.000Z',
      lastError: null,
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T01:00:00.000Z',
    })

    const failed = await dispatchAssistantOutboxIntent({
      dependencies: {
        setLinqMessageReaction,
      },
      intentId: queued.intent.intentId,
      now: new Date('2026-04-08T01:20:00.000Z'),
      vault: vaultRoot,
    })

    expect(failed.intent.status).toBe('failed')
    expect(failed.intent.deliveryTransportIdempotent).toBe(false)
    expect(failed.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })
    expect(setLinqMessageReaction).not.toHaveBeenCalled()
  })

  it('abandons post-dispatch Linq reaction transport ambiguity without retrying', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-reaction-transport-ambiguous-',
    )
    const queued = await deliverAssistantOutboxReaction({
      channel: 'linq',
      dispatchMode: 'queue-only',
      explicitTarget: 'linq-chat-ambiguous',
      reaction: 'heart',
      sessionId: 'session-linq-reaction-ambiguous',
      targetMessageId: 'linq-message-ambiguous',
      turnId: 'turn-linq-reaction-ambiguous',
      vault: vaultRoot,
    })
    expect(queued.intent.deliveryTransportIdempotent).toBe(false)

    const setLinqMessageReaction = vi.fn(async () => {
      throw Object.assign(
        new VaultCliError(
          'LINQ_API_REQUEST_FAILED',
          'Linq request POST /messages/linq-message-ambiguous/reactions failed before a response was returned.',
          {
            failureStage: 'transport',
            operation: 'set_message_reaction',
            provider: 'linq',
            retryable: false,
          },
        ),
        {
          deliveryMayHaveSucceeded: true,
        },
      )
    })

    const abandoned = await dispatchAssistantOutboxIntent({
      dependencies: {
        setLinqMessageReaction,
      },
      force: true,
      intentId: queued.intent.intentId,
      now: new Date('2026-04-08T01:25:00.000Z'),
      vault: vaultRoot,
    })

    expect(abandoned.intent.status).toBe('abandoned')
    expect(abandoned.intent.deliveryConfirmationPending).toBe(false)
    expect(abandoned.intent.deliveryTransportIdempotent).toBe(false)
    expect(abandoned.intent.nextAttemptAt).toBeNull()
    expect(abandoned.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })
    expect(setLinqMessageReaction).toHaveBeenCalledTimes(1)
  })

  it('updates an unsent deduped reaction intent before dispatching it', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-reaction-update-')
    const setTelegramMessageReaction = vi.fn(async (input: {
      reaction: 'heart' | 'thumbs_up' | 'laugh'
      target: string
      targetMessageId: string
    }) => ({
      reaction: input.reaction,
      target: input.target,
      targetKind: 'explicit' as const,
      targetMessageId: input.targetMessageId,
    }))

    const queued = await deliverAssistantOutboxReaction({
      channel: 'telegram',
      dedupeToken: 'reaction-slot',
      dispatchMode: 'queue-only',
      explicitTarget: '123',
      reaction: 'heart',
      sessionId: 'session-reaction-update',
      targetMessageId: '45',
      turnId: 'turn-reaction-update',
      vault: vaultRoot,
    })
    const retryable = await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      attemptCount: 2,
      lastAttemptAt: '2026-04-08T01:00:00.000Z',
      lastError: {
        code: 'ASSISTANT_TELEGRAM_REACTION_FAILED',
        message: 'old reaction failed',
      },
      nextAttemptAt: '2099-01-01T00:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T01:00:00.000Z',
    })

    const sent = await deliverAssistantOutboxReaction({
      channel: 'telegram',
      dedupeToken: 'reaction-slot',
      dependencies: {
        setTelegramMessageReaction,
      },
      explicitTarget: '123',
      reaction: 'thumbs_up',
      sessionId: retryable.sessionId,
      targetMessageId: '45',
      turnId: retryable.turnId,
      vault: vaultRoot,
    })

    expect(sent.kind).toBe('sent')
    expect(sent.intent.intentId).toBe(queued.intent.intentId)
    expect(sent.intent.operation).toEqual({
      kind: 'message-reaction',
      reaction: 'thumbs_up',
    })
    expect(sent.intent.lastError).toBeNull()
    expect(sent.delivery).toMatchObject({
      kind: 'message-reaction',
      reaction: 'thumbs_up',
      target: '123',
      targetMessageId: '45',
    })
    expect(setTelegramMessageReaction).toHaveBeenCalledTimes(1)
    expect(setTelegramMessageReaction).toHaveBeenCalledWith({
      reaction: 'thumbs_up',
      signal: undefined,
      target: '123',
      targetMessageId: '45',
    })
  })

  it('rejects a deduped reaction target change after its safe mutation window', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-reaction-target-immutable-',
    )
    const queued = await deliverAssistantOutboxReaction({
      channel: 'telegram',
      dedupeToken: 'reaction-target-immutable',
      dispatchMode: 'queue-only',
      explicitTarget: '123',
      reaction: 'heart',
      sessionId: 'session-reaction-target-immutable',
      targetMessageId: '45',
      turnId: 'turn-reaction-target-immutable',
      vault: vaultRoot,
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T01:00:00.000Z',
      nextAttemptAt: null,
      preparedDispatchToken: 'prepared-reaction-target-immutable',
      status: 'sending',
      updatedAt: '2026-04-08T01:00:00.000Z',
    })
    const setTelegramMessageReaction = vi.fn()

    await expect(deliverAssistantOutboxReaction({
      channel: 'telegram',
      dedupeToken: 'reaction-target-immutable',
      dependencies: {
        setTelegramMessageReaction,
      },
      explicitTarget: '123',
      reaction: 'thumbs_up',
      sessionId: 'session-reaction-target-immutable',
      targetMessageId: '46',
      turnId: 'turn-reaction-target-immutable',
      vault: vaultRoot,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    })
    expect(setTelegramMessageReaction).not.toHaveBeenCalled()
    await expect(readAssistantOutboxIntent(vaultRoot, queued.intent.intentId)).resolves
      .toMatchObject({
        operation: {
          kind: 'message-reaction',
          reaction: 'heart',
        },
        preparedDispatchToken: 'prepared-reaction-target-immutable',
        replyToMessageId: '45',
        status: 'sending',
      })
  })

  it('dispatches and persists media-only Linq voice memo intents', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-voice-media-only-')
    const media = [createVoiceMemoMedia()]
    const seeded = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'thread-linq-voice',
      media,
      message: '   ',
      sessionId: 'session-voice-media-only',
      turnId: 'turn-voice-media-only',
    })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: null,
        messageLength: 0,
        providerMessageId: 'linq-voice-message',
        providerMessageEffects: [
          {
            message: null,
            providerMessageId: 'linq-voice-message',
          },
        ],
        providerThreadId: 'thread-linq-voice',
        sentAt: '2026-04-08T03:30:00.000Z',
        target: 'thread-linq-voice',
        targetKind: 'explicit',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T03:30:00.000Z'),
      vault: vaultRoot,
    })

    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'linq',
        media,
        message: '',
        target: 'thread-linq-voice',
      }),
      undefined,
    )
    expect(dispatched.intent.status).toBe('sent')
    expect(dispatched.intent.delivery).toMatchObject({
      channel: 'linq',
      idempotencyKey: `assistant-outbox:${seeded.intentId}`,
      messageLength: 0,
      providerMessageId: 'linq-voice-message',
      providerMessageEffects: [
        {
          message: null,
          providerMessageId: 'linq-voice-message',
        },
      ],
      target: 'thread-linq-voice',
    })
    expect(dispatched.intent.media).toEqual(media)
  })

  it('keeps duplicate same-text segment bubbles distinct by dedupe token', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-segment-outbox-dedupe-',
    )

    await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dedupeToken: 'assistant-segment:turn-duplicate-text:0',
      dispatchMode: 'queue-only',
      media: [],
      message: 'Done.',
      sessionId: 'session-duplicate-text',
      threadId: 'thread-duplicate-text',
      turnId: 'turn-duplicate-text',
      vault: vaultRoot,
    })
    await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dedupeToken: 'assistant-segment:turn-duplicate-text:1',
      dispatchMode: 'queue-only',
      media: [],
      message: 'Done.',
      sessionId: 'session-duplicate-text',
      threadId: 'thread-duplicate-text',
      turnId: 'turn-duplicate-text',
      vault: vaultRoot,
    })
    await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dedupeToken: 'assistant-segment:turn-duplicate-text:1',
      dispatchMode: 'queue-only',
      media: [],
      message: 'Done again.',
      sessionId: 'session-duplicate-text',
      threadId: 'thread-duplicate-text',
      turnId: 'turn-duplicate-text-retry',
      vault: vaultRoot,
    })

    const intents = await listAssistantOutboxIntentsLocal(vaultRoot)
    expect(intents.map((intent) => intent.message)).toEqual(['Done.', 'Done.'])
    expect(new Set(intents.map((intent) => intent.intentId)).size).toBe(2)
  })

  it('persists inferred Linq thread delivery on queue-only intents before dispatch', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-thread-inferred-',
    )

    const queued = await deliverAssistantOutboxMessage({
      answeredMailboxItemIds: [
        'mailbox_item_prepared_retry_1',
        'mailbox_item_prepared_retry_2',
      ],
      channel: 'linq',
      dispatchMode: 'queue-only',
      message: 'queue the Linq reminder',
      sessionId: 'session-linq-thread-inferred',
      threadId: 'linq-thread-inferred',
      threadIsDirect: true,
      turnId: 'turn-linq-thread-inferred',
      vault: vaultRoot,
    })

    expect(queued.kind).toBe('queued')
    expect(queued.intent.answeredMailboxItemIds).toEqual([
      'mailbox_item_prepared_retry_1',
      'mailbox_item_prepared_retry_2',
    ])
    expect(queued.intent.bindingDelivery).toEqual({
      kind: 'thread',
      target: 'linq-thread-inferred',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: queued.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-linq-thread-inferred',
        providerThreadId: 'linq-thread-inferred',
        sentAt: '2026-04-08T03:03:00.000Z',
        target: 'linq-thread-inferred',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      intentId: queued.intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.deliveryError).toBeNull()
    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds: [
          'mailbox_item_prepared_retry_1',
          'mailbox_item_prepared_retry_2',
        ],
        session: {
          binding: expect.objectContaining({
            channel: 'linq',
            delivery: {
              kind: 'thread',
              target: 'linq-thread-inferred',
            },
            threadId: 'linq-thread-inferred',
            threadIsDirect: true,
          }),
        },
      }),
      undefined,
    )
  })

  it('persists inferred Telegram thread delivery on queue-only intents before dispatch', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-telegram-thread-inferred-',
    )

    const queued = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dispatchMode: 'queue-only',
      message: 'queue the Telegram reminder',
      sessionId: 'session-telegram-thread-inferred',
      threadId: 'telegram-thread-inferred',
      threadIsDirect: true,
      turnId: 'turn-telegram-thread-inferred',
      vault: vaultRoot,
    })

    expect(queued.kind).toBe('queued')
    expect(queued.intent.bindingDelivery).toEqual({
      kind: 'thread',
      target: 'telegram-thread-inferred',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'telegram',
        idempotencyKey: queued.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-telegram-thread-inferred',
        sentAt: '2026-04-08T03:03:00.000Z',
        target: 'telegram-thread-inferred',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      intentId: queued.intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.deliveryError).toBeNull()
    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        session: {
          binding: expect.objectContaining({
            channel: 'telegram',
            delivery: {
              kind: 'thread',
              target: 'telegram-thread-inferred',
            },
            threadId: 'telegram-thread-inferred',
            threadIsDirect: true,
          }),
        },
      }),
      undefined,
    )
  })

  it('dispatches a legacy queued intent with no automation authority field', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-legacy-no-automation-authority-',
    )
    const queued = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'Legacy queued reminder.',
      sessionId: 'session-legacy-no-automation-authority',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-legacy-no-automation-authority',
      vault: vaultRoot,
    })
    const {
      automationAuthority: ignoredAutomationAuthority,
      ...legacyIntent
    } = queued.intent
    void ignoredAutomationAuthority
    await saveAssistantOutboxIntent(vaultRoot, legacyIntent)
    await expect(
      readRawOutboxIntent(vaultRoot, queued.intent.intentId),
    ).resolves.not.toHaveProperty('automationAuthority')

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'telegram',
        idempotencyKey: queued.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-legacy-no-automation-authority',
        sentAt: '2026-07-16T12:02:00.000Z',
        target: 'telegram-chat',
        targetKind: 'explicit',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sent')
    expect(dispatched.deliveryError).toBeNull()
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
  })

  it('fails an active revision-matching retired Sunday intent before provider entry', async () => {
    const retiredAutomationId = 'automation_01K55N7S9X4Q2M6P8R3T0V1WYZ'
    const { vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-retired-sunday-',
    )
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      automationId: retiredAutomationId,
      continuityPolicy: 'fresh',
      instructions: 'Legacy Sunday group superlatives instructions.',
      now: new Date('2026-07-26T17:59:00.000Z'),
      route: {
        ...scaffold.route,
        deliveryTarget: 'telegram-group-thread',
        threadId: 'telegram-group-thread',
        threadIsDirect: false,
      },
      schedule: { kind: 'cron', expression: '0 18 * * 0' },
      slug: 'group-sunday-superlatives',
      status: 'active',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Sunday group superlatives',
      vaultRoot,
    })
    const queued = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-group-thread',
      message: 'Legacy Sunday group superlatives.',
      sessionId: 'session-outbox-retired-sunday',
      threadId: 'telegram-group-thread',
      threadIsDirect: false,
      turnId: 'turn-outbox-retired-sunday',
      vault: vaultRoot,
    })

    expect(queued.intent).toMatchObject({
      automationAuthority: {
        automationId: retiredAutomationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      status: 'pending',
    })
    await expect(showAutomation({
      automationId: retiredAutomationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: retiredAutomationId,
      status: 'active',
      updatedAt: automation.record.updatedAt,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      now: new Date('2026-07-26T18:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('failed')
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('revalidates answered onboarding when a queued goal check-in reaches provider entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T17:31:00.000Z'))
    const { vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-onboarding-goal-checkin-',
    )
    await completeAssistantOnboarding({
      completedAt: '2026-06-01T17:30:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      activeUntil: '2026-07-27T17:30:00.000Z',
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      continuityPolicy: 'preserve',
      instructions: 'Offer one low-pressure health direction choice.',
      now: new Date('2026-07-20T17:29:00.000Z'),
      schedule: {
        at: '2026-07-20T17:30:00.000Z',
        kind: 'at',
      },
      slug: 'onboarding-goal-choice-point',
      status: 'active',
      tags: ['assistant', 'scheduled', 'murph-managed'],
      title: 'Onboarding goal choice point',
      vaultRoot,
    })
    const eligible = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'Eligible onboarding goal check-in.',
      sessionId: 'session-outbox-onboarding-eligible',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-outbox-onboarding-eligible',
      vault: vaultRoot,
    })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        idempotencyKey: eligible.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-onboarding-goal-checkin',
        sentAt: '2026-07-20T17:31:00.000Z',
        target: 'telegram-chat',
        targetKind: 'explicit',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const sent = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: eligible.intent.intentId,
      vault: vaultRoot,
    })
    expect(sent.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()

    const temporarilyUnavailable = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'Retryable onboarding goal check-in.',
      sessionId: 'session-outbox-onboarding-unavailable',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-outbox-onboarding-unavailable',
      vault: vaultRoot,
    })
    await writeFile(
      resolveAssistantOnboardingStatePath(vaultRoot),
      '{not valid json',
      'utf8',
    )

    const retryable = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: temporarilyUnavailable.intent.intentId,
      vault: vaultRoot,
    })
    expect(retryable.intent.status).toBe('retryable')
    expect(retryable.deliveryError).toMatchObject({
      code: 'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()

    await completeAssistantOnboarding({
      completedAt: '2026-06-01T17:30:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        idempotencyKey:
          temporarilyUnavailable.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-onboarding-goal-checkin-retry',
        sentAt: '2026-07-20T17:32:00.000Z',
        target: 'telegram-chat',
        targetKind: 'explicit',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })
    const sentAfterRestore = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: temporarilyUnavailable.intent.intentId,
      vault: vaultRoot,
    })
    expect(sentAfterRestore.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(2)

    const revoked = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'Revoked onboarding goal check-in.',
      sessionId: 'session-outbox-onboarding-revoked',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-outbox-onboarding-revoked',
      vault: vaultRoot,
    })
    await reopenAssistantOnboarding({
      reopenedAt: '2026-07-20T17:31:30.000Z',
      vault: vaultRoot,
    })
    await expect(showAutomation({
      automationId: MURPH_ONBOARDING_GOAL_CHECKIN_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      status: 'active',
      updatedAt: automation.record.updatedAt,
    })

    const blocked = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: revoked.intent.intentId,
      vault: vaultRoot,
    })
    expect(blocked.intent.status).toBe('failed')
    expect(blocked.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(2)
  })

  it('revalidates unfinished onboarding when a queued follow-up reaches provider entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-20T17:31:00.000Z'))
    const { vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-onboarding-followup-authority-',
    )
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      activeUntil: '2026-07-22T19:00:00.000Z',
      continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
      instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
      now: new Date('2026-07-20T17:29:00.000Z'),
      schedule: {
        kind: 'dailyLocal',
        localTime: '13:30',
      },
      slug: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.slug,
      status: 'active',
      summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
      tags: [...MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags],
      title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      vaultRoot,
    })
    const queueFollowup = (suffix: string) => deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: `Onboarding follow-up ${suffix}.`,
      sessionId: `session-outbox-onboarding-followup-${suffix}`,
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: `turn-outbox-onboarding-followup-${suffix}`,
      vault: vaultRoot,
    })
    const eligible = await queueFollowup('eligible')
    const temporarilyUnavailable = await queueFollowup('unavailable')
    const completedBeforeDelivery = await queueFollowup('completed')

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        idempotencyKey: eligible.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-onboarding-followup',
        sentAt: '2026-07-20T17:31:00.000Z',
        target: 'telegram-chat',
        targetKind: 'explicit',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })
    const sent = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: eligible.intent.intentId,
      vault: vaultRoot,
    })
    expect(sent.intent.status).toBe('sent')

    await mkdir(
      path.dirname(resolveAssistantOnboardingStatePath(vaultRoot)),
      { recursive: true },
    )
    await writeFile(
      resolveAssistantOnboardingStatePath(vaultRoot),
      '{not valid json',
      'utf8',
    )
    const retryable = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: temporarilyUnavailable.intent.intentId,
      vault: vaultRoot,
    })
    expect(retryable.intent.status).toBe('retryable')
    expect(retryable.deliveryError).toMatchObject({
      code: 'ASSISTANT_ONBOARDING_AUTHORITY_UNAVAILABLE',
    })

    await completeAssistantOnboarding({
      completedAt: '2026-07-20T17:32:00.000Z',
      reason: 'user_answered',
      vault: vaultRoot,
    })
    const blocked = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: completedBeforeDelivery.intent.intentId,
      vault: vaultRoot,
    })
    expect(blocked.intent.status).toBe('failed')
    expect(blocked.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
  })

  it.each(onboardingFollowupPredecessorDefinitions)(
    'makes a queued $label predecessor terminally stale until managed reconciliation completes',
    async ({ definition, label, schedule }) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-04-09T13:31:00.000Z'))
      const { paths, vaultRoot } = await createInitializedAssistantVault(
        `assistant-outbox-onboarding-predecessor-${label.replaceAll(' ', '-')}-`,
      )
      const opaqueSuffix = label.replaceAll(' ', '-')
      const automation = await upsertAutomation({
        continuityPolicy: definition.continuityPolicy,
        instructions: definition.instructions,
        now: new Date('2026-04-08T15:00:00.000Z'),
        route: {
          channel: 'telegram',
          deliveryTarget: 'telegram-chat',
          identityId: null,
          participantId: null,
          threadId: null,
        },
        schedule,
        slug: definition.slug,
        status: 'active',
        summary: definition.summary,
        tags: [...definition.tags],
        title: definition.title,
        vaultRoot,
      })
      const queued = await deliverAssistantOutboxMessage({
        automationAuthority: {
          automationId: automation.record.automationId,
          expectedUpdatedAt: automation.record.updatedAt,
        },
        channel: 'telegram',
        dispatchMode: 'queue-only',
        explicitTarget: 'telegram-chat',
        message: `Queued ${label} predecessor.`,
        sessionId: `session-outbox-onboarding-predecessor-${opaqueSuffix}`,
        threadId: 'telegram-chat',
        threadIsDirect: true,
        turnId: `turn-outbox-onboarding-predecessor-${opaqueSuffix}`,
        vault: vaultRoot,
      })
      const occurrenceAt = schedule.kind === 'at'
        ? schedule.at
        : '2026-04-09T13:30:00.000Z'
      const runtimeRecord = createAssistantCronCanonicalRuntimeRecord({
        jobId: automation.record.automationId,
        now: automation.record.updatedAt,
      })
      runtimeRecord.updatedAt = automation.record.updatedAt
      runtimeRecord.state.lastRunAt = occurrenceAt
      runtimeRecord.state.pendingDeliveryIntentId = queued.intent.intentId
      runtimeRecord.state.pendingOccurrenceAt = occurrenceAt
      await writeAssistantCronCanonicalRuntimeStore(paths, {
        jobs: [runtimeRecord],
        version: 1,
      })

      await applyMurphManagedAutomations({
        defaultRoute: automation.record.route,
        now: new Date('2026-04-09T13:31:00.000Z'),
        vaultRoot,
      })
      await expect(showAutomation({
        automationId: automation.record.automationId,
        vaultRoot,
      })).resolves.toMatchObject({
        instructions: definition.instructions,
        schedule,
        status: 'active',
      })

      const blocked = await dispatchAssistantOutboxIntent({
        force: true,
        intentId: queued.intent.intentId,
        vault: vaultRoot,
      })

      expect(blocked.intent.status).toBe('failed')
      expect(blocked.deliveryError).toMatchObject({
        code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
      })
      expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
      await expect(showAutomation({
        automationId: automation.record.automationId,
        vaultRoot,
      })).resolves.toMatchObject({
        instructions: definition.instructions,
        schedule,
        status: 'active',
      })
      const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
      expect(runtimeStore.jobs).toContainEqual(expect.objectContaining({
        jobId: automation.record.automationId,
        state: expect.objectContaining({
          consecutiveFailures: 1,
          pendingOccurrenceAt: occurrenceAt,
          retryAfterAt: expect.any(String),
        }),
      }))
      expect(
        runtimeStore.jobs[0]?.state.pendingDeliveryIntentId,
      ).toBeUndefined()

      await applyMurphManagedAutomations({
        defaultRoute: automation.record.route,
        now: new Date('2026-04-09T13:32:00.000Z'),
        vaultRoot,
      })
      const convertedAutomation = await showAutomation({
        automationId: automation.record.automationId,
        vaultRoot,
      })
      expect(convertedAutomation).toMatchObject({
        continuityPolicy: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.continuityPolicy,
        instructions: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
        schedule: expect.objectContaining({ kind: 'dailyLocal' }),
        status: 'active',
        summary: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.summary,
        tags: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.tags,
        title: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.title,
      })
      if (convertedAutomation?.schedule.kind !== 'dailyLocal') {
        throw new Error('Expected the predecessor to use the current daily schedule.')
      }
      const convertedRuntimeStore =
        await readAssistantCronCanonicalRuntimeStore(paths)
      expect(convertedRuntimeStore.jobs).toContainEqual(expect.objectContaining({
        jobId: automation.record.automationId,
        state: expect.objectContaining({
          activatedAt: schedule.kind === 'at'
            ? '2026-04-09T13:32:00.000Z'
            : automation.record.createdAt,
          pendingOccurrenceAt: occurrenceAt,
        }),
      }))
      const expectedNextRunAt = schedule.kind === 'every'
        ? computeAssistantCronNextRunAt(
            {
              kind: 'dailyLocal',
              localTime: convertedAutomation.schedule.localTime,
              timeZone: 'UTC',
            },
            new Date('2026-04-09T13:32:00.000Z'),
          )
        : '2026-04-09T13:31:30.000Z'
      await expect(listAssistantCronJobs(vaultRoot)).resolves.toContainEqual(
        expect.objectContaining({
          jobId: automation.record.automationId,
          prompt: MURPH_ONBOARDING_FOLLOWUP_AUTOMATION.instructions,
          state: expect.objectContaining({
            nextRunAt: expectedNextRunAt,
          }),
        }),
      )
    },
  )

  it('blocks a queued one-shot at activeUntil before provider entry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T14:20:00.000Z'))
    const { vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-active-until-',
    )
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      activeUntil: '2026-07-16T14:30:00.000Z',
      now: new Date('2026-07-16T14:20:00.000Z'),
      schedule: {
        at: '2026-07-16T14:29:00.000Z',
        kind: 'at',
      },
      slug: 'outbox-active-until-authority',
      title: 'Outbox active-until authority',
      vaultRoot,
    })
    const queued = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'This one-shot must not send after its window.',
      sessionId: 'session-outbox-active-until',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-outbox-active-until',
      vault: vaultRoot,
    })

    vi.setSystemTime(new Date('2026-07-16T14:30:00.000Z'))
    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('failed')
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    await expect(showAutomation({
      automationId: automation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      status: 'archived',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'paused', status: 'paused' as const },
    { label: 'stopped', status: 'archived' as const },
  ])('blocks a queued automation after it is $label', async ({ status }) => {
    const { vaultRoot } = await createInitializedAssistantVault(
      `assistant-outbox-automation-${status}-`,
    )
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      now: new Date('2026-07-16T12:00:00.000Z'),
      slug: `outbox-${status}-authority`,
      title: `Outbox ${status} authority`,
      vaultRoot,
    })
    const queued = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'This reminder should no longer send.',
      sessionId: `session-outbox-${status}`,
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: `turn-outbox-${status}`,
      vault: vaultRoot,
    })

    await patchAutomation({
      lookup: automation.record.automationId,
      now: new Date('2026-07-16T12:01:00.000Z'),
      status,
      vaultRoot,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      now: new Date('2026-07-16T12:02:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('failed')
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('requires active status even when a queued intent names the current paused revision', async () => {
    const { vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-current-paused-automation-',
    )
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      now: new Date('2026-07-16T12:00:00.000Z'),
      slug: 'outbox-current-paused-authority',
      title: 'Outbox current paused authority',
      vaultRoot,
    })
    const paused = await patchAutomation({
      lookup: automation.record.automationId,
      now: new Date('2026-07-16T12:01:00.000Z'),
      status: 'paused',
      vaultRoot,
    })
    const queued = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: paused.record.automationId,
        expectedUpdatedAt: paused.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'A paused automation cannot authorize a queued send.',
      sessionId: 'session-outbox-current-paused',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-outbox-current-paused',
      vault: vaultRoot,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      now: new Date('2026-07-16T12:02:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('failed')
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('blocks a queued automation after its active definition is edited', async () => {
    const { vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-edited-automation-',
    )
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      now: new Date('2026-07-16T12:00:00.000Z'),
      slug: 'outbox-edited-authority',
      title: 'Outbox edited authority',
      vaultRoot,
    })
    const queued = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'This stale-definition reminder should not send.',
      sessionId: 'session-outbox-edited',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-outbox-edited',
      vault: vaultRoot,
    })

    await patchAutomation({
      instructions: 'Use the newly edited reminder definition.',
      lookup: automation.record.automationId,
      now: new Date('2026-07-16T12:01:00.000Z'),
      vaultRoot,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      now: new Date('2026-07-16T12:02:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('failed')
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'paused', status: 'paused' as const },
    { label: 'stopped', status: 'archived' as const },
  ])(
    'suppresses an immediate active send queued by a transient failure after it is $label',
    async ({ status }) => {
      const { vaultRoot } = await createInitializedAssistantVault(
        `assistant-outbox-transient-then-${status}-`,
      )
      const scaffold = scaffoldAutomationPayload()
      const automation = await upsertAutomation({
        ...scaffold,
        now: new Date('2026-07-16T12:00:00.000Z'),
        slug: `outbox-transient-then-${status}`,
        title: `Outbox transient then ${status}`,
        vaultRoot,
      })
      mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
        new VaultCliError(
          'HOSTED_BACKGROUND_DELIVERY_YIELDED',
          'Hosted background delivery yielded before provider entry.',
          {
            assistantDeliveryFailureClass: 'transient',
            retryable: true,
          },
        ),
      )

      const firstAttempt = await deliverAssistantOutboxMessage({
        automationAuthority: {
          automationId: automation.record.automationId,
          expectedUpdatedAt: automation.record.updatedAt,
        },
        channel: 'telegram',
        explicitTarget: 'telegram-chat',
        message: 'Retry this reminder only while it remains active.',
        sessionId: `session-outbox-transient-${status}`,
        threadId: 'telegram-chat',
        threadIsDirect: true,
        turnId: `turn-outbox-transient-${status}`,
        vault: vaultRoot,
      })

      expect(firstAttempt.kind).toBe('queued')
      expect(firstAttempt.intent.status).toBe('retryable')
      expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()

      await patchAutomation({
        lookup: automation.record.automationId,
        now: new Date('2026-07-16T12:01:00.000Z'),
        status,
        vaultRoot,
      })

      const retry = await dispatchAssistantOutboxIntent({
        force: true,
        intentId: firstAttempt.intent.intentId,
        now: new Date('2026-07-16T12:02:00.000Z'),
        vault: vaultRoot,
      })

      expect(retry.intent.status).toBe('failed')
      expect(retry.deliveryError).toMatchObject({
        code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
      })
      expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
    },
  )

  it('blocks a queued plan reminder after support consent is revoked', async () => {
    const { vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-plan-consent-revoked-',
    )
    const experiment = await createExperiment({
      slug: 'queued-reminder-consent-owner',
      startedOn: '2026-07-01',
      title: 'Queued Reminder Consent Owner',
      vaultRoot,
    })
    await updateExperiment({
      assistantSupport: { remindersEnabled: true },
      relativePath: experiment.experiment.relativePath,
      vaultRoot,
    })
    const scaffold = scaffoldAutomationPayload()
    const automation = await upsertAutomation({
      ...scaffold,
      instructions: 'Send only the accepted experiment reminder.',
      now: new Date('2026-07-16T12:00:00.000Z'),
      slug: 'outbox-revoked-plan-reminder',
      supportKind: 'reminder',
      tags: [
        buildAutomationSupportSeriesTag(
          `experiment:${experiment.experiment.id}`,
        ),
      ],
      title: 'Outbox revoked plan reminder',
      vaultRoot,
    })
    const queued = await deliverAssistantOutboxMessage({
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      channel: 'telegram',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      message: 'This revoked reminder should not send.',
      sessionId: 'session-outbox-revoked-plan',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-outbox-revoked-plan',
      vault: vaultRoot,
    })

    await updateExperiment({
      assistantSupport: { remindersEnabled: false },
      relativePath: experiment.experiment.relativePath,
      vaultRoot,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      now: new Date('2026-07-16T12:02:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('failed')
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('rechecks each sequential drain intent at provider time and consumes an expired required send', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-16T12:00:00.000Z'))
    const { paths, vaultRoot } = await createInitializedAssistantVault(
      'assistant-outbox-sequential-authority-expiry-',
    )
    const occurrenceAt = '2026-07-16T12:00:00.000Z'
    const activeUntil = '2026-07-16T12:00:05.000Z'
    const automation = await upsertAutomation({
      ...scaffoldAutomationPayload(),
      activeUntil,
      instructions: 'Send the bounded final check-in once.',
      now: new Date('2026-07-16T11:59:00.000Z'),
      schedule: {
        at: occurrenceAt,
        kind: 'at',
      },
      slug: 'sequential-authority-expiry',
      tags: [
        'assistant',
        'scheduled',
        'system:assistant-require-send',
      ],
      title: 'Sequential authority expiry',
      vaultRoot,
    })
    await createIntent(vaultRoot, {
      createdAt: '2026-07-16T11:59:58.000Z',
      message: 'Earlier slow delivery.',
      sessionId: 'session-sequential-slow',
      turnId: 'turn-sequential-slow',
    })
    const expiringIntent = await createIntent(vaultRoot, {
      automationAuthority: {
        automationId: automation.record.automationId,
        expectedUpdatedAt: automation.record.updatedAt,
      },
      createdAt: '2026-07-16T11:59:59.000Z',
      message: 'Bounded required delivery.',
      sessionId: 'session-sequential-expiring',
      turnId: 'turn-sequential-expiring',
    })
    const runtimeRecord = createAssistantCronCanonicalRuntimeRecord({
      jobId: automation.record.automationId,
      now: automation.record.updatedAt,
    })
    runtimeRecord.updatedAt = occurrenceAt
    runtimeRecord.state.lastRunAt = occurrenceAt
    runtimeRecord.state.pendingDeliveryIntentId = expiringIntent.intentId
    runtimeRecord.state.pendingOccurrenceAt = occurrenceAt
    await writeAssistantCronCanonicalRuntimeStore(paths, {
      jobs: [runtimeRecord],
      version: 1,
    })

    let markFirstProviderEntered: (() => void) | undefined
    const firstProviderEntered = new Promise<void>((resolve) => {
      markFirstProviderEntered = resolve
    })
    mockedDeliverAssistantMessageOverBinding.mockImplementationOnce(
      async () => {
        markFirstProviderEntered?.()
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 6_000)
        })
        return {
          delivery: createDelivery({
            providerMessageId: 'provider-sequential-slow',
            sentAt: new Date().toISOString(),
          }),
          deliveryDeduplicated: false,
          deliveryTransportIdempotent: false,
          outboxIntentId: null,
          session: undefined,
        }
      },
    )

    const drain = drainAssistantOutboxLocal({
      limit: 2,
      now: new Date(),
      vault: vaultRoot,
    })
    await firstProviderEntered
    await vi.advanceTimersByTimeAsync(6_000)

    await expect(drain).resolves.toEqual({
      attempted: 2,
      failed: 1,
      queued: 0,
      sent: 1,
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()

    await expect(
      readAssistantOutboxIntent(vaultRoot, expiringIntent.intentId),
    ).resolves.toMatchObject({
      lastError: {
        code: 'ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE',
      },
      status: 'failed',
      updatedAt: '2026-07-16T12:00:06.000Z',
    })
    await expect(showAutomation({
      automationId: automation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      status: 'archived',
    })
    const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
    expect(runtimeStore.jobs).toHaveLength(1)
    expect(runtimeStore.jobs[0]?.state).toMatchObject({
      pendingOccurrenceAt: null,
      retryAfterAt: null,
    })
    expect(
      runtimeStore.jobs[0]?.state.pendingDeliveryIntentId,
    ).toBeUndefined()
    await expect(listAssistantCronJobs(vaultRoot)).resolves.toEqual([])
    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toHaveLength(2)
  })

  it('persists caller-provided transport idempotency when queueing delivery intents', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-caller-idempotent-',
    )

    const queued = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      deliveryIdempotencyKey: 'sha256:caller-delivery',
      deliveryTransportIdempotent: true,
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      identityId: 'caller-identity',
      message: 'queue caller idempotent delivery',
      sessionId: 'session-caller-idempotent',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-caller-idempotent',
      vault: vaultRoot,
    })

    expect(queued.kind).toBe('queued')
    expect(queued.intent).toMatchObject({
      channel: 'telegram',
      deliveryIdempotencyKey: 'sha256:caller-delivery',
      deliveryTransportIdempotent: true,
      status: 'pending',
    })
    await expect(
      readAssistantOutboxIntent(vaultRoot, queued.intent.intentId),
    ).resolves.toMatchObject({
      deliveryIdempotencyKey: 'sha256:caller-delivery',
      deliveryTransportIdempotent: true,
      status: 'pending',
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('monotonically upgrades idempotency metadata on dedupe hits', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-dedupe-idempotent-upgrade-',
    )

    const first = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dedupeToken: 'hosted-delivery-dedupe',
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      identityId: 'caller-identity',
      message: 'queue before hosted key is known',
      sessionId: 'session-dedupe-idempotent',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-dedupe-idempotent',
      vault: vaultRoot,
    })
    expect(first.kind).toBe('queued')
    expect(first.intent).toMatchObject({
      deliveryIdempotencyKey: null,
      deliveryTransportIdempotent: false,
    })

    const upgraded = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      dedupeToken: 'hosted-delivery-dedupe',
      deliveryIdempotencyKey: 'sha256:dedupe-upgrade',
      deliveryTransportIdempotent: true,
      dispatchMode: 'queue-only',
      explicitTarget: 'telegram-chat',
      identityId: 'caller-identity',
      message: 'retry with hosted key',
      sessionId: 'session-dedupe-idempotent',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-dedupe-idempotent',
      vault: vaultRoot,
    })

    expect(upgraded.kind).toBe('queued')
    expect(upgraded.intent.intentId).toBe(first.intent.intentId)
    expect(upgraded.intent).toMatchObject({
      deliveryIdempotencyKey: 'sha256:dedupe-upgrade',
      deliveryTransportIdempotent: true,
    })
    await expect(
      readAssistantOutboxIntent(vaultRoot, first.intent.intentId),
    ).resolves.toMatchObject({
      deliveryIdempotencyKey: 'sha256:dedupe-upgrade',
      deliveryTransportIdempotent: true,
    })
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('upgrades a retryable Telegram group dedupe hit with exact immutable route authority', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-telegram-route-authority-',
    )
    const routeAuthority = {
      channel: 'telegram' as const,
      containerMemberId: 'member_telegram_group',
      threadId: '-100123456789',
    }
    const deliveryInput = {
      automationAuthority: {
        automationId: 'automation_telegram_group',
        expectedUpdatedAt: '2026-04-08T00:00:00.000Z',
      },
      bindingDelivery: {
        kind: 'thread',
        target: routeAuthority.threadId,
      },
      channel: 'telegram',
      dedupeToken: 'telegram-group-authority',
      dispatchMode: 'queue-only',
      message: 'Group update',
      sessionId: 'session-telegram-group-authority',
      threadId: routeAuthority.threadId,
      threadIsDirect: false,
      turnId: 'turn-telegram-group-authority',
      vault: vaultRoot,
    } as const

    const queued = await deliverAssistantOutboxMessage(deliveryInput)

    expect(queued.kind).toBe('queued')
    expect(queued.intent.externalThreadRouteAuthority).toBeNull()
    await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T01:00:00.000Z',
      lastError: {
        code: 'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE',
        message: 'Route authority was temporarily unavailable.',
      },
      nextAttemptAt: '2026-04-08T01:05:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T01:00:00.000Z',
    })

    const upgraded = await deliverAssistantOutboxMessage({
      ...deliveryInput,
      externalThreadRouteAuthority: routeAuthority,
    })

    expect(upgraded.kind).toBe('queued')
    expect(upgraded.intent.intentId).toBe(queued.intent.intentId)
    expect(upgraded.intent.externalThreadRouteAuthority).toEqual(routeAuthority)
    await expect(
      readAssistantOutboxIntent(vaultRoot, queued.intent.intentId),
    ).resolves.toMatchObject({
      externalThreadRouteAuthority: routeAuthority,
    })
    await expect(deliverAssistantOutboxMessage({
      ...deliveryInput,
      externalThreadRouteAuthority: {
        ...routeAuthority,
        containerMemberId: 'member_other_group',
      },
    })).rejects.toMatchObject({
      code: 'ASSISTANT_OUTBOX_DEDUPE_EFFECT_MISMATCH',
    })
    await expect(
      readAssistantOutboxIntent(vaultRoot, queued.intent.intentId),
    ).resolves.toMatchObject({
      externalThreadRouteAuthority: routeAuthority,
    })
  })

  it('preserves caller-provided transport idempotency after a successful dispatch', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-caller-idempotent-dispatch-',
    )

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'telegram',
        idempotencyKey: 'sha256:caller-dispatch',
        providerMessageId: 'provider-caller-dispatch',
        sentAt: '2026-04-08T03:02:00.000Z',
        target: 'telegram-chat',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })

    const sent = await deliverAssistantOutboxMessage({
      channel: 'telegram',
      deliveryIdempotencyKey: 'sha256:caller-dispatch',
      deliveryTransportIdempotent: true,
      explicitTarget: 'telegram-chat',
      identityId: 'caller-identity',
      message: 'send caller idempotent delivery',
      sessionId: 'session-caller-idempotent-dispatch',
      threadId: 'telegram-chat',
      threadIsDirect: true,
      turnId: 'turn-caller-idempotent-dispatch',
      vault: vaultRoot,
    })

    expect(sent.kind).toBe('sent')
    expect(sent.intent).toMatchObject({
      deliveryIdempotencyKey: 'sha256:caller-dispatch',
      deliveryTransportIdempotent: true,
      status: 'sent',
    })
  })

  it('rejects unsupported queue-only subjects before persisting an outbox intent', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-queue-subject-invalid-')

    await expect(
      deliverAssistantOutboxMessage({
        channel: 'telegram',
        dispatchMode: 'queue-only',
        identityId: 'participant-queue',
        message: 'queue this',
        sessionId: 'session-queue',
        subject: 'Not supported',
        threadId: 'thread-queue',
        threadIsDirect: true,
        turnId: 'turn-queue',
        vault: vaultRoot,
      }),
    ).rejects.toThrow(
      'Only email delivery supports a subject override. Received subject for telegram.',
    )

    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([])
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('rejects queue-only email thread subjects before persisting', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-queue-thread-subject-')

    await expect(
      deliverAssistantOutboxMessage({
        bindingDelivery: {
          kind: 'thread',
          target: 'thread-email-queue',
        },
        channel: 'email',
        dispatchMode: 'queue-only',
        identityId: 'assistant@example.com',
        message: 'queue this email thread reply',
        sessionId: 'session-queue-email',
        subject: 'Should be rejected',
        threadId: 'thread-email-queue',
        threadIsDirect: true,
        turnId: 'turn-queue-email',
        vault: vaultRoot,
      }),
    ).rejects.toThrow(
      'Email thread replies preserve the existing subject. Do not provide a subject override when replying to a thread.',
    )

    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([])
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('drops legacy persisted subjects when replaying hosted email thread outbox intents', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-legacy-thread-subject-',
    )
    const hostedEmailThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: 'hosted-message-1',
      subject: 'Existing thread subject',
      to: ['member@example.com'],
    })

    const queued = await deliverAssistantOutboxMessage({
      channel: 'email',
      dispatchMode: 'queue-only',
      explicitTarget: hostedEmailThreadTarget,
      identityId: null,
      message: 'legacy queued email thread reply',
      sessionId: 'session-legacy-email-thread',
      threadId: hostedEmailThreadTarget,
      threadIsDirect: true,
      turnId: 'turn-legacy-email-thread',
      vault: vaultRoot,
    })
    expect(queued.kind).toBe('queued')

    await saveAssistantOutboxIntent(vaultRoot, {
      ...queued.intent,
      subject: 'Legacy generated subject',
    })

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'email',
        idempotencyKey: queued.intent.deliveryIdempotencyKey,
        providerMessageId: 'hosted-provider-message-1',
        providerThreadId: 'hosted-message-1',
        sentAt: '2026-04-08T03:03:00.000Z',
        target: hostedEmailThreadTarget,
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.deliveryError).toBeNull()
    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        identityId: null,
        subject: null,
        target: hostedEmailThreadTarget,
      }),
      undefined,
    )
  })

  it('preserves explicit email subjects when a stale thread binding is also present', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-explicit-email-subject-stale-thread-',
    )

    const queued = await deliverAssistantOutboxMessage({
      bindingDelivery: {
        kind: 'thread',
        target: 'stale-thread-target',
      },
      channel: 'email',
      dispatchMode: 'queue-only',
      explicitTarget: 'recipient@example.com',
      identityId: 'sender-inbox',
      message: 'explicit email with a subject',
      sessionId: 'session-explicit-email-subject',
      subject: 'Fresh explicit subject',
      threadId: 'stale-thread-target',
      threadIsDirect: true,
      turnId: 'turn-explicit-email-subject',
      vault: vaultRoot,
    })
    expect(queued.kind).toBe('queued')

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'email',
        idempotencyKey: queued.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-explicit-email',
        sentAt: '2026-04-08T03:04:00.000Z',
        target: 'recipient@example.com',
        targetKind: 'explicit',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: queued.intent.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.deliveryError).toBeNull()
    expect(dispatched.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        subject: 'Fresh explicit subject',
        target: 'recipient@example.com',
      }),
      undefined,
    )
  })

  it('rejects direct outbox intent creation for email thread subjects before persisting', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-intent-thread-subject-')

    await expect(
      createAssistantOutboxIntent({
        bindingDelivery: {
          kind: 'thread',
          target: 'thread-email-intent',
        },
        channel: 'email',
        identityId: 'assistant@example.com',
        message: 'queue this email thread reply',
        sessionId: 'session-intent-email',
        subject: 'Should be rejected',
        threadId: 'thread-email-intent',
        threadIsDirect: true,
        turnId: 'turn-intent-email',
        vault: vaultRoot,
      }),
    ).rejects.toThrow(
      'Email thread replies preserve the existing subject. Do not provide a subject override when replying to a thread.',
    )

    await expect(listAssistantOutboxIntentsLocal(vaultRoot)).resolves.toEqual([])
  })

  it('clears prepared dispatches on definite failures and falls back to confirmation-pending retries when cleanup is ambiguous', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-failure-')

    const failedSeed = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T04:00:00.000Z',
      message: 'definite failure',
      sessionId: 'session-failure-a',
      turnId: 'turn-failure-a',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('channel required'), {
        code: 'CHANNEL_REQUIRED',
        context: {
          retryable: false,
          status: 403,
        },
      }),
    )
    const clearPreparedIntent = vi.fn(async () => {})

    const failed = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        clearPreparedIntent,
        prepareDispatchIntent: async () => {},
      },
      force: true,
      intentId: failedSeed.intentId,
      now: new Date('2026-04-08T04:05:00.000Z'),
      vault: vaultRoot,
    })
    expect(clearPreparedIntent).toHaveBeenCalledTimes(1)
    expect(failed.intent.status).toBe('failed')
    expect(failed.intent.deliveryConfirmationPending).toBe(false)
    expect(failed.intent.lastError?.code).toBe('CHANNEL_REQUIRED')
    expect(failed.deliveryError?.diagnosticContext).toMatchObject({
      code: 'CHANNEL_REQUIRED',
      name: 'Error',
      retryable: false,
      status: 403,
    })
    expect(failed.intent.lastError?.diagnosticContext).toMatchObject({
      code: 'CHANNEL_REQUIRED',
      name: 'Error',
      retryable: false,
      status: 403,
    })

    const ambiguousSeed = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T04:10:00.000Z',
      message: 'ambiguous cleanup',
      sessionId: 'session-failure-b',
      turnId: 'turn-failure-b',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('channel required'), {
        code: 'CHANNEL_REQUIRED',
      }),
    )

    const ambiguous = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        clearPreparedIntent: async () => {
          throw new Error('cleanup failed')
        },
        prepareDispatchIntent: async () => {},
      },
      force: true,
      intentId: ambiguousSeed.intentId,
      now: new Date('2026-04-08T04:15:00.000Z'),
      vault: vaultRoot,
    })
    expect(ambiguous.intent.status).toBe('retryable')
    expect(ambiguous.intent.deliveryConfirmationPending).toBe(false)
    expect(ambiguous.intent.lastError?.code).toBe(
      'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    )
  })

  it('keeps accepted Linq consume-stamp failures on the existing outbox retry path', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-linq-consume-retry-')
    const answeredMailboxItemIds = Array.from(
      { length: 45 },
      (_, index) => `mailbox_item_retry_${index}`,
    )
    const seeded = await createIntent(vaultRoot, {
      answeredMailboxItemIds,
      channel: 'linq',
      message: 'accepted reply needs consume stamp',
      sessionId: 'session-linq-consume-retry',
      threadId: 'linq-thread-consume-retry',
      turnId: 'turn-linq-consume-retry',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      new VaultCliError(
        'ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED',
        'Accepted Linq delivery outcome recording failed before consume state could be stored.',
        { retryable: true },
      ),
    )

    const failedReport = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:25:00.000Z'),
      vault: vaultRoot,
    })

    expect(failedReport.intent.status).toBe('retryable')
    expect(failedReport.intent.sentAt).toBeNull()
    expect(failedReport.intent.answeredMailboxItemIds).toEqual(answeredMailboxItemIds)
    expect(failedReport.intent.lastError?.code).toBe(
      'ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED',
    )

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: failedReport.intent.deliveryIdempotencyKey,
        providerMessageId: 'provider-linq-consume-retry',
        providerThreadId: 'linq-thread-consume-retry',
        sentAt: '2026-04-08T04:26:00.000Z',
        target: 'linq-thread-consume-retry',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: true,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const retry = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:26:00.000Z'),
      vault: vaultRoot,
    })

    expect(retry.intent.status).toBe('sent')
    expect(retry.intent.answeredMailboxItemIds).toEqual(answeredMailboxItemIds)
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenLastCalledWith(
      expect.objectContaining({
        answeredMailboxItemIds,
        channel: 'linq',
      }),
      undefined,
    )
  })

  it('forwards Linq answered mailbox ids through the real adapter before retrying outcome failures', async () => {
    await useActualOutboundDeliveryImplementation()
    const { vaultRoot } = await createAssistantVault('assistant-outbox-linq-real-consume-retry-')
    const answeredMailboxItemIds = [
      'mailbox_item_real_path_1',
      'mailbox_item_real_path_2',
    ]
    const seeded = await createIntent(vaultRoot, {
      answeredMailboxItemIds,
      channel: 'linq',
      message: 'real adapter reply needs consume stamp',
      sessionId: 'session-linq-real-consume-retry',
      threadId: 'linq-thread-real-consume-retry',
      turnId: 'turn-linq-real-consume-retry',
    })
    const sendLinq = vi.fn(
      async (
        _input: Parameters<NonNullable<AssistantChannelDependencies['sendLinq']>>[0],
      ) => {
        throw new VaultCliError(
          'ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED',
          'Accepted Linq delivery outcome recording failed before consume state could be stored.',
          { retryable: true },
        )
      },
    )

    const failedReport = await dispatchAssistantOutboxIntent({
      dependencies: { sendLinq },
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:30:00.000Z'),
      vault: vaultRoot,
    })

    expect(sendLinq).toHaveBeenCalledOnce()
    expect(sendLinq.mock.calls[0]?.[0]).toMatchObject({
      answeredMailboxItemIds,
      target: 'linq-thread-real-consume-retry',
      targetKind: 'thread',
    })
    expect(failedReport.intent.status).toBe('retryable')
    expect(failedReport.intent.sentAt).toBeNull()
    expect(failedReport.intent.answeredMailboxItemIds).toEqual(answeredMailboxItemIds)
    expect(failedReport.intent.lastError?.code).toBe(
      'ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED',
    )
  })

  it('rethrows selected dispatch errors before failure persistence', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-rethrow-')
    const seeded = await createIntent(vaultRoot, {
      message: 'control flow rethrow',
      sessionId: 'session-rethrow',
      turnId: 'turn-rethrow',
    })
    const controlFlowError = new VaultCliError(
      'ASSISTANT_OUTBOX_CONTROL_FLOW',
      'Dispatch stopped for runtime control flow.',
    )
    const shouldRethrowDispatchError = vi.fn((input: {
      error: unknown
      intent: AssistantOutboxIntent
      vault: string
    }) => {
      const { error, intent, vault } = input
      expect(error).toBe(controlFlowError)
      expect(intent.intentId).toBe(seeded.intentId)
      expect(vault).toBe(vaultRoot)
      return true
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(controlFlowError)

    await expect(
      dispatchAssistantOutboxIntent({
        dispatchHooks: {
          shouldRethrowDispatchError,
        },
        force: true,
        intentId: seeded.intentId,
        now: new Date('2026-04-08T04:20:00.000Z'),
        vault: vaultRoot,
      }),
    ).rejects.toBe(controlFlowError)

    const persisted = await readAssistantOutboxIntent(vaultRoot, seeded.intentId)
    expect(shouldRethrowDispatchError).toHaveBeenCalledTimes(1)
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
    expect(persisted?.status).toBe('sending')
    expect(persisted?.lastError).toBeNull()
  })

  it('persists non-rethrown hosted foreground yield as retryable', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-yield-retryable-')
    const seeded = await createIntent(vaultRoot, {
      message: 'hosted yield retryable',
      sessionId: 'session-yield-retryable',
      turnId: 'turn-yield-retryable',
    })
    const foregroundYieldError = new VaultCliError(
      'HOSTED_BACKGROUND_DELIVERY_YIELDED',
      'Hosted background delivery yielded to fresh foreground input.',
      {
        assistantDeliveryFailureClass: 'transient',
        assistantDeliveryResumeTrigger: 'fresh_foreground_input',
        retryable: true,
      },
    )
    const shouldRethrowDispatchError = vi.fn((input: {
      error: unknown
      intent: AssistantOutboxIntent
      vault: string
    }) => {
      expect(input.error).toBe(foregroundYieldError)
      expect(input.intent.intentId).toBe(seeded.intentId)
      expect(input.vault).toBe(vaultRoot)
      return false
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      foregroundYieldError,
    )

    const result = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        shouldRethrowDispatchError,
      },
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:25:00.000Z'),
      vault: vaultRoot,
    })

    expect(shouldRethrowDispatchError).toHaveBeenCalledTimes(1)
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
    expect(result.intent.status).toBe('retryable')
    expect(result.intent.lastError).toMatchObject({
      code: 'HOSTED_BACKGROUND_DELIVERY_YIELDED',
      diagnosticContext: {
        assistantDeliveryFailureClass: 'transient',
        assistantDeliveryResumeTrigger: 'fresh_foreground_input',
        retryable: true,
      },
      message: 'Hosted background delivery yielded to fresh foreground input.',
    })
    expect(result.deliveryError).toEqual(result.intent.lastError)
    const persisted = await readAssistantOutboxIntent(vaultRoot, seeded.intentId)
    expect(persisted?.status).toBe('retryable')
    expect(persisted?.lastError).toEqual(result.intent.lastError)
  })

  it('preserves diagnostic context in high-level delivery helper results', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-helper-error-')

    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('channel required'), {
        code: 'CHANNEL_REQUIRED',
        context: {
          retryable: false,
          status: 403,
        },
      }),
    )

    const failed = await deliverAssistantOutboxMessage({
      explicitTarget: '123',
      message: 'helper failure',
      sessionId: 'session-helper-error',
      turnId: 'turn-helper-error',
      vault: vaultRoot,
    })

    expect(failed.kind).toBe('failed')
    expect(failed.deliveryError).toEqual({
      code: 'CHANNEL_REQUIRED',
      diagnosticContext: {
        code: 'CHANNEL_REQUIRED',
        name: 'Error',
        retryable: false,
        status: 403,
      },
      message: 'channel required',
    })
  })

  it('dispatches a checkpoint-prepared sending intent only when explicitly allowed', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-prepared-sending-')
    const seeded = await createIntent(vaultRoot, {
      explicitTarget: '123',
      sessionId: 'session-prepared-sending',
      turnId: 'turn-prepared-sending',
    })
    const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: `assistant-outbox:${seeded.intentId}`,
      deliveryTransportIdempotent: false,
      intentId: seeded.intentId,
      startedAt: '2026-04-08T05:00:00.000Z',
      vault: vaultRoot,
    })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: {
        channel: 'telegram',
        idempotencyKey: `assistant-outbox:${seeded.intentId}`,
        messageLength: seeded.message.length,
        providerMessageId: 'provider-prepared',
        providerThreadId: 'thread-prepared',
        sentAt: '2026-04-08T05:00:02.000Z',
        target: '123',
        targetKind: 'explicit',
      },
      deliveryDeduplicated: false,
      outboxIntentId: null,
    })

    const skipped = await dispatchAssistantOutboxIntent({
      intentId: seeded.intentId,
      now: new Date('2026-04-08T05:00:01.000Z'),
      vault: vaultRoot,
    })
    expect(skipped.intent.status).toBe('sending')
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()

    const dispatched = await dispatchAssistantOutboxIntent({
      allowPreparedSending: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T05:00:01.000Z'),
      preparedDispatch: {
        deliveryIdempotencyKey: `assistant-outbox:${seeded.intentId}`,
        deliveryTransportIdempotent: false,
        preparedDispatchToken: prepared!.preparedDispatchToken!,
      },
      vault: vaultRoot,
    })
    expect(dispatched.intent.status).toBe('sent')
    expect(expectMessageDelivery(dispatched.intent.delivery).providerMessageId).toBe(
      'provider-prepared',
    )
  })

  it('ignores stale tokenless provider success after a newer retry reclaims the intent', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-tokenless-success-race-')
    const seeded = await createIntent(vaultRoot, {
      explicitTarget: '123',
      sessionId: 'session-tokenless-success-race',
      turnId: 'turn-tokenless-success-race',
    })
    const persistDeliveredIntent = vi.fn()
    mockedDeliverAssistantMessageOverBinding.mockImplementationOnce(async () => {
      const sending = await readAssistantOutboxIntent(vaultRoot, seeded.intentId)
      if (!sending) {
        throw new Error('Expected sending intent.')
      }
      await saveAssistantOutboxIntent(vaultRoot, {
        ...sending,
        attemptCount: sending.attemptCount + 1,
        lastAttemptAt: '2026-04-08T05:11:00.000Z',
        updatedAt: '2026-04-08T05:11:00.000Z',
      })
      return {
        delivery: {
          channel: 'telegram',
          idempotencyKey: `assistant-outbox:${seeded.intentId}`,
          messageLength: seeded.message.length,
          providerMessageId: 'provider-stale-tokenless',
          providerThreadId: 'thread-stale-tokenless',
          sentAt: '2026-04-08T05:11:05.000Z',
          target: '123',
          targetKind: 'explicit',
        },
        deliveryDeduplicated: false,
        outboxIntentId: null,
      }
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        persistDeliveredIntent,
      },
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T05:00:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sending')
    expect(dispatched.intent.preparedDispatchToken).toBe(null)
    expect(dispatched.intent.lastAttemptAt).toBe('2026-04-08T05:11:00.000Z')
    expect(dispatched.intent.delivery).toBe(null)
    expect(persistDeliveredIntent).not.toHaveBeenCalled()
    const persisted = await readAssistantOutboxIntent(vaultRoot, seeded.intentId)
    expect(persisted?.status).toBe('sending')
    expect(persisted?.preparedDispatchToken).toBe(null)
    expect(persisted?.lastAttemptAt).toBe('2026-04-08T05:11:00.000Z')
    expect(persisted?.delivery).toBe(null)
  })

  it('ignores stale prepared provider success after a newer retry reclaims the intent', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-prepared-success-race-')
    const seeded = await createIntent(vaultRoot, {
      explicitTarget: '123',
      sessionId: 'session-prepared-success-race',
      turnId: 'turn-prepared-success-race',
    })
    const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: `assistant-outbox:${seeded.intentId}`,
      deliveryTransportIdempotent: true,
      intentId: seeded.intentId,
      startedAt: '2026-04-08T05:00:00.000Z',
      vault: vaultRoot,
    })
    const newerSending = {
      ...prepared!.intent,
      attemptCount: prepared!.intent.attemptCount + 1,
      lastAttemptAt: '2026-04-08T05:11:00.000Z',
      preparedDispatchToken: null,
      updatedAt: '2026-04-08T05:11:00.000Z',
    }
    const persistDeliveredIntent = vi.fn()
    mockedDeliverAssistantMessageOverBinding.mockImplementationOnce(async () => {
      await saveAssistantOutboxIntent(vaultRoot, newerSending)
      return {
        delivery: {
          channel: 'telegram',
          idempotencyKey: `assistant-outbox:${seeded.intentId}`,
          messageLength: seeded.message.length,
          providerMessageId: 'provider-stale-prepared',
          providerThreadId: 'thread-stale-prepared',
          sentAt: '2026-04-08T05:11:05.000Z',
          target: '123',
          targetKind: 'explicit',
        },
        deliveryDeduplicated: false,
        outboxIntentId: null,
      }
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      allowPreparedSending: true,
      dispatchHooks: {
        persistDeliveredIntent,
      },
      intentId: seeded.intentId,
      now: new Date('2026-04-08T05:00:01.000Z'),
      preparedDispatch: {
        deliveryIdempotencyKey: `assistant-outbox:${seeded.intentId}`,
        deliveryTransportIdempotent: true,
        preparedDispatchToken: prepared!.preparedDispatchToken!,
      },
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sending')
    expect(dispatched.intent.preparedDispatchToken).toBe(null)
    expect(dispatched.intent.lastAttemptAt).toBe('2026-04-08T05:11:00.000Z')
    expect(dispatched.intent.delivery).toBe(null)
    expect(persistDeliveredIntent).not.toHaveBeenCalled()
    const persisted = await readAssistantOutboxIntent(vaultRoot, seeded.intentId)
    expect(persisted?.status).toBe('sending')
    expect(persisted?.preparedDispatchToken).toBe(null)
    expect(persisted?.lastAttemptAt).toBe('2026-04-08T05:11:00.000Z')
    expect(persisted?.delivery).toBe(null)
  })

  it('does not dispatch a prepared sending intent when the prepared ownership token mismatches', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-prepared-stale-')
    const seeded = await createIntent(vaultRoot, {
      explicitTarget: '123',
      sessionId: 'session-prepared-stale',
      turnId: 'turn-prepared-stale',
    })
    const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: `assistant-outbox:${seeded.intentId}`,
      deliveryTransportIdempotent: false,
      intentId: seeded.intentId,
      startedAt: '2026-04-08T05:00:02.000Z',
      vault: vaultRoot,
    })

    const skipped = await dispatchAssistantOutboxIntent({
      allowPreparedSending: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T05:00:03.000Z'),
      preparedDispatch: {
        deliveryIdempotencyKey: `assistant-outbox:${seeded.intentId}`,
        deliveryTransportIdempotent: false,
        preparedDispatchToken: 'wrong-prepared-dispatch-token',
      },
      vault: vaultRoot,
    })

    expect(skipped.intent.status).toBe('sending')
    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('marks Telegram partial-send ambiguity as abandoned and preserves sent chunk metadata', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-telegram-partial-')

    const seeded = await createIntent(vaultRoot, {
      explicitTarget: '123',
      message: `${'a'.repeat(4096)}b`,
      sessionId: 'session-telegram-partial',
      turnId: 'turn-telegram-partial',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('later chunk failed'), {
        code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
        cleanupMessages: [{ messageId: '1001', target: '123' }],
        cleanupTargetAliases: ['123'],
        deliveryMayHaveSucceeded: true,
        providerMessageId: '1001',
        providerMessageIds: ['1001'],
        target: '456',
      }),
    )

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:20:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('abandoned')
    expect(dispatched.intent.deliveryConfirmationPending).toBe(false)
    expect(dispatched.intent.delivery).toMatchObject({
      channel: 'telegram',
      cleanupMessages: [{ messageId: '1001', target: '123' }],
      cleanupTargetAliases: ['123'],
      messageLength: seeded.message.length,
      providerMessageId: '1001',
      providerMessageIds: ['1001'],
      target: '456',
      targetKind: 'explicit',
    })
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })
  })

  it('marks Linq text-plus-voice memo partial delivery as abandoned and preserves text metadata', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-linq-partial-')

    const seeded = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'thread-linq-voice',
      media: [createVoiceMemoMedia()],
      message: 'Text before memo',
      sessionId: 'session-linq-partial',
      turnId: 'turn-linq-partial',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('voice memo endpoint failed'), {
        code: 'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY',
        deliveryMayHaveSucceeded: true,
        providerMessageId: 'linq-text-message',
        providerMessageIds: ['linq-text-message'],
        providerThreadId: 'thread-linq-voice',
        target: 'thread-linq-voice',
        targetKind: 'thread',
      }),
    )

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:22:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('abandoned')
    expect(dispatched.intent.deliveryConfirmationPending).toBe(false)
    expect(dispatched.intent.nextAttemptAt).toBeNull()
    expect(dispatched.intent.delivery).toMatchObject({
      channel: 'linq',
      messageLength: seeded.message.length,
      providerMessageId: 'linq-text-message',
      providerMessageIds: ['linq-text-message'],
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })
  })

  it('keeps Linq text-plus-link partial delivery retryable with its accepted text identity', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-linq-link-partial-')

    const seeded = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'thread-linq-link',
      message: 'Use this payment link https://pay.example.test/session',
      sessionId: 'session-linq-link-partial',
      turnId: 'turn-linq-link-partial',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('rich-link endpoint failed'), {
        code: 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY',
        deliveryMayHaveSucceeded: true,
        providerMessageId: 'linq-text-message',
        providerMessageIds: ['linq-text-message'],
        providerThreadId: 'thread-linq-link',
        target: 'thread-linq-link',
        targetKind: 'thread',
      }),
    )

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:23:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('retryable')
    expect(dispatched.intent.deliveryConfirmationPending).toBe(false)
    expect(dispatched.intent.nextAttemptAt).not.toBeNull()
    expect(dispatched.intent.delivery).toMatchObject({
      channel: 'linq',
      messageLength: seeded.message.length,
      providerMessageId: 'linq-text-message',
      providerMessageIds: ['linq-text-message'],
      providerThreadId: 'thread-linq-link',
      target: 'thread-linq-link',
      targetKind: 'thread',
    })
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)

    const deliveryIdempotencyKey = mockedDeliverAssistantMessageOverBinding
      .mock.calls[0]?.[0].idempotencyKey
    expect(deliveryIdempotencyKey).toBe(`assistant-outbox:${seeded.intentId}`)
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'linq',
        idempotencyKey: deliveryIdempotencyKey,
        providerMessageId: 'linq-link-message',
        providerMessageIds: ['linq-text-message', 'linq-link-message'],
        providerThreadId: 'thread-linq-link',
        target: 'thread-linq-link',
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: true,
      outboxIntentId: null,
      session: undefined,
    })

    const recovered = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:24:00.000Z'),
      vault: vaultRoot,
    })

    expect(recovered.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(2)
    expect(mockedDeliverAssistantMessageOverBinding.mock.calls[1]?.[0])
      .toMatchObject({ idempotencyKey: deliveryIdempotencyKey })
  })

  it.each([
    ['an ambiguous primary replay', 'primary replay acknowledgement was lost'],
    ['an accepted-outcome callback failure', 'accepted outcome callback timed out'],
  ])(
    'keeps a Linq rich-link checkpoint non-confirmable through %s',
    async (_label, ambiguousMessage) => {
      const { vaultRoot } = await createAssistantVault(
        'assistant-outbox-linq-link-sticky-checkpoint-',
      )
      const seeded = await createIntent(vaultRoot, {
        channel: 'linq',
        explicitTarget: 'thread-linq-link-sticky',
        message: 'Use this payment link https://pay.example.test/session',
        sessionId: 'session-linq-link-sticky',
        turnId: 'turn-linq-link-sticky',
      })
      const partialFailure = Object.assign(
        new Error('rich-link endpoint failed'),
        {
          code: 'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY',
          deliveryMayHaveSucceeded: true,
          providerMessageId: 'linq-text-message',
          providerMessageIds: ['linq-text-message'],
          providerThreadId: 'thread-linq-link-sticky',
          target: 'thread-linq-link-sticky',
          targetKind: 'thread',
        },
      )
      mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(partialFailure)

      const partial = await dispatchAssistantOutboxIntent({
        force: true,
        intentId: seeded.intentId,
        now: new Date('2026-04-08T04:23:00.000Z'),
        vault: vaultRoot,
      })
      const deliveryIdempotencyKey = mockedDeliverAssistantMessageOverBinding
        .mock.calls[0]?.[0].idempotencyKey
      expect(partial.intent).toMatchObject({
        deliveryConfirmationPending: false,
        status: 'retryable',
      })

      mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
        Object.assign(new Error(ambiguousMessage), {
          deliveryMayHaveSucceeded: true,
        }),
      )
      const ambiguous = await dispatchAssistantOutboxIntent({
        force: true,
        intentId: seeded.intentId,
        now: new Date('2026-04-08T04:24:00.000Z'),
        vault: vaultRoot,
      })

      expect(ambiguous.intent).toMatchObject({
        deliveryConfirmationPending: false,
        status: 'retryable',
      })
      expect(ambiguous.intent.delivery).toMatchObject({
        providerMessageIds: ['linq-text-message'],
      })
      expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(2)
      expect(mockedDeliverAssistantMessageOverBinding.mock.calls[1]?.[0])
        .toMatchObject({ idempotencyKey: deliveryIdempotencyKey })

      mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
        delivery: createDelivery({
          channel: 'linq',
          idempotencyKey: deliveryIdempotencyKey,
          providerMessageId: 'linq-link-message',
          providerMessageIds: ['linq-text-message', 'linq-link-message'],
          providerThreadId: 'thread-linq-link-sticky',
          target: 'thread-linq-link-sticky',
          targetKind: 'thread',
        }),
        deliveryDeduplicated: false,
        deliveryTransportIdempotent: true,
        outboxIntentId: null,
        session: undefined,
      })
      const recovered = await dispatchAssistantOutboxIntent({
        force: true,
        intentId: seeded.intentId,
        now: new Date('2026-04-08T04:25:00.000Z'),
        vault: vaultRoot,
      })

      expect(recovered.intent.status).toBe('sent')
      expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(3)
      expect(mockedDeliverAssistantMessageOverBinding.mock.calls[2]?.[0])
        .toMatchObject({ idempotencyKey: deliveryIdempotencyKey })
    },
  )

  it('abandons Linq media-only voice memo ambiguity without retrying', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-linq-voice-only-')

    const seeded = await createIntent(vaultRoot, {
      channel: 'linq',
      explicitTarget: 'thread-linq-voice',
      media: [createVoiceMemoMedia()],
      message: '',
      sessionId: 'session-linq-voice-only',
      turnId: 'turn-linq-voice-only',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('voice memo transport failed after send'), {
        code: 'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY',
        deliveryMayHaveSucceeded: true,
        providerMessageId: null,
        providerMessageIds: [],
        providerThreadId: null,
        target: 'thread-linq-voice',
        targetKind: 'thread',
      }),
    )

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:24:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('abandoned')
    expect(dispatched.intent.deliveryConfirmationPending).toBe(false)
    expect(dispatched.intent.nextAttemptAt).toBeNull()
    expect(dispatched.intent.delivery).toBeNull()
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })
  })

  it('abandons Telegram transport ambiguity without retrying when no provider ids are known', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-telegram-transport-')

    const seeded = await createIntent(vaultRoot, {
      explicitTarget: '123',
      message: 'telegram transport ambiguity',
      sessionId: 'session-telegram-transport',
      turnId: 'turn-telegram-transport',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('socket closed after sendMessage'), {
        code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
        deliveryMayHaveSucceeded: true,
        providerMessageId: null,
        providerMessageIds: [],
        target: '123',
      }),
    )

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:25:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('abandoned')
    expect(dispatched.intent.deliveryConfirmationPending).toBe(false)
    expect(dispatched.intent.nextAttemptAt).toBeNull()
    expect(dispatched.intent.delivery).toBeNull()
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('replays only stale group-email planner roots while recipient sends stay fail-closed', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-email-group-planner-')
    const groupTarget = serializeHostedEmailThreadTarget({
      groupId: 'group-replay-safe',
      subject: 'Group thread',
      targetKind: 'group',
    })
    const recipientTarget = serializeHostedEmailThreadTarget({
      groupId: 'group-replay-safe',
      recipientMemberId: 'member-one',
      subject: 'Group thread',
      targetKind: 'group',
    })
    const directTarget = serializeHostedEmailThreadTarget({
      subject: 'Direct thread',
      to: ['member@example.test'],
    })

    const root = await createIntent(vaultRoot, {
      channel: 'email',
      createdAt: '2026-04-08T04:20:00.000Z',
      explicitTarget: groupTarget,
      message: 'group reply',
      sessionId: 'session-email-group-planner',
      threadId: groupTarget,
      threadIsDirect: false,
      turnId: 'turn-email-group-planner',
    })
    const recipient = await createIntent(vaultRoot, {
      channel: 'email',
      createdAt: '2026-04-08T04:20:00.000Z',
      explicitTarget: recipientTarget,
      message: 'group reply',
      sessionId: 'session-email-group-recipient',
      threadId: recipientTarget,
      threadIsDirect: false,
      turnId: 'turn-email-group-recipient',
    })
    const direct = await createIntent(vaultRoot, {
      channel: 'email',
      createdAt: '2026-04-08T04:20:00.000Z',
      explicitTarget: directTarget,
      message: 'direct reply',
      sessionId: 'session-email-direct',
      threadId: directTarget,
      threadIsDirect: true,
      turnId: 'turn-email-direct',
    })

    expect(root.deliveryTransportIdempotent).toBe(true)
    expect(recipient.deliveryTransportIdempotent).toBe(false)
    expect(direct.deliveryTransportIdempotent).toBe(false)

    await saveAssistantOutboxIntent(vaultRoot, {
      ...root,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T04:21:00.000Z',
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T04:21:00.000Z',
    })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        channel: 'email',
        target: groupTarget,
        targetKind: 'thread',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })

    const replayedRoot = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: root.intentId,
      now: new Date('2026-04-08T04:40:00.000Z'),
      vault: vaultRoot,
    })
    expect(replayedRoot.deliveryError).toBeNull()
    expect(replayedRoot.intent.status).toBe('sent')
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)

    await saveAssistantOutboxIntent(vaultRoot, {
      ...recipient,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T04:21:00.000Z',
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T04:21:00.000Z',
    })
    const failedRecipient = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: recipient.intentId,
      now: new Date('2026-04-08T04:40:00.000Z'),
      vault: vaultRoot,
    })
    expect(failedRecipient.intent.status).toBe('failed')
    expect(failedRecipient.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('abandons incomplete group email fan-out without retrying or recording delivery', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-email-group-partial-')

    const seeded = await createIntent(vaultRoot, {
      channel: 'email',
      explicitTarget: serializeHostedEmailThreadTarget({
        lastMessageId: '<group-last@example.test>',
        references: ['<group-root@example.test>'],
        subject: 'Group thread',
        to: [],
      }),
      message: 'group reply',
      sessionId: 'session-email-group-partial',
      turnId: 'turn-email-group-partial',
    })
    mockedDeliverAssistantMessageOverBinding.mockRejectedValueOnce(
      Object.assign(new Error('group email fan-out incomplete'), {
        code: 'ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE',
        deliveryMayHaveSucceeded: true,
      }),
    )

    const dispatched = await dispatchAssistantOutboxIntent({
      force: true,
      intentId: seeded.intentId,
      now: new Date('2026-04-08T04:26:00.000Z'),
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('abandoned')
    expect(dispatched.intent.deliveryConfirmationPending).toBe(false)
    expect(dispatched.intent.nextAttemptAt).toBeNull()
    expect(dispatched.intent.delivery).toBeNull()
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_AMBIGUOUS',
    })

    const drained = await drainAssistantOutboxLocal({
      now: new Date('2026-04-08T04:27:00.000Z'),
      vault: vaultRoot,
    })
    expect(drained).toEqual({
      attempted: 0,
      failed: 0,
      queued: 0,
      sent: 0,
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('threads abort signals through outbox drain delivery dependencies', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-signal-')
    const controller = new AbortController()

    await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:00:00.000Z',
      message: 'abortable delivery',
      sessionId: 'session-signal',
      turnId: 'turn-signal',
    })
    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        providerMessageId: 'provider-signal',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })

    await drainAssistantOutboxLocal({
      now: new Date('2026-04-08T00:01:00.000Z'),
      signal: controller.signal,
      vault: vaultRoot,
    })

    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledOnce()
    expect(mockedDeliverAssistantMessageOverBinding.mock.calls[0]?.[1]).toEqual({
      signal: controller.signal,
    })
  })

  it('threads progress close aborts through the real outbox delivery path', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-progress-signal-')
    const dependencyController = new AbortController()
    const progressController = new AbortController()
    let deliveryDependencies: AssistantChannelDependencies | undefined

    mockedDeliverAssistantMessageOverBinding.mockImplementationOnce(
      async (_input, dependencies) => {
        deliveryDependencies = dependencies
        return {
          delivery: createDelivery({
            providerMessageId: 'provider-progress-signal',
          }),
          deliveryDeduplicated: false,
          deliveryTransportIdempotent: false,
          outboxIntentId: null,
          session: undefined,
        }
      },
    )

    await deliverAssistantProgressUpdate({
      dependencies: {
        signal: dependencyController.signal,
      },
      input: createMessageInput(vaultRoot),
      ordinal: 0,
      session: createAssistantSession({
        sessionId: 'session-progress-signal',
      }),
      sharedPlan: createSharedPlan(),
      signal: progressController.signal,
      text: 'Checking current context.',
      turnId: 'turn-progress-signal',
    })

    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
    expect(deliveryDependencies?.signal).toBeDefined()
    expect(deliveryDependencies?.signal).not.toBe(dependencyController.signal)
    expect(deliveryDependencies?.signal?.aborted).toBe(false)
    progressController.abort()
    expect(deliveryDependencies?.signal?.aborted).toBe(true)
  })

  // Direct callers must get a loud typed failure for progress-ineligible
  // contexts instead of the success-shaped silent no-op that previously made
  // the model report undelivered updates as "sent". The only production
  // caller invokes this inside createAssistantProgressDelivery's try/catch,
  // which converts the throw into a structured best-effort failure, so the
  // enclosing turn never fails.
  it('rejects progress delivery for non-eligible contexts without dispatching', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-progress-suppressed-')

    await expect(deliverAssistantProgressUpdate({
      input: {
        ...createMessageInput(vaultRoot),
        deliveryDispatchMode: 'queue-only',
        turnTrigger: 'automation-cron',
      },
      ordinal: 0,
      session: createAssistantSession({
        sessionId: 'session-progress-suppressed',
      }),
      sharedPlan: createSharedPlan(),
      text: 'Checking current context.',
      turnId: 'turn-progress-suppressed',
    })).rejects.toMatchObject({
      code: 'ASSISTANT_PROGRESS_DELIVERY_SUPPRESSED',
    })

    expect(mockedDeliverAssistantMessageOverBinding).not.toHaveBeenCalled()
  })

  it('drains only due intents and summarizes mixed outbox states', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-drain-')
    vi.useFakeTimers()

    await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:00:00.000Z',
      message: 'due pending',
      sessionId: 'session-drain-pending',
      turnId: 'turn-drain-pending',
    })
    const staleSending = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:01:00.000Z',
      message: 'stale sending',
      sessionId: 'session-drain-sending',
      turnId: 'turn-drain-sending',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...staleSending,
      attemptCount: 1,
      lastAttemptAt: '2026-04-08T05:00:00.000Z',
      nextAttemptAt: null,
      status: 'sending',
      updatedAt: '2026-04-08T05:00:00.000Z',
    })

    const futureRetryable = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:02:00.000Z',
      message: 'future retry',
      sessionId: 'session-drain-future',
      turnId: 'turn-drain-future',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...futureRetryable,
      attemptCount: 2,
      lastError: {
        code: 'REQUEST_FAILED',
        message: 'temporary retry',
      },
      nextAttemptAt: '2026-04-08T06:00:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-08T05:03:00.000Z',
    })

    mockedDeliverAssistantMessageOverBinding.mockResolvedValueOnce({
      delivery: createDelivery({
        providerMessageId: 'provider-drain-sent',
        sentAt: '2026-04-08T05:20:00.000Z',
      }),
      deliveryDeduplicated: false,
      deliveryTransportIdempotent: false,
      outboxIntentId: null,
      session: undefined,
    })
    vi.setSystemTime(new Date('2026-04-08T05:20:00.000Z'))

    const drained = await drainAssistantOutboxLocal({
      limit: 10,
      now: new Date('2026-04-08T05:20:00.000Z'),
      vault: vaultRoot,
    })
    expect(drained).toEqual({
      attempted: 2,
      failed: 1,
      queued: 0,
      sent: 1,
    })

    const failedIntent = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:03:00.000Z',
      message: 'failed later',
      sessionId: 'session-summary-failed',
      turnId: 'turn-summary-failed',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...failedIntent,
      lastError: {
        code: 'CHANNEL_REQUIRED',
        message: 'channel required',
      },
      nextAttemptAt: null,
      status: 'failed',
      updatedAt: '2026-04-08T05:03:30.000Z',
    })

    const abandonedIntent = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T05:04:00.000Z',
      message: 'abandoned later',
      sessionId: 'session-summary-abandoned',
      turnId: 'turn-summary-abandoned',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...abandonedIntent,
      nextAttemptAt: null,
      status: 'abandoned',
      updatedAt: '2026-04-08T05:04:30.000Z',
    })

    const summary = await buildAssistantOutboxSummary(vaultRoot)
    expect(summary).toEqual({
      abandoned: 1,
      failed: 2,
      nextAttemptAt: '2026-04-08T06:00:00.000Z',
      oldestPendingAt: futureRetryable.createdAt,
      pending: 0,
      retryable: 1,
      sending: 0,
      sent: 1,
      total: 5,
    })
  })
})

async function createAssistantVault(prefix: string): Promise<{
  paths: ReturnType<typeof resolveAssistantStatePaths>
  vaultRoot: string
}> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(prefix)
  tempRoots.push(parentRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)
  await ensureAssistantState(paths)
  return {
    paths,
    vaultRoot,
  }
}

async function createInitializedAssistantVault(prefix: string): Promise<{
  paths: ReturnType<typeof resolveAssistantStatePaths>
  vaultRoot: string
}> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(prefix)
  tempRoots.push(parentRoot)
  await initializeVault({
    createdAt: new Date('2026-07-16T11:00:00.000Z'),
    vaultRoot,
  })
  const paths = resolveAssistantStatePaths(vaultRoot)
  await ensureAssistantState(paths)
  return {
    paths,
    vaultRoot,
  }
}

async function expectRawOutboxIntentMessage(
  vault: string,
  intentId: string,
  message: {
    media: unknown
    message: string
    replyToMessageId: string | null
    subject: string | null
  },
): Promise<void> {
  const raw = await readRawOutboxIntent(vault, intentId)

  expect(raw.schema).toBe('murph.assistant-outbox-intent.v1')
  expect(raw.message).toBe(message.message)
  expect(raw.media).toEqual(message.media)
  expect(raw.subject).toBe(message.subject)
  expect(raw.replyToMessageId).toBe(message.replyToMessageId)
  expect(raw).not.toHaveProperty('card')
  expect(raw).not.toHaveProperty('operation')
  expect(raw).not.toHaveProperty('payload')
}

async function readRawOutboxIntent(
  vault: string,
  intentId: string,
): Promise<Record<string, unknown>> {
  const paths = resolveAssistantStatePaths(vault)
  return JSON.parse(
    await readFile(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, intentId),
      'utf8',
    ),
  ) as Record<string, unknown>
}

async function createIntent(
  vault: string,
  overrides: Partial<{
    actorId: string | null
    answeredMailboxItemIds: string[]
    automationAuthority: AssistantOutboxIntent['automationAuthority']
    card: AssistantResponseCard | null
    channel: string | null
    createdAt: string
    deliveryIdempotencyKey: string | null
    dedupeToken: string | null
    explicitTarget: string | null
    identityId: string | null
    message: string
    nativeReplyRequested: true
    replyToMessageId: string | null
    media: AssistantOutboxIntent['media']
    reviewedAssistantAskCompletionExpiresAt: string | null
    sessionId: string
    threadId: string | null
    threadIsDirect: boolean | null
    turnId: string
  }> = {},
): Promise<AssistantOutboxIntent> {
  intentSequence += 1
  const sessionId = overrides.sessionId ?? `session-${intentSequence}`
  const turnId = overrides.turnId ?? `turn-${intentSequence}`

  return createAssistantOutboxIntent({
    actorId: overrides.actorId ?? null,
    answeredMailboxItemIds: overrides.answeredMailboxItemIds,
    automationAuthority: overrides.automationAuthority,
    card: overrides.card ?? null,
    channel: overrides.channel ?? 'telegram',
    createdAt: overrides.createdAt,
    deliveryIdempotencyKey: overrides.deliveryIdempotencyKey,
    dedupeToken:
      overrides.dedupeToken === undefined
        ? `${sessionId}:${turnId}`
        : overrides.dedupeToken,
    explicitTarget: overrides.explicitTarget ?? null,
    identityId: overrides.identityId ?? 'participant-1',
    media: overrides.media ?? [],
    message: overrides.message ?? `${sessionId}:${turnId}:message`,
    reviewedAssistantAskCompletionExpiresAt:
      overrides.reviewedAssistantAskCompletionExpiresAt,
    ...(overrides.nativeReplyRequested === undefined
      ? {}
      : { nativeReplyRequested: overrides.nativeReplyRequested }),
    replyToMessageId: overrides.replyToMessageId ?? null,
    sessionId,
    threadId: overrides.threadId ?? 'thread-1',
    threadIsDirect: overrides.threadIsDirect ?? true,
    turnId,
    vault,
  })
}

function createMessageInput(vault: string): AssistantMessageInput {
  return {
    deliverResponse: true,
    deliveryIdempotencyKey: 'reply-key',
    prompt: 'process this report',
    vault,
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
  return {
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: null,
        deliveryPolicy: 'not-requested',
        effectiveThreadIsDirect: null,
        explicitTarget: null,
        identityId: null,
        replyToMessageId: null,
        threadId: null,
        threadIsDirect: null,
      },
      operatorAuthority: 'direct-operator',
    },
    firstContactStateDocIds: [],
    onboardingGuidanceOpen: false,
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/work',
  }
}

async function useActualOutboundDeliveryImplementation(): Promise<void> {
  const actual = await vi.importActual<typeof import('../src/outbound-channel.ts')>(
    '../src/outbound-channel.ts',
  )
  mockedDeliverAssistantMessageOverBinding.mockImplementation(
    async (input, dependencies) =>
      await actual.deliverAssistantMessageOverBinding(input, dependencies),
  )
}

type AssistantMessageChannelDelivery = Extract<
  AssistantChannelDelivery,
  { kind?: 'message' }
>

function createDelivery(
  overrides: Partial<AssistantMessageChannelDelivery> = {},
): AssistantMessageChannelDelivery {
  return {
    channel: 'telegram',
    idempotencyKey: 'delivery-idempotency',
    messageLength: 12,
    providerMessageId: 'provider-message',
    providerThreadId: 'provider-thread',
    sentAt: '2026-04-08T00:00:00.000Z',
    target: 'participant-1',
    targetKind: 'participant',
    ...overrides,
  }
}

function expectMessageDelivery(
  delivery: AssistantChannelDelivery | null | undefined,
): AssistantMessageChannelDelivery {
  if (!delivery || delivery.kind === 'message-reaction') {
    throw new Error('Expected assistant message delivery.')
  }

  return delivery
}

function createVoiceMemoMedia(): NonNullable<AssistantOutboxIntent['media']>[number] {
  return {
    kind: 'voice_memo',
    filename: 'memo.mp3',
    transcript: null,
    transport: {
      attachmentId: 'attachment_voice_1',
      kind: 'linq_attachment',
    },
  }
}

function createAssistantSession(input?: {
  binding?: AssistantSession['binding']
  sessionId?: string
  turnCount?: number
}): AssistantSession {
  const target = createAssistantModelTarget({
    approvalPolicy: 'never',
    codexHome: null,
    model: 'gpt-5.4',
    oss: false,
    profile: null,
    provider: 'codex-cli',
    reasoningEffort: null,
    sandbox: 'danger-full-access',
  })
  if (!target) {
    throw new Error('Expected assistant session target.')
  }

  return {
    alias: null,
    binding: input?.binding ?? {
      actorId: null,
      channel: null,
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    },
    codexResume: null,
    codexTarget: target,
    conversationId: input?.sessionId ?? 'session-test',
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions: serializeAssistantProviderSessionOptions({
      approvalPolicy: 'never',
      codexHome: null,
      model: 'gpt-5.4',
      oss: false,
      profile: null,
      provider: 'codex-cli',
      reasoningEffort: null,
      sandbox: 'danger-full-access',
    }),
    resumeState: null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: input?.sessionId ?? 'session-test',
    target,
    turnCount: input?.turnCount ?? 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createConfirmationPendingError(): AssistantDeliveryError {
  return {
    code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    message:
      'Assistant outbound delivery may have succeeded already and must be reconciled before resend.',
  }
}
