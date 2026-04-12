import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

import {
  reduceAssistantPromptQueueState,
  reduceAssistantTurnState,
  resolveAssistantQueuedPromptDisposition,
  resolveAssistantSelectionAfterSessionSync,
} from '@murphai/assistant-cli/assistant/ui/chat-controller-state'

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
      presetId: null,
      providerName: 'ollama',
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

test('assistant chat controller queue reducer preserves enqueue, pop-last, dequeue, and clear semantics', () => {
  const queued = reduceAssistantPromptQueueState(
    {
      prompts: [],
    },
    {
      kind: 'enqueue',
      prompt: 'first follow-up',
    },
  )

  const queuedAgain = reduceAssistantPromptQueueState(queued, {
    kind: 'enqueue',
    prompt: 'second follow-up',
  })

  assert.deepEqual(queuedAgain, {
    prompts: ['first follow-up', 'second follow-up'],
  })
  assert.deepEqual(
    reduceAssistantPromptQueueState(queuedAgain, {
      kind: 'pop-last',
    }),
    {
      prompts: ['first follow-up'],
    },
  )
  assert.deepEqual(
    reduceAssistantPromptQueueState(queuedAgain, {
      kind: 'dequeue',
    }),
    {
      prompts: ['second follow-up'],
    },
  )
  assert.deepEqual(
    reduceAssistantPromptQueueState(queuedAgain, {
      kind: 'clear',
    }),
    {
      prompts: [],
    },
  )
})

test('assistant chat controller turn reducer keeps pause requests scoped to the active turn', () => {
  const running = reduceAssistantTurnState(
    {
      pauseRequested: false,
      phase: 'idle',
    },
    {
      kind: 'start',
    },
  )

  assert.deepEqual(running, {
    pauseRequested: false,
    phase: 'running',
  })
  assert.deepEqual(
    reduceAssistantTurnState(running, {
      kind: 'request-pause',
    }),
    {
      pauseRequested: true,
      phase: 'running',
    },
  )
  assert.deepEqual(
    reduceAssistantTurnState(running, {
      kind: 'finish',
    }),
    {
      pauseRequested: false,
      phase: 'idle',
    },
  )
})

test('assistant chat controller queued prompt disposition replays completed follow-ups and restores interrupted or failed queues', () => {
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
      pauseRequested: false,
      queuedPrompts: ['queued next'],
      turnOutcome: 'interrupted',
    }),
    {
      kind: 'restore-composer',
      restoredQueuedPromptCount: 1,
    },
  )
  assert.deepEqual(
    resolveAssistantQueuedPromptDisposition({
      pauseRequested: false,
      queuedPrompts: ['queued next'],
      turnOutcome: 'failed',
    }),
    {
      kind: 'restore-composer',
      restoredQueuedPromptCount: 1,
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
})

test('assistant chat controller updates explicit selections when the effective provider selection changes', () => {
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
})

test('assistant chat controller preserves explicit selections when unrelated same-provider session options change', () => {
  const previousSession = createSession()
  const nextSession = createSession({
    updatedAt: '2026-03-17T00:00:02.000Z',
    providerOptions: {
      ...previousSession.providerOptions,
      baseUrl: 'http://127.0.0.1:22434/v1',
      apiKeyEnv: 'BACKUP_OLLAMA_API_KEY',
      providerName: 'ollama-b',
    },
  })

  assert.deepEqual(
    resolveAssistantSelectionAfterSessionSync({
      currentSelection: {
        activeModel: 'stale-default-model',
        activeReasoningEffort: null,
      },
      previousSession,
      nextSession,
    }),
    {
      activeModel: 'stale-default-model',
      activeReasoningEffort: null,
    },
  )
})
