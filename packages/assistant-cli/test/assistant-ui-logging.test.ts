import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import {
  formatAssistantRunEventForTerminal,
  formatForegroundLogLine,
  formatInboxRunEventForTerminal,
  resolveForegroundTerminalLogOptions,
  UNSAFE_FOREGROUND_LOG_DETAILS_ENV,
} from '../src/run-terminal-logging.js'
import {
  resolveAssistantQueuedPromptDisposition,
  resolveAssistantSelectionAfterSessionSync,
} from '../src/assistant/ui/chat-controller-state.js'
import {
  mergeComposerDraftWithQueuedPrompts,
  formatQueuedFollowUpPreview,
} from '../src/assistant/ui/composer-terminal.js'
import {
  resolveChatSubmitAction,
  shouldClearComposerForSubmitAction,
} from '../src/assistant/ui/view-model.js'

function createSession(
  overrides: Partial<AssistantSession> = {},
): AssistantSession {
  return {
    schema: 'murph.assistant-session.v1',
    sessionId: 'asst_demo',
    target: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OLLAMA_API_KEY',
      endpoint: 'http://127.0.0.1:11434/v1',
      headers: null,
      model: null,
      presetId: null,
      providerName: 'ollama',
      reasoningEffort: null,
      webSearch: null,
    },
    resumeState: null,
    provider: 'openai-compatible',
    providerOptions: {
      continuityFingerprint: 'fingerprint-ui-logging',
      model: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      executionDriver: 'openai-compatible',
      providerName: 'ollama',
      resumeKind: null,
      headers: null,
    },
    alias: 'chat:demo',
    binding: {
      conversationKey: null,
      channel: null,
      identityId: null,
      actorId: null,
      threadId: null,
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 1,
    ...overrides,
  }
}

test('assistant CLI foreground logging resolves unsafe logging flags and stable timestamps', () => {
  assert.deepEqual(resolveForegroundTerminalLogOptions({}), {
    unsafeDetails: false,
  })
  assert.deepEqual(
    resolveForegroundTerminalLogOptions({
      [UNSAFE_FOREGROUND_LOG_DETAILS_ENV]: ' YES ',
    }),
    {
      unsafeDetails: true,
    },
  )
  assert.deepEqual(
    resolveForegroundTerminalLogOptions({
      [UNSAFE_FOREGROUND_LOG_DETAILS_ENV]: ' maybe ',
    }),
    {
      unsafeDetails: false,
    },
  )

  assert.equal(
    formatForegroundLogLine(
      'assistant',
      'provider turn started',
      new Date(2026, 3, 8, 9, 7, 5),
    ),
    '[assistant 09:07:05] provider turn started',
  )
})

test('assistant CLI foreground logging redacts provider turn details by default', () => {
  const event: Parameters<typeof formatAssistantRunEventForTerminal>[0] = {
    captureId: 'cap_safe_123',
    details: 'telegram -> +15550001111',
    type: 'capture.replied',
  }

  const safeMessage = formatAssistantRunEventForTerminal(event)
  const unsafeMessage = formatAssistantRunEventForTerminal(event, {
    unsafeDetails: true,
  })

  assert.equal(safeMessage, 'replied cap_safe_123')
  assert.doesNotMatch(safeMessage ?? '', /\+15550001111/u)
  assert.equal(unsafeMessage, 'replied cap_safe_123: telegram -> +15550001111')
})

test('assistant CLI foreground logging keeps safe auto-reply summaries while hiding raw search progress', () => {
  const event: Parameters<typeof formatAssistantRunEventForTerminal>[0] = {
    captureId: 'cap_safe_123',
    details: 'Web: treehouse menu',
    providerKind: 'search',
    providerState: 'running',
    type: 'capture.reply-progress',
  }

  assert.equal(
    formatAssistantRunEventForTerminal(event),
    'reply-progress cap_safe_123: searching the web',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(event, { unsafeDetails: true }),
    'reply-progress cap_safe_123: Web: treehouse menu',
  )
})

test('assistant CLI foreground logging summarizes reply scans', () => {
  assert.equal(
    formatAssistantRunEventForTerminal({
      type: 'reply.scan.started',
    }),
    'scanning channel auto-reply:',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: '2 capture(s)',
      type: 'reply.scan.started',
    }),
    'scanning channel auto-reply: 2 capture(s)',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: '0 capture(s)',
      type: 'reply.scan.started',
    }),
    null,
  )
})

test('assistant CLI foreground logging skips empty scans and summarizes routing and daemon failures', () => {
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: '0 capture(s)',
      type: 'scan.started',
    }),
    null,
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: '0 capture(s)',
      type: 'reply.scan.started',
    }),
    null,
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: 'captures pending',
      type: 'scan.started',
    }),
    'scanning inbox decisions: captures pending',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_route_123',
      tools: ['search', 'query'],
      type: 'capture.routed',
    }),
    'routed cap_route_123: search, query',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_start_123',
      details: 'provider startup',
      type: 'capture.reply-started',
    }),
    'reply-started cap_start_123: assistant provider turn started',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: 'loopback unavailable',
      type: 'daemon.failed',
    }),
    'inbox daemon failed loopback unavailable',
  )
})

test('assistant CLI foreground logging preserves safe details and stable fallbacks across assistant event types', () => {
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_safe_noop',
      details: 'assistant result already exists',
      type: 'capture.noop',
    }),
    'noop cap_safe_noop: assistant result already exists',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_skip_retry',
      details:
        'temporary network issue. Will retry this capture after the provider reconnects.',
      type: 'capture.reply-skipped',
    }),
    'reply-skipped cap_skip_retry: waiting for provider reconnect',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_failed_safe',
      details: 'provider raw error',
      errorCode: 'network_timeout',
      safeDetails: 'assistant provider timed out safely',
      type: 'capture.reply-failed',
    }),
    'reply-failed cap_failed_safe: assistant provider timed out safely',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_failed_fallback',
      errorCode: 'network_timeout',
      type: 'capture.reply-failed',
    }),
    'reply-failed cap_failed_fallback: assistant reply failed (network_timeout)',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_failed_unsafe',
      details: 'provider raw error',
      safeDetails: 'assistant provider timed out safely',
      type: 'capture.reply-failed',
    }, {
      unsafeDetails: true,
    }),
    'reply-failed cap_failed_unsafe: provider raw error',
  )
})

test('assistant CLI foreground logging summarizes provider progress for each top-level provider kind', () => {
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_command_running',
      providerKind: 'command',
      providerState: 'running',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_command_running: running assistant command',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_command_safe',
      providerKind: 'command',
      providerState: 'completed',
      safeDetails: 'assistant command ended cleanly',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_command_safe: assistant command ended cleanly',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_file_done',
      providerKind: 'file',
      providerState: 'completed',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_file_done: file update finished',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_plan_running',
      providerKind: 'plan',
      providerState: 'running',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_plan_running: updating plan',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_reasoning_done',
      providerKind: 'reasoning',
      providerState: 'completed',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_reasoning_done: thinking step completed',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_search_done',
      providerKind: 'search',
      providerState: 'completed',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_search_done: web search finished',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_status_safe',
      details: 'assistant still running after 45s',
      providerKind: 'status',
      providerState: 'running',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_status_safe: assistant still running after 45s',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_status_waiting',
      details: 'status payload with private text',
      providerKind: 'status',
      providerState: 'running',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_status_waiting: waiting on assistant provider',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_tool_done',
      providerKind: 'tool',
      providerState: 'completed',
      safeDetails: 'tool completed safely',
      type: 'capture.reply-progress',
    }),
    'reply-progress cap_tool_done: tool completed safely',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      captureId: 'cap_other_unsafe',
      details: 'raw custom provider detail',
      providerKind: 'unknown' as never,
      providerState: 'running',
      type: 'capture.reply-progress',
    }, {
      unsafeDetails: true,
    }),
    'reply-progress cap_other_unsafe: raw custom provider detail',
  )
})

test('assistant CLI inbox foreground logging redacts by default and exposes richer unsafe capture labels', () => {
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_telegram',
      source: 'telegram',
      type: 'connector.backfill.started',
    }),
    'Telegram connector backfill starting',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_telegram',
      counts: {
        deduped: 1,
        imported: 2,
      },
      source: 'telegram',
      type: 'connector.backfill.finished',
    }),
    'Telegram connector backfill finished: 2 imported, 1 deduped',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_telegram_watch',
      source: 'telegram',
      type: 'connector.watch.started',
    }),
    'Telegram connector watching for new messages',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_email',
      details: 'mailbox missing',
      phase: 'startup',
      source: 'email',
      type: 'connector.failed',
    }),
    'email connector startup failed',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_linq',
      details: 'disabled by config',
      source: 'linq',
      type: 'connector.skipped',
    }),
    'Linq connector skipped on this host',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
        capture: {
          externalId: 'capture_1',
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'telegram',
          attachments: [{ kind: 'document' }],
        },
      connectorId: 'connector_telegram',
      phase: 'watch',
      source: 'telegram',
      type: 'capture.imported',
    }),
    'new Telegram capture imported: 1 attachment',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      {
        capture: {
          actor: {
            displayName: 'Casey',
            id: 'actor_123',
            isSelf: false,
          },
          attachments: [{ kind: 'document' }, { kind: 'image' }],
          externalId: 'capture_2',
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'telegram',
          text: '  Need a quick follow-up on the parser status.  ',
          thread: {
            id: 'thread_123',
            title: 'Care team',
          },
        },
        connectorId: 'connector_telegram',
        phase: 'backfill',
        source: 'telegram',
        type: 'capture.imported',
      },
      {
        unsafeDetails: true,
      },
    ),
    'backfill Telegram from Casey in Care team: Need a quick follow-up on the parser status. (+2 attachments)',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_signal',
      details: 'manual operator pause',
      phase: 'backfill',
      source: 'signal' as never,
      type: 'connector.failed',
    }, {
      unsafeDetails: true,
    }),
    'signal connector connector_signal backfill failed: manual operator pause',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_signal',
      details: 'not configured locally',
      source: 'signal' as never,
      type: 'connector.skipped',
    }, {
      unsafeDetails: true,
    }),
    'signal connector connector_signal skipped on this host: not configured locally',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      {
        capture: {
          actor: {
            displayName: '   ',
            id: 'actor_signal_123',
            isSelf: false,
          },
          attachments: [{ kind: 'image' }],
          externalId: 'capture_signal',
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'signal' as never,
          text: `${'x'.repeat(120)}   `,
          thread: {
            id: 'thread_signal_123',
            title: '   ',
          },
        },
        connectorId: 'connector_signal',
        phase: 'watch',
        source: 'signal' as never,
        type: 'capture.imported',
      },
      {
        unsafeDetails: true,
      },
    ),
    `new signal from actor_signal_123 in thread_signal_123: ${'x'.repeat(93)}... (+1 attachment)`,
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      {
        capture: {
          actor: {
            displayName: null,
            id: null,
            isSelf: true,
          },
          attachments: [],
          externalId: 'capture_email_self',
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'email',
        },
        connectorId: 'connector_email',
        phase: 'watch',
        source: 'email',
        type: 'capture.imported',
      },
      {
        unsafeDetails: true,
      },
    ),
    'new email from you: message with no text preview',
  )
  assert.equal(
    formatInboxRunEventForTerminal(
      {
        capture: {
          attachments: [{ kind: 'image' }],
          externalId: 'capture_attachment_only',
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'telegram',
        },
        connectorId: 'connector_telegram',
        phase: 'watch',
        source: 'telegram',
        type: 'capture.imported',
      },
      {
        unsafeDetails: true,
      },
    ),
    'new Telegram: attachment-only message',
  )
  assert.equal(
    formatInboxRunEventForTerminal({
      connectorId: 'connector_unknown',
      source: 'telegram',
      type: 'connector.removed' as never,
    }),
    null,
  )
})

test('assistant CLI composer and controller helpers keep queued prompts and selections deterministic', () => {
  assert.equal(
    mergeComposerDraftWithQueuedPrompts('draft', ['first follow-up', 'second follow-up']),
    'draft\n\nfirst follow-up\n\nsecond follow-up',
  )
  assert.equal(
    formatQueuedFollowUpPreview(
      '  name should be optional\nand only asked once  ',
    ),
    'name should be optional and only asked once',
  )

  assert.deepEqual(
    resolveChatSubmitAction('  hello Bob  ', {
      busy: true,
      trigger: 'tab',
    }),
    {
      kind: 'queue',
      prompt: 'hello Bob',
    },
  )
  assert.equal(
    shouldClearComposerForSubmitAction(
      resolveChatSubmitAction('/session', {
        busy: false,
        trigger: 'enter',
      }),
    ),
    false,
  )
})

test('assistant CLI controller state replays queued prompts and preserves explicit selections unless the effective provider changes', () => {
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: false,
      queuedPrompts: ['queued next', 'queued later'],
      turnOutcome: 'completed',
    }),
    {
      kind: 'replay-next',
      nextQueuedPrompt: 'queued next',
      remainingQueuedPrompts: ['queued later'],
    },
  )
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: true,
      queuedPrompts: ['queued next'],
      turnOutcome: 'completed',
    }),
    {
      kind: 'restore-composer',
      restoredQueuedPromptCount: 1,
    },
  )

  const previousSession = createSession({
    providerOptions: {
      ...createSession().providerOptions,
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    },
  })
  const nextSession = createSession({
    updatedAt: '2026-03-17T00:00:02.000Z',
    providerOptions: {
      ...previousSession.providerOptions,
      model: 'backup-model',
      reasoningEffort: null,
      baseUrl: 'http://127.0.0.1:22434/v1',
      providerName: 'ollama-backup',
    },
  })

  assert.deepEqual(
    resolveAssistantSelectionAfterSessionSync({
      currentSelection: {
        activeModel: 'gpt-5.4',
        activeReasoningEffort: 'high',
      },
      previousSession,
      nextSession,
    }),
    {
      activeModel: 'backup-model',
      activeReasoningEffort: null,
    },
  )
  assert.deepEqual(
    resolveAssistantSelectionAfterSessionSync({
      currentSelection: {
        activeModel: 'stale-default-model',
        activeReasoningEffort: null,
      },
      previousSession: createSession(),
      nextSession: createSession({
        updatedAt: '2026-03-17T00:00:02.000Z',
        providerOptions: {
          ...createSession().providerOptions,
          baseUrl: 'http://127.0.0.1:22434/v1',
          apiKeyEnv: 'BACKUP_OLLAMA_API_KEY',
          providerName: 'ollama-b',
        },
      }),
    }),
    {
      activeModel: 'stale-default-model',
      activeReasoningEffort: null,
    },
  )
})
