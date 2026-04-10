import assert from 'node:assert/strict'

import { test } from 'vitest'
import type { AssistantRunEvent } from '@murphai/assistant-engine/assistant-automation'
import type {
  InboxRunEvent,
  RuntimeCaptureRecordInput,
} from '@murphai/inbox-services'

import {
  formatAssistantRunEventForTerminal,
  formatForegroundLogLine,
  formatInboxRunEventForTerminal,
  resolveForegroundTerminalLogOptions,
  UNSAFE_FOREGROUND_LOG_DETAILS_ENV,
} from '../src/foreground-terminal-logging.js'

function createCapture(
  overrides: Partial<RuntimeCaptureRecordInput> = {},
): RuntimeCaptureRecordInput {
  return {
    source: 'telegram',
    externalId: 'msg-01',
    occurredAt: '2026-04-08T00:00:00.000Z',
    thread: {
      id: 'thread-01',
      title: 'Sleep chat',
      isDirect: true,
    },
    actor: {
      id: 'actor-01',
      displayName: 'Alex',
      isSelf: false,
    },
    text: 'Need a follow-up on tonight’s routine and supplements.',
    attachments: [],
    ...overrides,
  }
}

function createAssistantEvent(
  overrides: Partial<AssistantRunEvent> & Pick<AssistantRunEvent, 'type'>,
): AssistantRunEvent {
  return {
    ...overrides,
  }
}

function createInboxEvent(
  overrides: Partial<InboxRunEvent> & Pick<InboxRunEvent, 'type' | 'connectorId' | 'source'>,
): InboxRunEvent {
  return {
    ...overrides,
  }
}

test('foreground terminal logging resolves env flags and formats timestamped lines', () => {
  assert.deepEqual(resolveForegroundTerminalLogOptions(), {
    unsafeDetails: false,
  })
  assert.deepEqual(
    resolveForegroundTerminalLogOptions({
      [UNSAFE_FOREGROUND_LOG_DETAILS_ENV]: 'yes',
    }),
    {
      unsafeDetails: true,
    },
  )
  assert.equal(
    formatForegroundLogLine(
      'assistant',
      'primed channel auto-reply',
      new Date(2026, 3, 8, 3, 4, 5),
    ),
    '[assistant 03:04:05] primed channel auto-reply',
  )
})

test('assistant scan events suppress empty capture counts and summarize non-empty scans', () => {
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'scan.started',
        details: '0 capture(s)',
      }),
    ),
    null,
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'reply.scan.started',
        details: '3 captures pending',
      }),
    ),
    'scanning channel auto-reply: 3 captures pending',
  )
})

test('assistant reply events respect unsafe detail mode and provider progress summaries', () => {
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'reply.scan.started',
        details: '1 capture pending',
      }),
    ),
    'scanning channel auto-reply: 1 capture pending',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'reply.scan.started',
        details: '1 capture pending',
      }),
      { unsafeDetails: true },
    ),
    'scanning channel auto-reply: 1 capture pending',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'capture.reply-progress',
        captureId: 'cap-01',
        details: 'tool invocation in progress',
      }),
    ),
    'reply-progress cap-01: assistant provider turn is using tools',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'capture.reply-progress',
        captureId: 'cap-01',
        details: 'waiting on provider',
      }),
      { unsafeDetails: true },
    ),
    'reply-progress cap-01: waiting on provider',
  )
})

test('assistant terminal logging covers routed, failure, skipped, replied, and daemon events', () => {
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'capture.routed',
        captureId: 'cap-route',
        tools: ['show', 'list'],
      }),
    ),
    'routed cap-route: show, list',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'capture.failed',
        captureId: 'cap-fail',
        details: 'provider rejected the turn',
      }),
    ),
    'failed cap-fail: assistant processing failed',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'capture.skipped',
        captureId: 'cap-skip',
      }),
    ),
    'skipped cap-skip: assistant processing skipped',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'capture.replied',
        captureId: 'cap-replied',
        details: 'message delivered',
      }),
      { unsafeDetails: true },
    ),
    'replied cap-replied: message delivered',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(
      createAssistantEvent({
        type: 'daemon.failed',
        details: 'lost inbox runtime lease',
      }),
    ),
    'inbox daemon failed: lost inbox runtime lease',
  )
})

test('inbox connector events format phase-specific status lines', () => {
  assert.equal(
    formatInboxRunEventForTerminal(
      createInboxEvent({
        type: 'connector.backfill.started',
        connectorId: 'telegram-main',
        source: 'telegram',
      }),
    ),
    'Telegram connector backfill starting',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      createInboxEvent({
        type: 'connector.backfill.finished',
        connectorId: 'telegram-main',
        source: 'telegram',
        counts: {
          imported: 4,
          deduped: 1,
        },
      }),
    ),
    'Telegram connector backfill finished: 4 imported, 1 deduped',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      createInboxEvent({
        type: 'connector.watch.started',
        connectorId: 'telegram-main',
        source: 'telegram',
      }),
    ),
    'Telegram connector watching for new messages',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      createInboxEvent({
        type: 'connector.failed',
        connectorId: 'telegram-main',
        source: 'telegram',
        phase: 'startup',
        details: 'authentication failed',
      }),
      { unsafeDetails: true },
    ),
    'Telegram connector telegram-main startup failed: authentication failed',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      createInboxEvent({
        type: 'connector.skipped',
        connectorId: 'linq-main',
        source: 'linq',
      }),
    ),
    'Linq connector skipped on this host',
  )
})

test('inbox imported-capture summaries redact details by default and expand in unsafe mode', () => {
  const safeEvent = createInboxEvent({
    type: 'capture.imported',
    connectorId: 'telegram-main',
    source: 'telegram',
    phase: 'backfill',
    capture: createCapture({
      attachments: [
        {
          kind: 'image',
          fileName: 'photo.jpg',
        },
      ],
    }),
  })

  assert.equal(
    formatInboxRunEventForTerminal(safeEvent),
    'backfill Telegram capture imported: text + 1 attachment',
  )

  const unsafeEvent = createInboxEvent({
    type: 'capture.imported',
    connectorId: 'telegram-main',
    source: 'telegram',
    phase: 'watch',
    capture: createCapture({
      attachments: [
        {
          kind: 'image',
          fileName: 'photo.jpg',
        },
        {
          kind: 'document',
          fileName: 'plan.pdf',
        },
      ],
    }),
  })

  assert.equal(
    formatInboxRunEventForTerminal(unsafeEvent, { unsafeDetails: true }),
    'new Telegram from Alex in Sleep chat: Need a follow-up on tonight’s routine and supplements. (+2 attachments)',
  )
})

test('inbox imported-capture summaries handle attachment-only and empty payloads', () => {
  assert.equal(
    formatInboxRunEventForTerminal(
      createInboxEvent({
        type: 'capture.imported',
        connectorId: 'agentmail-main',
        source: 'agentmail',
        phase: 'watch',
        capture: createCapture({
          text: null,
          attachments: [
            {
              kind: 'document',
              fileName: 'lab.pdf',
            },
          ],
        }),
      }),
    ),
    'new AgentMail capture imported: 1 attachment',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      createInboxEvent({
        type: 'capture.imported',
        connectorId: 'linq-main',
        source: 'linq',
        phase: 'watch',
        capture: createCapture({
          actor: {
            isSelf: true,
          },
          thread: {
            id: 'thread-self',
          },
          text: '   ',
          attachments: [],
        }),
      }),
      { unsafeDetails: true },
    ),
    'new Linq from you in thread-self: message with no text preview',
  )
})
