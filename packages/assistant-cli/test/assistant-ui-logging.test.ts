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
    schema: 'murph.assistant-conversation.v2',
    conversationId: 'asst_demo',
    sessionId: 'asst_demo',
    codexTarget: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: null,
      modelProvider: null,
      oss: false,
      profile: null,
      reasoningEffort: null,
      sandbox: 'danger-full-access',
    },
    target: {
      adapter: 'codex-cli',
      approvalPolicy: 'never',
      codexCommand: null,
      codexHome: null,
      model: null,
      modelProvider: null,
      oss: false,
      profile: null,
      reasoningEffort: null,
      sandbox: 'danger-full-access',
    },
    codexResume: null,
    resumeState: null,
    provider: 'codex-cli',
    providerOptions: {
      continuityFingerprint: 'fingerprint-ui-logging',
      provider: 'codex-cli',
      model: null,
      reasoningEffort: null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      profile: null,
      oss: false,
      executionDriver: 'codex-app-server',
      resumeKind: null,
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
    inputId: 'ain_safe_123',
    details: 'telegram -> +15550001111',
    type: 'input.replied',
  }

  const safeMessage = formatAssistantRunEventForTerminal(event)
  const unsafeMessage = formatAssistantRunEventForTerminal(event, {
    unsafeDetails: true,
  })

  assert.equal(safeMessage, 'replied ain_safe_123')
  assert.doesNotMatch(safeMessage ?? '', /\+15550001111/u)
  assert.equal(unsafeMessage, 'replied ain_safe_123: telegram -> +15550001111')
})

test('assistant CLI foreground logging keeps safe auto-reply summaries while hiding raw search progress', () => {
  const event: Parameters<typeof formatAssistantRunEventForTerminal>[0] = {
    inputId: 'ain_safe_123',
    details: 'Web: treehouse menu',
    providerKind: 'search',
    providerState: 'running',
    type: 'input.reply-progress',
  }

  assert.equal(
    formatAssistantRunEventForTerminal(event),
    'reply-progress ain_safe_123: searching the web',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(event, { unsafeDetails: true }),
    'reply-progress ain_safe_123: Web: treehouse menu',
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
      inputId: 'ain_start_123',
      details: 'provider startup',
      type: 'input.reply-started',
    }),
    'reply-started ain_start_123: assistant provider turn started',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: 'loopback unavailable',
      type: 'daemon.failed',
    }),
    'inbox daemon failed daemon failure details hidden',
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
      inputId: 'ain_skip_retry',
      details:
        'temporary network issue. Will retry this input after the provider reconnects.',
      type: 'input.reply-skipped',
    }),
    'reply-skipped ain_skip_retry: waiting for provider reconnect',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_failed_safe',
      details: 'provider raw error',
      errorCode: 'network_timeout',
      safeDetails: 'assistant provider timed out safely',
      type: 'input.reply-failed',
    }),
    'reply-failed ain_failed_safe: assistant provider timed out safely',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_failed_fallback',
      errorCode: 'network_timeout',
      type: 'input.reply-failed',
    }),
    'reply-failed ain_failed_fallback: assistant reply failed (network_timeout)',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_gateway_auth',
      details:
        'Authentication failed. Create an API key and set in AI_GATEWAY_API_KEY environment variable: https://example.invalid/key',
      safeDetails: 'assistant provider failed',
      type: 'input.reply-failed',
    }),
    'reply-failed ain_gateway_auth: Authentication failed. Set AI_GATEWAY_API_KEY for the assistant provider.',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_network_safe',
      details: 'network error while processing message: private inbox text',
      safeDetails: 'assistant provider failed',
      type: 'input.reply-failed',
    }),
    'reply-failed ain_network_safe: assistant provider failed',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_auth_token',
      details: 'Authentication failed for ABC_DEF_GHI',
      type: 'input.reply-failed',
    }),
    'reply-failed ain_auth_token: Authentication failed. Check assistant provider credentials.',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_auth_lower_token',
      details: 'Authentication failed. env var lowercase_token_value',
      type: 'input.reply-failed',
    }),
    'reply-failed ain_auth_lower_token: Authentication failed. Check assistant provider credentials.',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_failed_unsafe',
      details: 'provider raw error',
      safeDetails: 'assistant provider timed out safely',
      type: 'input.reply-failed',
    }, {
      unsafeDetails: true,
    }),
    'reply-failed ain_failed_unsafe: provider raw error',
  )
})

test('assistant CLI foreground logging summarizes provider progress for each top-level provider kind', () => {
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_command_running',
      providerKind: 'command',
      providerState: 'running',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_command_running: running assistant command',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_command_safe',
      providerKind: 'command',
      providerState: 'completed',
      safeDetails: 'assistant command ended cleanly',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_command_safe: assistant command ended cleanly',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_file_done',
      providerKind: 'file',
      providerState: 'completed',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_file_done: file update finished',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_plan_running',
      providerKind: 'plan',
      providerState: 'running',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_plan_running: updating plan',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_reasoning_done',
      providerKind: 'reasoning',
      providerState: 'completed',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_reasoning_done: thinking step completed',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_search_done',
      providerKind: 'search',
      providerState: 'completed',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_search_done: web search finished',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_status_safe',
      details: 'assistant still running after 45s',
      providerKind: 'status',
      providerState: 'running',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_status_safe: assistant still running after 45s',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_status_revision',
      details: 'new input queued for active turn with 1 additional input(s)',
      providerKind: 'status',
      providerState: 'running',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_status_revision: new input queued for active turn with 1 additional input(s)',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_status_revision_group',
      details: 'new input committed to active turn with 3 additional input(s)',
      providerKind: 'status',
      providerState: 'running',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_status_revision_group: new input committed to active turn with 3 additional input(s)',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_status_waiting',
      details: 'status payload with private text',
      providerKind: 'status',
      providerState: 'running',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_status_waiting: waiting on assistant provider',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_tool_done',
      providerKind: 'tool',
      providerState: 'completed',
      safeDetails: 'tool completed safely',
      type: 'input.reply-progress',
    }),
    'reply-progress ain_tool_done: tool completed safely',
  )
  assert.equal(
    formatAssistantRunEventForTerminal({
      inputId: 'ain_other_unsafe',
      details: 'raw custom provider detail',
      providerKind: 'unknown' as never,
      providerState: 'running',
      type: 'input.reply-progress',
    }, {
      unsafeDetails: true,
    }),
    'reply-progress ain_other_unsafe: raw custom provider detail',
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
          actor: {
            displayName: null,
            id: null,
            isSelf: false,
          },
          externalId: 'capture_1',
          occurredAt: '2026-04-08T00:00:00.000Z',
          source: 'telegram',
          attachments: [{ kind: 'document' }],
          raw: {},
          text: null,
          thread: {
            id: 'thread_1',
          },
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
          raw: {},
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
          raw: {},
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
          raw: {},
          source: 'email',
          text: null,
          thread: {
            id: '   ',
          },
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
          actor: {
            displayName: null,
            id: null,
            isSelf: false,
          },
          attachments: [{ kind: 'image' }],
          externalId: 'capture_attachment_only',
          occurredAt: '2026-04-08T00:00:00.000Z',
          raw: {},
          source: 'telegram',
          text: null,
          thread: {
            id: '   ',
          },
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
          model: null,
        },
      }),
    }),
    {
      activeModel: 'stale-default-model',
      activeReasoningEffort: null,
    },
  )
})
