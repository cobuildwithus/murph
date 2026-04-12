import assert from 'node:assert/strict'
import * as React from 'react'

import { test } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

import {
  EMPTY_ASSISTANT_PROMPT_QUEUE_STATE,
  IDLE_ASSISTANT_TURN_STATE,
  normalizeAssistantTurnSelection,
  reduceAssistantPromptQueueState,
  reduceAssistantTurnState,
  resolveAssistantQueuedPromptDisposition,
  resolveAssistantSelectionAfterSessionSync,
} from '../src/assistant/ui/chat-controller-state.js'
import { applyComposerEditingInput } from '../src/assistant/ui/composer-editing.js'
import {
  formatQueuedFollowUpPreview,
  resolveComposerTerminalAction,
} from '../src/assistant/ui/composer-terminal.js'
import {
  applyInkChatTraceUpdates,
  applyProviderProgressEventToEntries,
  CHAT_BANNER,
  formatBusyStatus,
  formatChatMetadata,
  formatElapsedClock,
  finalizePendingInkChatTraces,
  formatSessionBinding,
  getMatchingSlashCommands,
  resolveChatMetadataBadges,
  resolveChatSubmitAction,
  seedChatEntries,
  shouldShowChatComposerGuidance,
  shouldClearComposerForSubmitAction,
} from '../src/assistant/ui/view-model.js'
import {
  ChatComposer,
  ChatFooter,
  ChatStatus,
  QueuedFollowUpStatus,
} from '../src/assistant/ui/ink-composer-panel.js'
import { createInkKey, renderInkOutput } from './helpers.ts'

const TEST_SESSION: AssistantSession = {
  schema: 'murph.assistant-session.v1',
  sessionId: 'session-state-ui',
  target: {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'http://127.0.0.1:11434/v1',
    headers: null,
    model: null,
    presetId: null,
    providerName: 'local',
    reasoningEffort: null,
    webSearch: null,
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
    apiKeyEnv: 'OPENAI_API_KEY',
    providerName: 'local',
    headers: null,
  },
  providerBinding: null,
  alias: 'chat:state',
  binding: {
    conversationKey: 'chat:state',
    channel: 'telegram',
    identityId: null,
    actorId: 'actor-1',
    threadId: 'thread-1',
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 0,
}

test('chat controller state reducers handle queue lifecycle, pause state, and synced selections deterministically', () => {
  assert.deepEqual(
    reduceAssistantPromptQueueState(EMPTY_ASSISTANT_PROMPT_QUEUE_STATE, {
      kind: 'enqueue',
      prompt: 'first',
    }),
    {
      prompts: ['first'],
    },
  )
  assert.deepEqual(
    reduceAssistantPromptQueueState(
      {
        prompts: ['first', 'second'],
      },
      {
        kind: 'dequeue',
      },
    ),
    {
      prompts: ['second'],
    },
  )
  assert.equal(
    reduceAssistantPromptQueueState(EMPTY_ASSISTANT_PROMPT_QUEUE_STATE, {
      kind: 'pop-last',
    }),
    EMPTY_ASSISTANT_PROMPT_QUEUE_STATE,
  )
  assert.equal(
    reduceAssistantPromptQueueState(
      {
        prompts: ['keep'],
      },
      {
        kind: 'clear',
      },
    ),
    EMPTY_ASSISTANT_PROMPT_QUEUE_STATE,
  )

  assert.deepEqual(
    reduceAssistantTurnState(IDLE_ASSISTANT_TURN_STATE, {
      kind: 'start',
    }),
    {
      pauseRequested: false,
      phase: 'running',
    },
  )
  assert.equal(
    reduceAssistantTurnState(IDLE_ASSISTANT_TURN_STATE, {
      kind: 'request-pause',
    }),
    IDLE_ASSISTANT_TURN_STATE,
  )
  assert.equal(
    reduceAssistantTurnState(
      {
        pauseRequested: true,
        phase: 'running',
      },
      {
        kind: 'finish',
      },
    ),
    IDLE_ASSISTANT_TURN_STATE,
  )

  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: false,
      queuedPrompts: [],
      turnOutcome: 'completed',
    }),
    {
      kind: 'idle',
    },
  )
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: false,
      queuedPrompts: ['next'],
      turnOutcome: 'failed',
    }),
    {
      kind: 'restore-composer',
      restoredQueuedPromptCount: 1,
    },
  )
  assert.deepEqual(
    normalizeAssistantTurnSelection({
      activeModel: ' gpt-5.4 ',
      activeReasoningEffort: ' high ',
    }),
    {
      activeModel: 'gpt-5.4',
      activeReasoningEffort: 'high',
    },
  )
  assert.deepEqual(
    resolveAssistantSelectionAfterSessionSync({
      currentSelection: {
        activeModel: 'manual-model',
        activeReasoningEffort: 'medium',
      },
      previousSession: TEST_SESSION,
      nextSession: {
        ...TEST_SESSION,
        updatedAt: '2026-04-08T00:00:01.000Z',
      },
    }),
    {
      activeModel: 'manual-model',
      activeReasoningEffort: 'medium',
    },
  )
})

test('composer terminal and editing helpers cover submit, newline, delete, and control-key branches', () => {
  const modifiedReturnAction = resolveComposerTerminalAction('\u001b[27;2;13~', {
    ...createInkKey(),
    return: true,
    shift: false,
  })
  assert.equal(modifiedReturnAction.kind, 'edit')
  assert.equal(modifiedReturnAction.input, '\n')
  assert.equal(modifiedReturnAction.key.return, false)
  assert.equal(modifiedReturnAction.key.shift, true)
  const backspaceAction = resolveComposerTerminalAction('\u007f', createInkKey())
  assert.equal(backspaceAction.kind, 'edit')
  assert.equal(backspaceAction.input, '')
  assert.equal(backspaceAction.key.backspace, true)
  assert.equal(backspaceAction.key.delete, false)
  assert.deepEqual(
    resolveComposerTerminalAction('', {
      ...createInkKey(),
      tab: true,
    }),
    {
      kind: 'submit',
      mode: 'tab',
    },
  )
  assert.equal(
    formatQueuedFollowUpPreview(
      'A concise queued preview stays readable.',
    ),
    'A concise queued preview stays readable.',
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello',
      },
      '',
      {
        ...createInkKey({
          home: true,
        }),
      },
    ),
    {
      cursorOffset: 0,
      handled: true,
      killBuffer: '',
      value: 'hello',
    },
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello world',
      },
      'b',
      createInkKey({
        meta: true,
      }),
    ).cursorOffset,
    0,
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello',
      },
      'k',
      createInkKey({
        ctrl: true,
      }),
    ).value,
    'hello',
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: '',
      },
      '',
      createInkKey(),
    ).handled,
    false,
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 8,
        killBuffer: '',
        value: 'hello you',
      },
      '',
      createInkKey({
        leftArrow: true,
        ctrl: true,
      }),
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: '',
      value: 'hello you',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'hello you',
      },
      '',
      createInkKey({
        rightArrow: true,
        meta: true,
      }),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'hello you',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello world',
      },
      '',
      createInkKey({
        backspace: true,
        meta: true,
      }),
    ),
    {
      cursorOffset: 0,
      handled: true,
      killBuffer: 'hello',
      value: ' world',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'hello world',
      },
      '',
      createInkKey({
        delete: true,
        meta: true,
      }),
    ),
    {
      cursorOffset: 0,
      handled: true,
      killBuffer: 'hello',
      value: ' world',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        backspace: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 0,
      handled: true,
      killBuffer: 'he',
      value: 'llo',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        delete: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 2,
      handled: true,
      killBuffer: 'llo',
      value: 'he',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 1,
        killBuffer: 'XX',
        value: 'ab',
      },
      'y',
      createInkKey({
        ctrl: true,
      }),
    ),
    {
      cursorOffset: 3,
      handled: true,
      killBuffer: 'XX',
      value: 'aXXb',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'abc',
      },
      '',
      createInkKey({
        ctrl: true,
      }),
    ),
    {
      cursorOffset: 0,
      handled: false,
      killBuffer: '',
      value: 'abc',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 1,
        killBuffer: '',
        value: 'abc',
      },
      '\r\nX\rY',
      createInkKey(),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'a\nX\nYbc',
    },
  )
})

test('view-model helpers resolve submit actions, metadata, and transcript seeds across assistant chat states', () => {
  assert.match(CHAT_BANNER, /Local-first chat/u)
  assert.equal(shouldShowChatComposerGuidance(0), true)
  assert.equal(shouldShowChatComposerGuidance(2), false)
  assert.equal(formatElapsedClock(125.9), '2:05')
  assert.equal(formatBusyStatus(125.9), 'Working · 2:05')
  assert.deepEqual(getMatchingSlashCommands('hello'), [])
  assert.deepEqual(getMatchingSlashCommands('/M'), [
    {
      command: '/model',
      description: 'switch model and reasoning',
    },
  ])
  assert.deepEqual(
    seedChatEntries([
      {
        schema: 'murph.assistant-transcript-entry.v1',
        kind: 'user',
        text: 'hello',
        createdAt: '2026-04-08T00:00:00.000Z',
      },
      {
        schema: 'murph.assistant-transcript-entry.v1',
        kind: 'assistant',
        text: 'hi',
        createdAt: '2026-04-08T00:00:01.000Z',
      },
    ]),
    [
      {
        kind: 'user',
        text: 'hello',
      },
      {
        kind: 'assistant',
        text: 'hi',
      },
    ],
  )

  assert.deepEqual(resolveChatSubmitAction('  ', false), { kind: 'ignore' })
  assert.deepEqual(resolveChatSubmitAction('/exit', false), { kind: 'exit' })
  assert.deepEqual(resolveChatSubmitAction('/quit', false), { kind: 'exit' })
  assert.deepEqual(resolveChatSubmitAction('/exit', true), { kind: 'ignore' })
  assert.deepEqual(resolveChatSubmitAction('/session', false), { kind: 'session' })
  assert.deepEqual(resolveChatSubmitAction('/model', false), { kind: 'model' })
  assert.deepEqual(resolveChatSubmitAction('hello ignore', true), { kind: 'ignore' })
  assert.deepEqual(
    resolveChatSubmitAction('hello queue', {
      busy: true,
      trigger: 'tab',
    }),
    {
      kind: 'queue',
      prompt: 'hello queue',
    },
  )
  assert.deepEqual(
    resolveChatSubmitAction('hello prompt', {
      busy: false,
      trigger: 'enter',
    }),
    {
      kind: 'prompt',
      prompt: 'hello prompt',
    },
  )
  assert.equal(shouldClearComposerForSubmitAction({ kind: 'queue', prompt: 'x' }), true)
  assert.equal(shouldClearComposerForSubmitAction({ kind: 'session' }), false)
  assert.equal(shouldClearComposerForSubmitAction({ kind: 'ignore' }), false)

  assert.equal(
    formatChatMetadata(
      {
        baseUrl: TEST_SESSION.providerOptions.baseUrl,
        model: 'gpt-5.4',
        provider: TEST_SESSION.provider,
        reasoningEffort: 'high',
      },
      'vault-a',
    ),
    'gpt-5.4 · vault-a',
  )
  assert.deepEqual(
    resolveChatMetadataBadges(
      {
        baseUrl: TEST_SESSION.providerOptions.baseUrl,
        model: 'gpt-5.4',
        provider: TEST_SESSION.provider,
        reasoningEffort: 'high',
      },
      'vault-a',
    ),
    [
      {
        key: 'model',
        label: 'model',
        value: 'gpt-5.4',
      },
      {
        key: 'vault',
        label: 'vault',
        value: 'vault-a',
      },
    ],
  )
  assert.equal(
    formatChatMetadata(
      {
        baseUrl: null,
        model: null,
        provider: 'codex-cli',
        reasoningEffort: ' high ',
      },
      'vault-b',
    ),
    'codex-cli high · vault-b',
  )
  assert.deepEqual(
    resolveChatMetadataBadges(
      {
        baseUrl: null,
        model: null,
        provider: 'codex-cli',
        reasoningEffort: ' high ',
      },
      'vault-b',
    ),
    [
      {
        key: 'model',
        label: 'model',
        value: 'codex-cli',
      },
      {
        key: 'reasoning',
        label: 'reasoning',
        value: 'high',
      },
      {
        key: 'vault',
        label: 'vault',
        value: 'vault-b',
      },
    ],
  )
  assert.equal(formatSessionBinding(TEST_SESSION), 'telegram · actor-1 · thread-1')
  assert.equal(
    formatSessionBinding({
      ...TEST_SESSION,
      binding: {
        ...TEST_SESSION.binding,
        actorId: null,
        channel: null,
        threadId: null,
      },
    }),
    null,
  )
})

test('view-model trace helpers handle ignored events, replacements, prefix finalization, and stream updates', () => {
  const ignoredMessage = applyProviderProgressEventToEntries({
    entries: [],
    event: {
      id: 'trace:1',
      kind: 'message',
      state: 'running',
      text: 'ignored',
    },
  })
  assert.deepEqual(ignoredMessage, [])

  const appendedTrace = applyProviderProgressEventToEntries({
    entries: [],
    event: {
      id: 'trace:1',
      kind: 'search',
      state: 'running',
      text: ' searching the web ',
    },
  })
  assert.deepEqual(appendedTrace, [
    {
      kind: 'trace',
      pending: true,
      text: 'searching the web',
      traceId: 'trace:1',
      traceKind: 'search',
    },
  ])

  assert.deepEqual(
    applyProviderProgressEventToEntries({
      entries: appendedTrace,
      event: {
        id: 'trace:1',
        kind: 'search',
        state: 'running',
        text: 'searching the web',
      },
    }),
    appendedTrace,
  )

  assert.deepEqual(
    applyProviderProgressEventToEntries({
      entries: appendedTrace,
      event: {
        id: 'trace:1',
        kind: 'search',
        state: 'completed',
        text: 'search finished',
      },
    }),
    [
      {
        kind: 'trace',
        pending: false,
        text: 'search finished',
        traceId: 'trace:1',
        traceKind: 'search',
      },
    ],
  )

  assert.deepEqual(
    applyProviderProgressEventToEntries({
      entries: [
        {
          kind: 'trace',
          pending: false,
          text: 'status updated',
          traceId: null,
          traceKind: 'status',
        },
      ],
      event: {
        id: null,
        kind: 'status',
        state: 'completed',
        text: 'status updated',
      },
    }),
    [
      {
        kind: 'trace',
        pending: false,
        text: 'status updated',
        traceId: null,
        traceKind: 'status',
      },
    ],
  )

  assert.deepEqual(
    finalizePendingInkChatTraces(
      [
        {
          kind: 'trace',
          pending: true,
          text: 'first',
          traceId: 'turn:1:search',
          traceKind: 'search',
        },
        {
          kind: 'trace',
          pending: true,
          text: 'second',
          traceId: 'turn:2:tool',
          traceKind: 'tool',
        },
      ],
      'turn:1',
    ),
    [
      {
        kind: 'trace',
        pending: false,
        text: 'first',
        traceId: 'turn:1:search',
        traceKind: 'search',
      },
      {
        kind: 'trace',
        pending: true,
        text: 'second',
        traceId: 'turn:2:tool',
        traceKind: 'tool',
      },
    ],
  )

  assert.deepEqual(
    applyInkChatTraceUpdates(
      [
        {
          kind: 'assistant',
          streamKey: 'stream:1',
          text: 'hello',
        },
      ],
      [
        {
          kind: 'assistant',
          mode: 'append',
          streamKey: 'stream:1',
          text: '\r\n world',
        },
        {
          kind: 'status',
          text: 'status line',
        },
        {
          kind: 'thinking',
          streamKey: 'stream:2',
          text: '',
        },
      ],
    ),
    [
      {
        kind: 'assistant',
        streamKey: 'stream:1',
        text: 'hello\n world',
      },
      {
        kind: 'status',
        text: 'status line',
      },
    ],
  )
})

test('ink composer panel helpers render status, guidance, queued follow-ups, and footer badges deterministically', () => {
  const busyStatus = renderInkOutput(
    React.createElement(ChatStatus, {
      busy: true,
      status: {
        kind: 'success',
        text: 'Sent over Telegram.',
      },
    }),
  )
  assert.match(busyStatus, /Working/u)
  assert.match(busyStatus, /Sent over Telegram\./u)

  const composerOutput = renderInkOutput(
    React.createElement(ChatComposer, {
      entryCount: 0,
      modelSwitcherActive: false,
      onChange: () => undefined,
      onEditLastQueuedPrompt: () => undefined,
      onSubmit: (): 'keep' => 'keep',
      value: '/m',
    }),
  )
  assert.match(composerOutput, /Enter send/u)
  assert.match(composerOutput, /commands/u)
  assert.match(composerOutput, /\/model/u)

  const queuedOutput = renderInkOutput(
    React.createElement(QueuedFollowUpStatus, {
      latestPrompt: 'Follow up with meal timing',
      queuedPromptCount: 2,
    }),
  )
  assert.match(queuedOutput, /Queued follow-up messages/u)
  assert.match(queuedOutput, /\+1 more queued/u)

  const footerOutput = renderInkOutput(
    React.createElement(ChatFooter, {
      badges: [
        {
          key: 'model',
          label: 'model',
          value: 'gpt-5.4',
        },
        {
          key: 'vault',
          label: 'vault',
          value: '<VAULT>',
        },
      ],
    }),
  )
  assert.match(footerOutput, /gpt-5\.4/u)
  assert.match(footerOutput, /<VAULT>/u)
})

test('composer editing covers simple cursor movement, default meta fallthrough, and empty kill-buffer yanks', () => {
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        leftArrow: true,
      }),
    ),
    {
      cursorOffset: 1,
      handled: true,
      killBuffer: '',
      value: 'hello',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        rightArrow: true,
      }),
    ),
    {
      cursorOffset: 3,
      handled: true,
      killBuffer: '',
      value: 'hello',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 4,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        end: true,
      }),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'hello',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        backspace: true,
      }),
    ),
    {
      cursorOffset: 1,
      handled: true,
      killBuffer: '',
      value: 'hllo',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        delete: true,
      }),
    ),
    {
      cursorOffset: 2,
      handled: true,
      killBuffer: '',
      value: 'helo',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      'y',
      createInkKey({
        ctrl: true,
      }),
    ),
    {
      cursorOffset: 2,
      handled: true,
      killBuffer: '',
      value: 'hello',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      'z',
      createInkKey({
        meta: true,
      }),
    ),
    {
      cursorOffset: 3,
      handled: true,
      killBuffer: '',
      value: 'hezllo',
    },
  )
})

test('composer editing covers remaining ctrl and meta shortcuts plus boundary deletes', () => {
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        backspace: true,
      }),
    ),
    {
      cursorOffset: 0,
      handled: true,
      killBuffer: '',
      value: 'hello',
    },
  )
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello',
      },
      '',
      createInkKey({
        delete: true,
      }),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'hello',
    },
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      'a',
      createInkKey({
        ctrl: true,
      }),
    ).cursorOffset,
    0,
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello',
      },
      'b',
      createInkKey({
        ctrl: true,
      }),
    ).cursorOffset,
    1,
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 1,
        killBuffer: '',
        value: 'hello',
      },
      'd',
      createInkKey({
        ctrl: true,
      }),
    ).value,
    'hllo',
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 1,
        killBuffer: '',
        value: 'hello',
      },
      'e',
      createInkKey({
        ctrl: true,
      }),
    ).cursorOffset,
    5,
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 1,
        killBuffer: '',
        value: 'hello',
      },
      'f',
      createInkKey({
        ctrl: true,
      }),
    ).cursorOffset,
    2,
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 1,
        killBuffer: '',
        value: 'hello',
      },
      'h',
      createInkKey({
        ctrl: true,
      }),
    ).value,
    'ello',
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 2,
        killBuffer: '',
        value: 'hello world',
      },
      'u',
      createInkKey({
        ctrl: true,
      }),
    ).killBuffer,
    'he',
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 6,
        killBuffer: '',
        value: 'hello world',
      },
      'w',
      createInkKey({
        ctrl: true,
      }),
    ).killBuffer,
    'hello ',
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'hello world',
      },
      'd',
      createInkKey({
        meta: true,
      }),
    ).killBuffer,
    'hello',
  )
  assert.equal(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'hello world',
      },
      'f',
      createInkKey({
        meta: true,
      }),
    ).cursorOffset,
    5,
  )
})
