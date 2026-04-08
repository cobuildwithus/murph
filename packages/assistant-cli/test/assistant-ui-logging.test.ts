import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import {
  formatAssistantRunEventForTerminal,
  formatForegroundLogLine,
  resolveForegroundTerminalLogOptions,
  UNSAFE_FOREGROUND_LOG_DETAILS_ENV,
} from '@murphai/assistant-cli/run-terminal-logging'
import {
  resolveAssistantQueuedPromptDisposition,
  resolveAssistantSelectionAfterSessionSync,
} from '@murphai/assistant-cli/assistant/ui/chat-controller-state'
import {
  mergeComposerDraftWithQueuedPrompts,
  formatQueuedFollowUpPreview,
} from '@murphai/assistant-cli/assistant/ui/composer-terminal'
import {
  resolveChatSubmitAction,
  shouldClearComposerForSubmitAction,
} from '@murphai/assistant-cli/assistant/ui/view-model'

function createSession(
  overrides: Partial<AssistantSession> = {},
): AssistantSession {
  return {
    schema: 'murph.assistant-session.v4',
    sessionId: 'asst_demo',
    target: {
      adapter: 'openai-compatible',
      apiKeyEnv: 'OLLAMA_API_KEY',
      endpoint: 'http://127.0.0.1:11434/v1',
      headers: null,
      model: null,
      providerName: 'ollama',
      reasoningEffort: null,
    },
    resumeState: null,
    provider: 'openai-compatible',
    providerOptions: {
      model: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnv: 'OLLAMA_API_KEY',
      providerName: 'ollama',
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

test('assistant CLI foreground logging normalizes scan priming hints', () => {
  assert.equal(
    formatAssistantRunEventForTerminal({
      details: 'starting after 4 existing captures',
      type: 'reply.scan.primed',
    }),
    'primed channel auto-reply: starting after latest existing capture',
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
