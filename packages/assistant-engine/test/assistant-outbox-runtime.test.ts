import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/outbound-channel.ts', () => ({
  deliverAssistantMessageOverBinding: vi.fn(),
}))

import type {
  AssistantChannelDelivery,
  AssistantDeliveryError,
  AssistantOutboxIntent,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  hasAssistantSeenFirstContact,
  resolveAssistantFirstContactStateDocIds,
} from '../src/assistant/first-contact.ts'
import {
  getAssistantBindingContextLines,
} from '../src/assistant/bindings.ts'
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
import { ensureAssistantState } from '../src/assistant/store/persistence.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import * as assistantStore from '../src/assistant/store.ts'
import { getAssistantSession, saveAssistantSession } from '../src/assistant/store.ts'
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
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.ts'
import {
  deliverAssistantMessageOverBinding,
} from '../src/outbound-channel.ts'
import { createTempVaultContext } from './test-helpers.ts'

const mockedDeliverAssistantMessageOverBinding = vi.mocked(
  deliverAssistantMessageOverBinding,
)

const TEST_LINQ_DELIVERY_SOURCE: NonNullable<
  AssistantOutboxIntent['deliverySource']
> = {
  kind: 'linq',
  fromPhoneNumber: '+15550000',
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

  it('repairs a targetless queued dedupe hit before the first dispatch attempt', async () => {
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
      createdAt: '2026-04-08T00:02:00.000Z',
      message: 'later intent',
      sessionId: 'session-list-later',
      turnId: 'turn-list-later',
    })
    const earlier = await createIntent(vaultRoot, {
      createdAt: '2026-04-08T00:01:00.000Z',
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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'))

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

    for (let index = 0; index < 101; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 3, 19, 0, index, 0)).toISOString()
      const seeded = await createIntent(vaultRoot, {
        createdAt,
        message: `terminal-${index}`,
        sessionId: `session-terminal-${index}`,
        turnId: `turn-terminal-${index}`,
      })
      await saveAssistantOutboxIntent(vaultRoot, {
        ...seeded,
        status: index % 2 === 0 ? 'failed' : 'abandoned',
        updatedAt: createdAt,
      })
    }

    const activeRetryable = await createIntent(vaultRoot, {
      createdAt: '2026-03-01T00:10:00.000Z',
      message: 'active retryable intent',
      sessionId: 'session-active-retryable',
      turnId: 'turn-active-retryable',
    })
    await saveAssistantOutboxIntent(vaultRoot, {
      ...activeRetryable,
      nextAttemptAt: '2026-04-20T12:05:00.000Z',
      status: 'retryable',
      updatedAt: '2026-04-20T12:00:00.000Z',
    })

    await expect(
      pruneAssistantTerminalOutboxIntents({
        now: new Date('2026-04-20T12:00:00.000Z'),
        paths,
        vault: vaultRoot,
      }),
    ).resolves.toBe(2)

    const retained = await listAssistantOutboxIntentsLocal(vaultRoot)
    expect(retained).toHaveLength(101)
    expect(retained.filter((intent) => intent.status === 'retryable')).toHaveLength(1)
    expect(
      retained.some((intent) => intent.message === 'old terminal intent'),
    ).toBe(false)
    expect(retained.filter((intent) => intent.status !== 'retryable')).toHaveLength(100)
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

  it('materializes Linq first-contact chats from receipt metadata and upgrades the session binding', async () => {
    const { vaultRoot } = await createAssistantVault('assistant-outbox-linq-first-contact-')
    await useActualOutboundDeliveryImplementation()

    await saveAssistantSession(
      vaultRoot,
      createAssistantSession({
        binding: {
          actorId: '+15550001',
          channel: 'linq',
          conversationKey: 'channel:linq|identity:phone_lookup_1|actor:%2B15550001',
          delivery: {
            kind: 'participant',
            target: '+15550001',
          },
          identityId: 'phone_lookup_1',
          threadId: null,
          threadIsDirect: true,
        },
        sessionId: 'session-linq-first-contact',
      }),
    )
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'welcome',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-linq-first-contact',
      turnId: 'turn-linq-first-contact',
      vault: vaultRoot,
    })
    const queued = await createAssistantOutboxIntent({
      actorId: '+15550001',
      bindingDelivery: {
        kind: 'participant',
        target: '+15550001',
      },
      channel: 'linq',
      deliverySource: TEST_LINQ_DELIVERY_SOURCE,
      deliveryIdempotencyKey: 'idem-linq-first-contact',
      identityId: 'phone_lookup_1',
      message: 'welcome',
      sessionId: 'session-linq-first-contact',
      threadId: null,
      threadIsDirect: true,
      turnId: 'turn-linq-first-contact',
      vault: vaultRoot,
    })
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-message-created',
      providerThreadId: 'linq-chat-created',
      target: 'linq-chat-created',
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq,
      },
      force: true,
      intentId: queued.intentId,
      vault: vaultRoot,
    })

    expect(sendLinq).toHaveBeenCalledWith({
      directRecipientPhoneNumber: '+15550001',
      fromPhoneNumber: '+15550000',
      idempotencyKey: 'idem-linq-first-contact',
      message: 'welcome',
      replyToMessageId: null,
      target: '+15550001',
      targetKind: 'participant',
    })
    expect(mockedDeliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
    expect(dispatched.intent.status).toBe('sent')
    expect(dispatched.intent.delivery).toMatchObject({
      channel: 'linq',
      providerMessageId: 'linq-message-created',
      providerThreadId: 'linq-chat-created',
      target: 'linq-chat-created',
      targetKind: 'thread',
    })
    expect(dispatched.session?.binding).toMatchObject({
      delivery: {
        kind: 'thread',
        target: 'linq-chat-created',
      },
      threadId: 'linq-chat-created',
      threadIsDirect: true,
    })
    await expect(
      getAssistantSession(vaultRoot, 'session-linq-first-contact'),
    ).resolves.toMatchObject({
      binding: {
        delivery: {
          kind: 'thread',
          target: 'linq-chat-created',
        },
        threadId: 'linq-chat-created',
      },
    })
  })

  it('keeps hosted-blinded Linq first-contact sessions on the actor identity after chat creation', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-hosted-first-contact-',
    )
    await useActualOutboundDeliveryImplementation()

    await saveAssistantSession(
      vaultRoot,
      createAssistantSession({
        binding: {
          actorId: 'hid_linq_actor_1',
          channel: 'linq',
          conversationKey: 'channel:linq|identity:hid_linq_identity_1|actor:hid_linq_actor_1',
          delivery: {
            kind: 'participant',
            target: '+15550100001',
          },
          identityId: 'hid_linq_identity_1',
          threadId: null,
          threadIsDirect: true,
        },
        sessionId: 'session-linq-hosted-first-contact',
      }),
    )
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'welcome',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-linq-hosted-first-contact',
      turnId: 'turn-linq-hosted-first-contact',
      vault: vaultRoot,
    })
    const queued = await createAssistantOutboxIntent({
      actorId: 'hid_linq_actor_1',
      bindingDelivery: {
        kind: 'participant',
        target: '+15550100001',
      },
      channel: 'linq',
      deliverySource: TEST_LINQ_DELIVERY_SOURCE,
      deliveryIdempotencyKey: 'idem-linq-hosted-first-contact',
      identityId: 'hid_linq_identity_1',
      message: 'welcome',
      sessionId: 'session-linq-hosted-first-contact',
      threadId: null,
      threadIsDirect: true,
      turnId: 'turn-linq-hosted-first-contact',
      vault: vaultRoot,
    })
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-message-hosted-created',
      providerThreadId: 'linq-chat-hosted-created',
      target: 'linq-chat-hosted-created',
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq,
      },
      force: true,
      intentId: queued.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sent')
    expect(dispatched.intent).toMatchObject({
      bindingDelivery: {
        kind: 'thread',
        target: 'linq-chat-hosted-created',
      },
      threadId: null,
    })
    expect(dispatched.session?.binding).toMatchObject({
      actorId: 'hid_linq_actor_1',
      conversationKey: 'channel:linq|identity:hid_linq_identity_1|actor:hid_linq_actor_1',
      delivery: {
        kind: 'thread',
        target: 'linq-chat-hosted-created',
      },
      identityId: 'hid_linq_identity_1',
      threadId: null,
      threadIsDirect: true,
    })
    await expect(
      getAssistantSession(vaultRoot, 'session-linq-hosted-first-contact'),
    ).resolves.toMatchObject({
      binding: {
        conversationKey: 'channel:linq|identity:hid_linq_identity_1|actor:hid_linq_actor_1',
        delivery: {
          kind: 'thread',
          target: 'linq-chat-hosted-created',
        },
        threadId: null,
      },
    })
    expect(
      getAssistantBindingContextLines(dispatched.session!.binding),
    ).not.toContain('thread: linq-chat-hosted-created')
  })

  it('keeps materialized Linq first-contact intents retryable without forgetting the resolved chat binding', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-first-contact-persist-failure-',
    )
    await useActualOutboundDeliveryImplementation()

    await saveAssistantSession(
      vaultRoot,
      createAssistantSession({
        binding: {
          actorId: '+15550001',
          channel: 'linq',
          conversationKey: 'channel:linq|identity:phone_lookup_1|actor:%2B15550001',
          delivery: {
            kind: 'participant',
            target: '+15550001',
          },
          identityId: 'phone_lookup_1',
          threadId: null,
          threadIsDirect: true,
        },
        sessionId: 'session-linq-first-contact-persist-failure',
      }),
    )
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'welcome',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-linq-first-contact-persist-failure',
      turnId: 'turn-linq-first-contact-persist-failure',
      vault: vaultRoot,
    })
    const queued = await createAssistantOutboxIntent({
      actorId: '+15550001',
      bindingDelivery: {
        kind: 'participant',
        target: '+15550001',
      },
      channel: 'linq',
      deliverySource: TEST_LINQ_DELIVERY_SOURCE,
      deliveryIdempotencyKey: 'idem-linq-first-contact-persist-failure',
      identityId: 'phone_lookup_1',
      message: 'welcome',
      sessionId: 'session-linq-first-contact-persist-failure',
      threadId: null,
      threadIsDirect: true,
      turnId: 'turn-linq-first-contact-persist-failure',
      vault: vaultRoot,
    })
    const persistDeliveredIntent = vi.fn()
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-message-created',
      providerThreadId: 'linq-chat-created',
      target: 'linq-chat-created',
    })
    const originalSaveAssistantSession = assistantStore.saveAssistantSession
    const saveAssistantSessionSpy = vi
      .spyOn(assistantStore, 'saveAssistantSession')
      .mockImplementation(async (...args) => {
        const [, session] = args
        if (
          session.sessionId === 'session-linq-first-contact-persist-failure' &&
          session.binding.threadId === 'linq-chat-created'
        ) {
          throw new Error('session persist failed')
        }
        return await originalSaveAssistantSession(...args)
      })

    try {
      const dispatched = await dispatchAssistantOutboxIntent({
        dependencies: {
          sendLinq,
        },
        dispatchHooks: {
          persistDeliveredIntent,
        },
        force: true,
        intentId: queued.intentId,
        vault: vaultRoot,
      })

      expect(dispatched.intent.status).toBe('retryable')
      expect(dispatched.intent.deliveryConfirmationPending).toBe(true)
      expect(dispatched.deliveryError).toMatchObject({
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      })
      expect(persistDeliveredIntent).not.toHaveBeenCalled()
      await expect(
        readAssistantOutboxIntent(vaultRoot, queued.intentId),
      ).resolves.toMatchObject({
        bindingDelivery: {
          kind: 'thread',
          target: 'linq-chat-created',
        },
        delivery: {
          channel: 'linq',
          providerMessageId: 'linq-message-created',
          providerThreadId: 'linq-chat-created',
          target: 'linq-chat-created',
          targetKind: 'thread',
        },
        deliveryConfirmationPending: true,
        status: 'retryable',
        threadId: 'linq-chat-created',
      })
      await expect(
        getAssistantSession(vaultRoot, 'session-linq-first-contact-persist-failure'),
      ).resolves.toMatchObject({
        binding: {
          delivery: {
            kind: 'participant',
            target: '+15550001',
          },
          threadId: null,
        },
      })

      sendLinq.mockClear()
      const reconciled = await dispatchAssistantOutboxIntent({
        dependencies: {
          sendLinq,
        },
        dispatchHooks: {
          resolveDeliveredIntent: async ({ intent }) => intent.delivery,
        },
        force: true,
        intentId: queued.intentId,
        vault: vaultRoot,
      })

      expect(sendLinq).not.toHaveBeenCalled()
      expect(reconciled.intent.status).toBe('sent')
      expect(reconciled.intent.delivery).toMatchObject({
        providerThreadId: 'linq-chat-created',
        target: 'linq-chat-created',
      })
    } finally {
      saveAssistantSessionSpy.mockRestore()
    }
  })

  it('reconciles materialized Linq first-contact retries locally without sending again', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-first-contact-local-reconcile-',
    )
    await useActualOutboundDeliveryImplementation()

    await saveAssistantSession(
      vaultRoot,
      createAssistantSession({
        binding: {
          actorId: '+15550101',
          channel: 'linq',
          conversationKey:
            'channel:linq|identity:phone_lookup_local|actor:%2B15550101',
          delivery: {
            kind: 'participant',
            target: '+15550101',
          },
          identityId: 'phone_lookup_local',
          threadId: null,
          threadIsDirect: true,
        },
        sessionId: 'session-linq-first-contact-local-reconcile',
      }),
    )
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'welcome',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-linq-first-contact-local-reconcile',
      turnId: 'turn-linq-first-contact-local-reconcile',
      vault: vaultRoot,
    })
    const queued = await createAssistantOutboxIntent({
      actorId: '+15550101',
      bindingDelivery: {
        kind: 'participant',
        target: '+15550101',
      },
      channel: 'linq',
      deliverySource: TEST_LINQ_DELIVERY_SOURCE,
      deliveryIdempotencyKey: 'idem-linq-first-contact-local-reconcile',
      identityId: 'phone_lookup_local',
      message: 'welcome',
      sessionId: 'session-linq-first-contact-local-reconcile',
      threadId: null,
      threadIsDirect: true,
      turnId: 'turn-linq-first-contact-local-reconcile',
      vault: vaultRoot,
    })
    const originalSaveAssistantSession = assistantStore.saveAssistantSession
    const saveAssistantSessionSpy = vi
      .spyOn(assistantStore, 'saveAssistantSession')
      .mockImplementation(async (...args) => {
        const [, session] = args
        if (
          session.sessionId === 'session-linq-first-contact-local-reconcile' &&
          session.binding.threadId === 'linq-chat-created-local'
        ) {
          throw new Error('session persist failed')
        }
        return await originalSaveAssistantSession(...args)
      })
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-message-created-local',
      providerThreadId: 'linq-chat-created-local',
      target: 'linq-chat-created-local',
    })

    try {
      const dispatched = await dispatchAssistantOutboxIntent({
        dependencies: {
          sendLinq,
        },
        force: true,
        intentId: queued.intentId,
        vault: vaultRoot,
      })

      expect(sendLinq).toHaveBeenCalledTimes(1)
      expect(dispatched.intent.status).toBe('retryable')
      expect(dispatched.intent.deliveryConfirmationPending).toBe(true)
      expect(dispatched.intent.delivery).toMatchObject({
        providerMessageId: 'linq-message-created-local',
        providerThreadId: 'linq-chat-created-local',
        target: 'linq-chat-created-local',
        targetKind: 'thread',
      })
      expect(dispatched.deliveryError).toMatchObject({
        code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      })
      await expect(
        readAssistantOutboxIntent(vaultRoot, queued.intentId),
      ).resolves.toMatchObject({
        bindingDelivery: {
          kind: 'thread',
          target: 'linq-chat-created-local',
        },
        delivery: {
          providerMessageId: 'linq-message-created-local',
          providerThreadId: 'linq-chat-created-local',
          target: 'linq-chat-created-local',
          targetKind: 'thread',
        },
        deliveryConfirmationPending: true,
        status: 'retryable',
        threadId: 'linq-chat-created-local',
      })

      sendLinq.mockClear()
      const reconciled = await dispatchAssistantOutboxIntent({
        dependencies: {
          sendLinq,
        },
        force: true,
        intentId: queued.intentId,
        vault: vaultRoot,
      })

      expect(sendLinq).not.toHaveBeenCalled()
      expect(reconciled.intent.status).toBe('sent')
      expect(reconciled.intent.delivery).toMatchObject({
        providerMessageId: 'linq-message-created-local',
        providerThreadId: 'linq-chat-created-local',
        target: 'linq-chat-created-local',
      })
    } finally {
      saveAssistantSessionSpy.mockRestore()
    }
  })

  it('treats missing Linq chat ids after materialized send as confirmation-pending', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-first-contact-missing-chat-',
    )
    await useActualOutboundDeliveryImplementation()

    await saveAssistantSession(
      vaultRoot,
      createAssistantSession({
        binding: {
          actorId: '+15550001',
          channel: 'linq',
          conversationKey: 'channel:linq|identity:phone_lookup_1|actor:%2B15550001',
          delivery: {
            kind: 'participant',
            target: '+15550001',
          },
          identityId: 'phone_lookup_1',
          threadId: null,
          threadIsDirect: true,
        },
        sessionId: 'session-linq-first-contact-missing-chat',
      }),
    )
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'welcome',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-linq-first-contact-missing-chat',
      turnId: 'turn-linq-first-contact-missing-chat',
      vault: vaultRoot,
    })
    const queued = await createAssistantOutboxIntent({
      actorId: '+15550001',
      bindingDelivery: {
        kind: 'participant',
        target: '+15550001',
      },
      channel: 'linq',
      deliverySource: TEST_LINQ_DELIVERY_SOURCE,
      deliveryIdempotencyKey: 'idem-linq-first-contact-missing-chat',
      identityId: 'phone_lookup_1',
      message: 'welcome',
      sessionId: 'session-linq-first-contact-missing-chat',
      threadId: null,
      threadIsDirect: true,
      turnId: 'turn-linq-first-contact-missing-chat',
      vault: vaultRoot,
    })
    const persistDeliveredIntent = vi.fn()
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-message-created',
      providerThreadId: null,
      target: null,
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq,
      },
      dispatchHooks: {
        persistDeliveredIntent,
      },
      force: true,
      intentId: queued.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('retryable')
    expect(dispatched.intent.deliveryConfirmationPending).toBe(true)
    expect(dispatched.deliveryError).toMatchObject({
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    })
    expect(persistDeliveredIntent).not.toHaveBeenCalled()
    await expect(
      getAssistantSession(vaultRoot, 'session-linq-first-contact-missing-chat'),
    ).resolves.toMatchObject({
      binding: {
        delivery: {
          kind: 'participant',
          target: '+15550001',
        },
        threadId: null,
      },
    })
  })

  it('upgrades the Linq thread binding without marking first-contact state on outbox delivery alone', async () => {
    const { vaultRoot } = await createAssistantVault(
      'assistant-outbox-linq-first-contact-thread-seen-',
    )
    await useActualOutboundDeliveryImplementation()

    await saveAssistantSession(
      vaultRoot,
      createAssistantSession({
        binding: {
          actorId: '+15550001',
          channel: 'linq',
          conversationKey: 'channel:linq|identity:phone_lookup_1|actor:%2B15550001',
          delivery: {
            kind: 'participant',
            target: '+15550001',
          },
          identityId: 'phone_lookup_1',
          threadId: null,
          threadIsDirect: true,
        },
        sessionId: 'session-linq-first-contact-thread-seen',
      }),
    )
    await createAssistantTurnReceipt({
      deliveryRequested: true,
      prompt: 'welcome',
      provider: 'codex-cli',
      providerModel: 'gpt-5.4',
      sessionId: 'session-linq-first-contact-thread-seen',
      turnId: 'turn-linq-first-contact-thread-seen',
      vault: vaultRoot,
    })
    const queued = await createAssistantOutboxIntent({
      actorId: '+15550001',
      bindingDelivery: {
        kind: 'participant',
        target: '+15550001',
      },
      channel: 'linq',
      deliverySource: TEST_LINQ_DELIVERY_SOURCE,
      deliveryIdempotencyKey: 'idem-linq-first-contact-thread-seen',
      identityId: 'phone_lookup_1',
      message: 'welcome',
      sessionId: 'session-linq-first-contact-thread-seen',
      threadId: null,
      threadIsDirect: true,
      turnId: 'turn-linq-first-contact-thread-seen',
      vault: vaultRoot,
    })
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-message-created',
      providerThreadId: 'linq-chat-created-local',
      target: 'linq-chat-created-local',
    })

    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendLinq,
      },
      force: true,
      intentId: queued.intentId,
      vault: vaultRoot,
    })

    expect(dispatched.intent.status).toBe('sent')
    await expect(
      getAssistantSession(vaultRoot, 'session-linq-first-contact-thread-seen'),
    ).resolves.toMatchObject({
      binding: {
        delivery: {
          kind: 'thread',
          target: 'linq-chat-created-local',
        },
        threadId: 'linq-chat-created-local',
      },
    })
    await expect(
      hasAssistantSeenFirstContact({
        docIds: resolveAssistantFirstContactStateDocIds({
          actorId: null,
          channel: 'linq',
          identityId: 'phone_lookup_1',
          threadId: 'linq-chat-created-local',
          threadIsDirect: true,
        }),
        vault: vaultRoot,
      }),
    ).resolves.toBe(false)
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
    expect(
      'diagnosticContext' in (failed.intent.lastError as Record<string, unknown>),
    ).toBe(false)

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

  it('keeps diagnostic context out of high-level delivery helper results', async () => {
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
    channel: string | null
    createdAt: string
    deliveryIdempotencyKey: string | null
    dedupeToken: string | null
    explicitTarget: string | null
    identityId: string | null
    message: string
    replyToMessageId: string | null
    media: AssistantOutboxIntent['media']
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
    url: null,
    mimeType: 'audio/mpeg',
    filename: 'memo.mp3',
    sizeBytes: 128,
    transcript: 'Short memo',
    source: 'elevenlabs',
    voiceId: 'voice_murph',
    modelId: 'eleven_multilingual_v2',
    transportRefs: {
      linq: {
        attachmentId: 'attachment_voice_1',
      },
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
