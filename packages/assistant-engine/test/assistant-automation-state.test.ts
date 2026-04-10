import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  hasAssistantAutoReplyChannel,
  normalizeAssistantAutoReplyChannels,
  reconcileAssistantAutoReplyState,
  sameAssistantAutoReplyState,
} from '../src/assistant/automation-state.js'

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
