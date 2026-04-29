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
      afterCreatedAt: null,
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
      afterCreatedAt: null,
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
        createdAt: '2026-04-10T02:00:01.000Z',
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

function autoReplyState(
  channel: string,
  eligibleAfter: { captureId: string; createdAt?: string | null; occurredAt: string } | null,
  enabledAt = '2026-04-10T00:00:00.000Z',
) {
  return {
    channel,
    enabledAt,
    eligibleAfter,
  }
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
    autoReplyState('custom', {
        captureId: 'cap-custom',
        occurredAt: '2026-04-09T00:00:00.000Z',
      }),
    autoReplyState('telegram', {
        captureId: 'cap-telegram',
        occurredAt: '2026-04-10T00:00:00.000Z',
      }),
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
    autoReplyState('custom', {
        captureId: 'cap-custom',
        occurredAt: '2026-04-08T00:00:00.000Z',
      }),
    autoReplyState('email', {
        captureId: 'cap-email',
        occurredAt: '2026-04-09T00:00:00.000Z',
      }),
    autoReplyState('telegram', {
        captureId: 'cap-telegram',
        occurredAt: '2026-04-09T01:00:00.000Z',
      }),
  ]

  assert.deepEqual(
    reconcileManagedChannels({
      current,
      desiredChannels: ['email', 'linq'],
      eligibleAfter: latestCursor,
      enabledAt: '2026-04-10T01:00:00.000Z',
      isManagedChannel: (channel) => channel !== 'custom',
    }),
    [
      autoReplyState('custom', {
          captureId: 'cap-custom',
          occurredAt: '2026-04-08T00:00:00.000Z',
        }),
      autoReplyState('email', {
          captureId: 'cap-email',
          occurredAt: '2026-04-09T00:00:00.000Z',
        }),
      autoReplyState('linq', latestCursor, '2026-04-10T01:00:00.000Z'),
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
        autoReplyState('telegram', {
            captureId: 'cap-telegram',
            occurredAt: '2026-04-10T00:00:00.000Z',
          }),
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
          afterCreatedAt: input.afterCreatedAt ?? null,
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
      afterCreatedAt: null,
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
    createdAt: '2026-04-10T02:00:01.000Z',
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
          afterCreatedAt: input.afterCreatedAt ?? null,
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
        autoReplyState('custom', {
            captureId: 'cap-custom',
            occurredAt: '2026-04-09T00:00:00.000Z',
          }),
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
              afterCreatedAt: input.afterCreatedAt ?? null,
              afterOccurredAt: input.afterOccurredAt ?? null,
              afterCaptureId: input.afterCaptureId ?? null,
              oldestFirst: input.oldestFirst ?? false,
            },
            items: [
              createListCapture({
                captureId: 'cap-latest',
                createdAt: '2026-04-10T03:00:01.000Z',
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
        enabledAt: '2026-04-10T00:00:00.000Z',
        eligibleAfter: {
          captureId: 'cap-custom',
          occurredAt: '2026-04-09T00:00:00.000Z',
        },
      },
      {
        channel: 'telegram',
        enabledAt: '2026-04-10T03:00:01.000Z',
        eligibleAfter: {
          captureId: 'cap-latest',
          createdAt: '2026-04-10T03:00:01.000Z',
          occurredAt: '2026-04-10T03:00:00.000Z',
        },
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('reconcileManagedAssistantAutoReplyChannelsLocal uses an explicit latest cursor without reading inbox state', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-explicit-cursor-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      inboxScanCursor: null,
      autoReply: [],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    const list = async () => {
      throw new Error('expected explicit cursor seeding to skip inbox lookup')
    }
    const explicitCursor = {
      captureId: 'cap-explicit',
      createdAt: '2026-04-10T04:00:01.000Z',
      occurredAt: '2026-04-10T04:00:00.000Z',
    }

    const result = await reconcileManagedAssistantAutoReplyChannelsLocal({
      desiredChannels: ['linq'],
      inboxServices: { list },
      latestCaptureCursor: explicitCursor,
      vault: vaultRoot,
    })

    assert.equal(result.changed, true)
    assert.deepEqual(result.state.autoReply, [
      {
        channel: 'linq',
        enabledAt: '2026-04-10T04:00:01.000Z',
        eligibleAfter: explicitCursor,
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('enableAssistantAutoReplyChannelLocal seeds a newly enabled channel and reports it as enabled', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-enable-new-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      inboxScanCursor: null,
      autoReply: [],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    const enabled = await enableAssistantAutoReplyChannelLocal({
      channel: 'email',
      latestCaptureCursor: {
        captureId: 'cap-email',
        occurredAt: '2026-04-10T05:00:00.000Z',
      },
      vault: vaultRoot,
    })

    assert.equal(enabled, true)
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
    autoReplyState('telegram', {
        captureId: 'cap-telegram',
        occurredAt: '2026-04-09T00:00:00.000Z',
      }),
  ]

  assert.deepEqual(
    reconcileAssistantAutoReplyState({
      current,
      enabledChannels: ['email', 'telegram'],
      eligibleAfter: latestCursor,
      enabledAt: '2026-04-10T00:00:00.000Z',
    }),
    [
      {
        channel: 'email',
        enabledAt: '2026-04-10T00:00:00.000Z',
        eligibleAfter: latestCursor,
      },
      autoReplyState('telegram', {
          captureId: 'cap-telegram',
          occurredAt: '2026-04-09T00:00:00.000Z',
        }),
    ],
  )
})

test('hasAssistantAutoReplyChannel reports channel membership', () => {
  const autoReply = [
    autoReplyState('email', null),
  ]

  assert.equal(hasAssistantAutoReplyChannel(autoReply, 'email'), true)
  assert.equal(hasAssistantAutoReplyChannel(autoReply, 'telegram'), false)
})

test('sameAssistantAutoReplyState compares channel and cursor identity', () => {
  const baseline = [
    autoReplyState('email', {
        captureId: 'cap-email',
        occurredAt: '2026-04-10T00:00:00.000Z',
      }),
    autoReplyState('telegram', null),
  ]

  assert.equal(
    sameAssistantAutoReplyState(baseline, [
      autoReplyState('email', {
          captureId: 'cap-email',
          occurredAt: '2026-04-10T00:00:00.000Z',
        }),
      autoReplyState('telegram', null),
    ]),
    true,
  )
  assert.equal(
    sameAssistantAutoReplyState(baseline, [
      autoReplyState('email', {
          captureId: 'cap-other',
          occurredAt: '2026-04-10T00:00:00.000Z',
        }),
      autoReplyState('telegram', null),
    ]),
    false,
  )
  assert.equal(
    sameAssistantAutoReplyState(baseline, [
      autoReplyState('telegram', null),
      autoReplyState('email', {
          captureId: 'cap-email',
          occurredAt: '2026-04-10T00:00:00.000Z',
        }),
    ]),
    false,
  )
})
