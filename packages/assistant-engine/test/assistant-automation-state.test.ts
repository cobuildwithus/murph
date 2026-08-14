import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, vi } from 'vitest'
import type { AssistantInputCursor } from '@murphai/operator-config/assistant-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import {
  hasAssistantAutoReplyChannel,
  normalizeAssistantAutoReplyChannels,
  reconcileAssistantAutoReplyState,
  sameAssistantAutoReplyState,
} from '../src/assistant/automation-state.js'
import {
  enableAssistantAutoReplyChannelLocal,
  managedAssistantAutoReplyChannelsNeedCursorSeed as managedChannelsNeedCursorSeed,
  readLatestAssistantInputSourceCursor,
  removeRetiredLocalEmailAutoReplyChannel,
  reconcileManagedAssistantAutoReplyChannels as reconcileManagedChannels,
  reconcileManagedAssistantAutoReplyChannelsLocal,
} from '../src/assistant/auto-reply-channels.js'
import {
  updateAssistantInputProjection,
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.js'
import type { AssistantInputSource } from '../src/assistant/input-source.js'
import { createStoreBackedAssistantInputSource } from '../src/assistant/input-source.js'
import { runAssistantAutomationPass } from '../src/assistant/automation/run-loop.js'
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from '../src/assistant/store.js'

function autoReplyState(
  channel: string,
  eligibleAfter:
    | AssistantInputCursor
    | { captureId: string; createdAt?: string | null; occurredAt: string }
    | null,
  enabledAt = '2026-04-10T00:00:00.000Z',
) {
  return {
    channel,
    enabledAt,
    eligibleAfter: testAssistantInputCursor(eligibleAfter),
  }
}

function testAssistantInputCursor(
  cursor:
    | AssistantInputCursor
    | { captureId: string; createdAt?: string | null; occurredAt: string }
    | null,
): AssistantInputCursor | null {
  if (!cursor) {
    return null
  }
  if ('inputId' in cursor) {
    return cursor
  }
  return {
    createdAt: cursor.createdAt ?? null,
    inputId: cursor.captureId,
    occurredAt: cursor.occurredAt,
    sourceKind: 'inbox-capture',
  }
}

async function stageHostedAssistantInput(input: {
  createdAt: string
  eventId: string
  laneSeq: string
  occurredAt: string
  source?: string
  text?: string
  vault: string
}) {
  const source = input.source ?? 'telegram'
  return upsertAssistantInputEvent({
    now: new Date(input.createdAt),
    vault: input.vault,
    event: {
      content: {
        text: input.text ?? 'hello',
        transcriptText: input.text ?? 'hello',
        userMessageContent: [
          {
            text: input.text ?? 'hello',
            type: 'text',
          },
        ],
      },
      conversation: {
        accountId: 'account_1',
        actorId: 'actor_1',
        actorIsSelf: false,
        source,
        threadId: 'thread_1',
        threadIsDirect: true,
      },
      occurredAt: input.occurredAt,
      receivedAt: input.createdAt,
      sourceRef: {
        dedupeKey: `dedupe_${input.eventId}`,
        eventId: input.eventId,
        itemId: `item_${input.eventId}`,
        kind: 'hosted-mailbox',
        lane: 'conversation',
        laneSeq: input.laneSeq,
        payloadSchema: 'murph.hosted-mailbox-payload.v1',
        payloadSource: 'inline',
        source: 'hosted-mailbox',
        wakeSchema: 'murph.hosted-execution-wake.v1',
      },
    },
  })
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
    createdAt: null,
    inputId: 'cap-latest',
    occurredAt: '2026-04-10T01:00:00.000Z',
    sourceKind: 'inbox-capture' as const,
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

test('readLatestAssistantInputSourceCursor returns the latest staged input even when projection failed', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-input-cursor-'),
  )

  try {
    await stageHostedAssistantInput({
      createdAt: '2026-04-10T02:00:01.000Z',
      eventId: 'event_earlier',
      laneSeq: '1',
      occurredAt: '2026-04-10T02:00:00.000Z',
      vault: vaultRoot,
    })
    const latest = await stageHostedAssistantInput({
      createdAt: '2026-04-10T03:00:01.000Z',
      eventId: 'event_failed_projection',
      laneSeq: '2',
      occurredAt: '2026-04-10T03:00:00.000Z',
      vault: vaultRoot,
    })
    await updateAssistantInputProjection({
      inputId: latest.inputId,
      projection: {
        lastAttemptedAt: '2026-04-10T03:00:02.000Z',
        reasonCode: 'projection.failed',
        status: 'failed',
      },
      vault: vaultRoot,
    })

    const cursor = await readLatestAssistantInputSourceCursor({
      vault: vaultRoot,
    })

    assert.deepEqual(cursor, {
      ...latest.cursor,
    })
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('readLatestAssistantInputSourceCursor orders same-timestamp hosted inputs by source position before input id', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-input-source-position-'),
  )

  try {
    const older = await stageHostedAssistantInput({
      createdAt: '2026-04-10T03:00:01.000Z',
      eventId: 'event_1',
      laneSeq: '1',
      occurredAt: '2026-04-10T03:00:00.000Z',
      vault: vaultRoot,
    })
    const latest = await stageHostedAssistantInput({
      createdAt: '2026-04-10T03:00:01.000Z',
      eventId: 'event_3',
      laneSeq: '2',
      occurredAt: '2026-04-10T03:00:00.000Z',
      vault: vaultRoot,
    })

    assert.ok(
      older.inputId > latest.inputId,
      'fixture must prove sourcePosition wins when input ids sort in the opposite order',
    )

    const cursor = await readLatestAssistantInputSourceCursor({
      vault: vaultRoot,
    })

    assert.deepEqual(cursor, {
      ...latest.cursor,
    })
    assert.equal(
      cursor?.sourcePosition,
      'hosted-mailbox:conversation:000000000000000000000000000000000000002:item_event_3',
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('readLatestAssistantInputSourceCursor returns null when no input exists', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-input-empty-'),
  )

  try {
    const cursor = await readLatestAssistantInputSourceCursor({
      vault: vaultRoot,
    })

    assert.equal(cursor, null)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('reconcileManagedAssistantAutoReplyChannelsLocal seeds from assistant input when enabling a new managed channel', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-reconcile-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      autoReply: [
        autoReplyState('custom', {
            captureId: 'cap-custom',
            occurredAt: '2026-04-09T00:00:00.000Z',
          }),
      ],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })
    const latest = await stageHostedAssistantInput({
      createdAt: '2026-04-10T03:00:01.000Z',
      eventId: 'event_seed_failed_projection',
      laneSeq: '3',
      occurredAt: '2026-04-10T03:00:00.000Z',
      vault: vaultRoot,
    })
    await updateAssistantInputProjection({
      inputId: latest.inputId,
      projection: {
        lastAttemptedAt: '2026-04-10T03:00:02.000Z',
        reasonCode: 'projection.failed',
        status: 'failed',
      },
      vault: vaultRoot,
    })

    const result = await reconcileManagedAssistantAutoReplyChannelsLocal({
      desiredChannels: ['telegram'],
      isManagedChannel: (channel) => channel !== 'custom',
      vault: vaultRoot,
    })

    assert.equal(result.changed, true)
    assert.deepEqual(result.state.autoReply, [
      {
        channel: 'custom',
        enabledAt: '2026-04-10T00:00:00.000Z',
        eligibleAfter: testAssistantInputCursor({
          captureId: 'cap-custom',
          occurredAt: '2026-04-09T00:00:00.000Z',
        }),
      },
      {
        channel: 'telegram',
        enabledAt: '2026-04-10T03:00:01.000Z',
        eligibleAfter: {
          ...latest.cursor,
        },
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('reconcileManagedAssistantAutoReplyChannelsLocal uses an explicit latest cursor without reading input state', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-explicit-cursor-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      autoReply: [],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    const inputSource: AssistantInputSource = {
      checkpointAcceptedInput: async () => undefined,
      listInputCandidates: async () => {
        throw new Error('expected explicit cursor seeding to skip input lookup')
      },
      listNewConversationInputs: async (query) => ({
        inputs: [],
        nextCursor: query.afterCursor ?? null,
      }),
      refresh: async () => ({
        progressed: false,
        reason: 'no_new_input',
      }),
    }
    const explicitCursor = {
      createdAt: '2026-04-10T04:00:01.000Z',
      inputId: 'ain_explicit',
      occurredAt: '2026-04-10T04:00:00.000Z',
      sourceKind: 'hosted-mailbox' as const,
      sourcePosition: 'hosted-mailbox:conversation:000000000000000000000000000000000000004:item_explicit',
    }

    const result = await reconcileManagedAssistantAutoReplyChannelsLocal({
      desiredChannels: ['linq'],
      inputSource,
      latestInputCursor: explicitCursor,
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

test('removeRetiredLocalEmailAutoReplyChannel deletes only legacy email state and is idempotent', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-retired-email-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      autoReply: [
        autoReplyState('email', null),
        autoReplyState('telegram', null),
        autoReplyState('linq', null),
        autoReplyState('custom', null),
      ],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    const first = await removeRetiredLocalEmailAutoReplyChannel({
      vault: vaultRoot,
    })
    const second = await removeRetiredLocalEmailAutoReplyChannel({
      vault: vaultRoot,
    })

    assert.equal(first.changed, true)
    assert.deepEqual(first.state.autoReply.map((entry) => entry.channel), [
      'custom',
      'linq',
      'telegram',
    ])
    assert.equal(second.changed, false)
    assert.deepEqual(
      (await readAssistantAutomationState(vaultRoot)).autoReply,
      first.state.autoReply,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('a direct local automation pass removes legacy email auto-reply before scanning pending input', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-retired-email-pass-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      autoReply: [autoReplyState('email', null)],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })
    await stageHostedAssistantInput({
      createdAt: '2026-04-10T05:00:01.000Z',
      eventId: 'event_retired_email_pending',
      laneSeq: '5',
      occurredAt: '2026-04-10T05:00:00.000Z',
      source: 'email',
      vault: vaultRoot,
    })
    const onProviderRequestStarted = vi.fn()

    const result = await runAssistantAutomationPass({
      drainOutbox: false,
      inboxServices: {} as InboxServices,
      inputSource: createStoreBackedAssistantInputSource({ vault: vaultRoot }),
      onProviderRequestStarted,
      shouldYieldBackgroundMaintenance: () => true,
      vault: vaultRoot,
    })

    assert.equal(result.replies.considered, 0)
    assert.equal(onProviderRequestStarted.mock.calls.length, 0)
    assert.deepEqual(
      (await readAssistantAutomationState(vaultRoot)).autoReply,
      [],
    )
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
      autoReply: [],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    const enabled = await enableAssistantAutoReplyChannelLocal({
      channel: 'email',
      latestInputCursor: {
        createdAt: null,
        inputId: 'ain_email',
        occurredAt: '2026-04-10T05:00:00.000Z',
        sourceKind: 'hosted-mailbox',
      },
      vault: vaultRoot,
    })

    assert.equal(enabled, true)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('enableAssistantAutoReplyChannelLocal preserves concurrent managed channel updates', async () => {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), 'murph-assistant-auto-reply-enable-concurrent-'),
  )

  try {
    await saveAssistantAutomationState(vaultRoot, {
      version: 1,
      autoReply: [],
      updatedAt: '2026-04-10T00:00:00.000Z',
    })

    await Promise.all([
      enableAssistantAutoReplyChannelLocal({
        channel: 'email',
        latestInputCursor: {
          createdAt: '2026-04-10T06:00:01.000Z',
          inputId: 'ain_email',
          occurredAt: '2026-04-10T06:00:00.000Z',
          sourceKind: 'hosted-mailbox',
        },
        vault: vaultRoot,
      }),
      enableAssistantAutoReplyChannelLocal({
        channel: 'telegram',
        latestInputCursor: {
          createdAt: '2026-04-10T06:01:01.000Z',
          inputId: 'ain_telegram',
          occurredAt: '2026-04-10T06:01:00.000Z',
          sourceKind: 'hosted-mailbox',
        },
        vault: vaultRoot,
      }),
    ])

    const state = await readAssistantAutomationState(vaultRoot)
    assert.deepEqual(
      state.autoReply.map((entry) => entry.channel),
      ['email', 'telegram'],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('reconcileAssistantAutoReplyState preserves existing cursors and seeds new channels', () => {
  const latestCursor = {
    createdAt: null,
    inputId: 'cap-latest',
    occurredAt: '2026-04-10T00:00:00.000Z',
    sourceKind: 'inbox-capture' as const,
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
