import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  inboxListResultSchema,
  type InboxListResult,
} from '@murphai/operator-config/inbox-cli-contracts'
import {
  hasAssistantAutoReplyChannel,
  normalizeAssistantAutoReplyChannels,
  reconcileAssistantAutoReplyState,
  sameAssistantAutoReplyState,
} from '../src/assistant/automation-state.js'
import {
  enableAssistantAutoReplyChannelLocal,
  managedAssistantAutoReplyChannelsNeedCursorSeed as managedChannelsNeedCursorSeed,
  readLatestPersistedInboxCaptureCursor,
  reconcileManagedAssistantAutoReplyChannels as reconcileManagedChannels,
  reconcileManagedAssistantAutoReplyChannelsLocal,
} from '../src/assistant/auto-reply-channels.js'
import { saveAssistantAutomationState } from '../src/assistant/store.js'

function createInboxListResult(
  overrides: Partial<InboxListResult> = {},
): InboxListResult {
  return inboxListResultSchema.parse({
    vault: 'vault-test',
    filters: {
      sourceId: null,
      limit: 1,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: false,
    },
    items: [],
    ...overrides,
  })
}

function createListCapture(
  overrides: Partial<InboxListResult['items'][number]> = {},
): InboxListResult['items'][number] {
  return inboxListResultSchema.parse({
    vault: 'vault-test',
    filters: {
      sourceId: null,
      limit: 1,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: false,
    },
    items: [
      {
        captureId: 'cap-latest',
        source: 'telegram',
        accountId: 'account-1',
        externalId: 'external-1',
        threadId: 'thread-1',
        threadTitle: 'Thread',
        threadIsDirect: true,
        actorId: 'actor-1',
        actorName: 'Taylor',
        actorIsSelf: false,
        occurredAt: '2026-04-10T02:00:00.000Z',
        receivedAt: null,
        text: 'hello',
        attachmentCount: 0,
        envelopePath: 'inbox/telegram/cap-latest.json',
        eventId: 'event-1',
        promotions: [],
        ...overrides,
      },
    ],
  }).items[0]
}
test('normalizeAssistantAutoReplyChannels trims, dedupes, and sorts channels', () => {
  assert.deepEqual(
    normalizeAssistantAutoReplyChannels([
      ' telegram ',
      'email',
      '',
      'telegram',
      'linq',
    ]),
    ['email', 'linq', 'telegram'],
  )
})

test('managed helper seeds only when a new managed channel is added', () => {
  const current = [
    {
      channel: 'custom',
      cursor: {
        captureId: 'cap-custom',
        occurredAt: '2026-04-09T00:00:00.000Z',
      },
    },
    {
      channel: 'telegram',
      cursor: {
        captureId: 'cap-telegram',
        occurredAt: '2026-04-10T00:00:00.000Z',
      },
    },
  ]

  assert.equal(
    managedChannelsNeedCursorSeed({
      current,
      desiredChannels: ['telegram'],
      isManagedChannel: (channel) => channel !== 'custom',
    }),
    false,
  )
  assert.equal(
    managedChannelsNeedCursorSeed({
      current,
      desiredChannels: ['email', 'telegram'],
      isManagedChannel: (channel) => channel !== 'custom',
    }),
    true,
  )
})

test('managed helper preserves unmanaged entries and prunes disabled managed ones', () => {
  const latestCursor = {
    captureId: 'cap-latest',
    occurredAt: '2026-04-10T01:00:00.000Z',
  }
  const current = [
    {
      channel: 'custom',
      cursor: {
        captureId: 'cap-custom',
        occurredAt: '2026-04-08T00:00:00.000Z',
      },
    },
    {
      channel: 'email',
      cursor: {
        captureId: 'cap-email',
        occurredAt: '2026-04-09T00:00:00.000Z',
      },
    },
    {
      channel: 'telegram',
      cursor: {
        captureId: 'cap-telegram',
        occurredAt: '2026-04-09T01:00:00.000Z',
      },
    },
  ]

  assert.deepEqual(
    reconcileManagedChannels({
      current,
      desiredChannels: ['email', 'linq'],
      latestCaptureCursor: latestCursor,
      isManagedChannel: (channel) => channel !== 'custom',
    }),
    [
      {
        channel: 'custom',
        cursor: {
          captureId: 'cap-custom',
          occurredAt: '2026-04-08T00:00:00.000Z',
        },
      },
      {
        channel: 'email',
        cursor: {
          captureId: 'cap-email',
          occurredAt: '2026-04-09T00:00:00.000Z',
        },
      },
      {
        channel: 'linq',
        cursor: latestCursor,
      },
    ],
  )
})

test('enableAssistantAutoReplyChannelLocal returns true when the channel is already enabled', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-enabled-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      inboxScanCursor: null,
      autoReply: [
        {
          channel: 'telegram',
          cursor: {
            captureId: 'cap-telegram',
            occurredAt: '2026-04-10T00:00:00.000Z',
          },
        },
      ],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    const enabled = await enableAssistantAutoReplyChannelLocal({
      channel: 'telegram',
      vault: vaultRoot,
    })

    assert.equal(enabled, true)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('readLatestPersistedInboxCaptureCursor returns the latest stored cursor when available', async () => {
  const calls: unknown[] = []
  const cursor = await readLatestPersistedInboxCaptureCursor('vault-test', {
    list: async (input) => {
      calls.push(input)
      return createInboxListResult({
        vault: input.vault,
        filters: {
          sourceId: input.sourceId ?? null,
          limit: input.limit ?? 1,
          afterOccurredAt: input.afterOccurredAt ?? null,
          afterCaptureId: input.afterCaptureId ?? null,
          oldestFirst: input.oldestFirst ?? false,
        },
        items: [createListCapture()],
      })
    },
  })

  assert.deepEqual(calls, [
    {
      afterCaptureId: null,
      afterOccurredAt: null,
      limit: 1,
      oldestFirst: false,
      requestId: null,
      sourceId: null,
      vault: 'vault-test',
    },
  ])
  assert.deepEqual(cursor, {
    captureId: 'cap-latest',
    occurredAt: '2026-04-10T02:00:00.000Z',
  })
})

test('readLatestPersistedInboxCaptureCursor returns null when no captures exist', async () => {
  const cursor = await readLatestPersistedInboxCaptureCursor('vault-empty', {
    list: async (input) =>
      createInboxListResult({
        vault: input.vault,
        filters: {
          sourceId: input.sourceId ?? null,
          limit: input.limit ?? 1,
          afterOccurredAt: input.afterOccurredAt ?? null,
          afterCaptureId: input.afterCaptureId ?? null,
          oldestFirst: input.oldestFirst ?? false,
        },
      }),
  })

  assert.equal(cursor, null)
})

test('reconcileManagedAssistantAutoReplyChannelsLocal writes seeded state when enabling a new managed channel', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-reconcile-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      inboxScanCursor: null,
      autoReply: [
        {
          channel: 'custom',
          cursor: {
            captureId: 'cap-custom',
            occurredAt: '2026-04-09T00:00:00.000Z',
          },
        },
      ],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    const result = await reconcileManagedAssistantAutoReplyChannelsLocal({
      desiredChannels: ['telegram'],
      inboxServices: {
        list: async (input) =>
          createInboxListResult({
            vault: input.vault,
            filters: {
              sourceId: input.sourceId ?? null,
              limit: input.limit ?? 1,
              afterOccurredAt: input.afterOccurredAt ?? null,
              afterCaptureId: input.afterCaptureId ?? null,
              oldestFirst: input.oldestFirst ?? false,
            },
            items: [
              createListCapture({
                captureId: 'cap-latest',
                occurredAt: '2026-04-10T03:00:00.000Z',
              }),
            ],
          }),
      },
      isManagedChannel: (channel) => channel !== 'custom',
      vault: vaultRoot,
    })

    assert.equal(result.changed, true)
    assert.deepEqual(result.state.autoReply, [
      {
        channel: 'custom',
        cursor: {
          captureId: 'cap-custom',
          occurredAt: '2026-04-09T00:00:00.000Z',
        },
      },
      {
        channel: 'telegram',
        cursor: {
          captureId: 'cap-latest',
          occurredAt: '2026-04-10T03:00:00.000Z',
        },
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('reconcileAssistantAutoReplyState preserves existing cursors and seeds new channels', () => {
  const latestCursor = {
    captureId: 'cap-latest',
    occurredAt: '2026-04-10T00:00:00.000Z',
  }
  const current = [
    {
      channel: 'telegram',
      cursor: {
        captureId: 'cap-telegram',
        occurredAt: '2026-04-09T00:00:00.000Z',
      },
    },
  ]

  assert.deepEqual(
    reconcileAssistantAutoReplyState({
      current,
      enabledChannels: ['email', 'telegram'],
      latestCursor,
    }),
    [
      {
        channel: 'email',
        cursor: latestCursor,
      },
      {
        channel: 'telegram',
        cursor: {
          captureId: 'cap-telegram',
          occurredAt: '2026-04-09T00:00:00.000Z',
        },
      },
    ],
  )
})

test('hasAssistantAutoReplyChannel reports channel membership', () => {
  const autoReply = [
    {
      channel: 'email',
      cursor: null,
    },
  ]

  assert.equal(hasAssistantAutoReplyChannel(autoReply, 'email'), true)
  assert.equal(hasAssistantAutoReplyChannel(autoReply, 'telegram'), false)
})

test('sameAssistantAutoReplyState compares channel and cursor identity', () => {
  const baseline = [
    {
      channel: 'email',
      cursor: {
        captureId: 'cap-email',
        occurredAt: '2026-04-10T00:00:00.000Z',
      },
    },
    {
      channel: 'telegram',
      cursor: null,
    },
  ]

  assert.equal(
    sameAssistantAutoReplyState(baseline, [
      {
        channel: 'email',
        cursor: {
          captureId: 'cap-email',
          occurredAt: '2026-04-10T00:00:00.000Z',
        },
      },
      {
        channel: 'telegram',
        cursor: null,
      },
    ]),
    true,
  )
  assert.equal(
    sameAssistantAutoReplyState(baseline, [
      {
        channel: 'email',
        cursor: {
          captureId: 'cap-other',
          occurredAt: '2026-04-10T00:00:00.000Z',
        },
      },
      {
        channel: 'telegram',
        cursor: null,
      },
    ]),
    false,
  )
  assert.equal(
    sameAssistantAutoReplyState(baseline, [
      {
        channel: 'telegram',
        cursor: null,
      },
      {
        channel: 'email',
        cursor: {
          captureId: 'cap-email',
          occurredAt: '2026-04-10T00:00:00.000Z',
        },
      },
    ]),
    false,
  )
})
