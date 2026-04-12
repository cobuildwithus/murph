import assert from 'node:assert/strict'
import * as React from 'react'
import { render, renderToString } from 'ink'
import { type SetStateAction } from 'react'
import { beforeEach, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexDisplayOptions } from '@murphai/assistant-engine/assistant-codex'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import type { AssistantTurnState } from '../src/assistant/ui/chat-controller-state.js'
import type { InkChatEntry } from '../src/assistant/ui/view-model.js'

const runtimeMocks = vi.hoisted(() => ({
  appendAssistantTranscriptEntries: vi.fn(),
  buildAssistantProviderDefaultsPatch: vi.fn((input) => input),
  discoverAssistantProviderModels: vi.fn(),
  extractRecoveredAssistantSession: vi.fn<(error: unknown) => AssistantSession | null>(
    () => null,
  ),
  isAssistantProviderConnectionLostError: vi.fn(() => false),
  isAssistantProviderInterruptedError: vi.fn(() => false),
  isAssistantSessionNotFoundError: vi.fn(() => false),
  resolveAssistantModelCatalog: vi.fn(),
  resolveAssistantOperatorDefaults: vi.fn(),
  resolveAssistantProviderDefaults: vi.fn(),
  saveAssistantOperatorDefaultsPatch: vi.fn(),
  sendAssistantMessage: vi.fn(),
  updateAssistantSessionOptions: vi.fn(),
  useInput: vi.fn(),
}))

vi.mock('../src/assistant/service.js', () => ({
  sendAssistantMessage: runtimeMocks.sendAssistantMessage,
  updateAssistantSessionOptions: runtimeMocks.updateAssistantSessionOptions,
}))

vi.mock('../src/assistant/store.js', () => ({
  appendAssistantTranscriptEntries: runtimeMocks.appendAssistantTranscriptEntries,
  isAssistantSessionNotFoundError: runtimeMocks.isAssistantSessionNotFoundError,
}))

vi.mock('@murphai/assistant-engine/assistant-provider', () => ({
  extractRecoveredAssistantSession: runtimeMocks.extractRecoveredAssistantSession,
  isAssistantProviderConnectionLostError:
    runtimeMocks.isAssistantProviderConnectionLostError,
  isAssistantProviderInterruptedError:
    runtimeMocks.isAssistantProviderInterruptedError,
}))

vi.mock('@murphai/assistant-engine/assistant-provider-catalog', () => ({
  discoverAssistantProviderModels: runtimeMocks.discoverAssistantProviderModels,
  resolveAssistantModelCatalog: runtimeMocks.resolveAssistantModelCatalog,
}))

vi.mock('@murphai/operator-config/operator-config', async () => {
  const actual =
    await vi.importActual<typeof import('@murphai/operator-config/operator-config')>(
      '@murphai/operator-config/operator-config',
    )

  return {
    ...actual,
    buildAssistantProviderDefaultsPatch:
      runtimeMocks.buildAssistantProviderDefaultsPatch,
    resolveAssistantOperatorDefaults: runtimeMocks.resolveAssistantOperatorDefaults,
    resolveAssistantProviderDefaults: runtimeMocks.resolveAssistantProviderDefaults,
    saveAssistantOperatorDefaultsPatch: runtimeMocks.saveAssistantOperatorDefaultsPatch,
  }
})

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink')

  return {
    ...actual,
    useInput: runtimeMocks.useInput,
  }
})

import {
  finalizeAssistantTurnTraces,
  persistAssistantTurnError,
  resolveAssistantTurnErrorPresentation,
  runAssistantPromptTurn,
} from '../src/assistant/ui/chat-controller-runtime.js'
import {
  persistAssistantModelSelection,
  resolveInitialAssistantSelection,
  useAssistantModelCatalogState,
} from '../src/assistant/ui/chat-controller-models.js'
import { useAssistantPauseShortcut } from '../src/assistant/ui/chat-controller-pause.js'
import {
  createInkTestInput,
  createInkTestOutput,
  flushAsyncWork,
} from './helpers.ts'

const TEST_SESSION: AssistantSession = {
  schema: 'murph.assistant-session.v1',
  sessionId: 'session-runtime-ui',
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
    continuityFingerprint: 'fingerprint-ui-runtime',
    model: null,
    reasoningEffort: null,
    sandbox: null,
    approvalPolicy: null,
    profile: null,
    oss: false,
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    executionDriver: 'openai-compatible',
    providerName: 'local',
    resumeKind: null,
    headers: null,
  },
  providerBinding: null,
  alias: 'chat:runtime',
  binding: {
    conversationKey: 'chat:runtime',
    channel: 'local',
    identityId: null,
    actorId: null,
    threadId: null,
    threadIsDirect: true,
    delivery: null,
  },
  createdAt: '2026-04-08T00:00:00.000Z',
  updatedAt: '2026-04-08T00:00:00.000Z',
  lastTurnAt: null,
  turnCount: 0,
}

const TEST_CODEX_DISPLAY: CodexDisplayOptions = {
  model: 'codex-default',
  reasoningEffort: null,
}

const TEST_DEFAULTS: AssistantOperatorDefaults = {
  backend: null,
  identityId: null,
  selfDeliveryTargets: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  runtimeMocks.resolveAssistantModelCatalog.mockReturnValue({
    capabilities: {
      supportsModelDiscovery: true,
    },
    models: [],
    modelOptions: [],
  })
  runtimeMocks.discoverAssistantProviderModels.mockResolvedValue({
    message: null,
    models: [
      {
        id: 'gpt-5.4',
      },
    ],
    status: 'ready',
  })
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

test('runtime helpers surface provider progress, interrupted turns, and transcript persistence deterministically', async () => {
  const setEntriesCalls: InkChatEntry[][] = []
  const setStatusCalls: unknown[] = []

  runtimeMocks.sendAssistantMessage.mockImplementationOnce(async (input) => {
    input.onProviderEvent({
      id: 'search',
      kind: 'search',
      state: 'running',
      text: 'Looking up context',
    })
    input.onTraceEvent({
      updates: [
        {
          kind: 'assistant',
          streamKey: 'assistant:1',
          text: 'partial answer',
        },
        {
          kind: 'status',
          streamKey: 'status:1',
          text: 'status update',
        },
      ],
    })

    return {
      delivery: null,
      deliveryError: null,
      response: 'final answer',
      session: TEST_SESSION,
    }
  })

  const completed = await runAssistantPromptTurn({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'high',
    input: {
      abortSignal: new AbortController().signal,
      vault: '/tmp/vault',
    } as never,
    prompt: 'hello',
    session: TEST_SESSION,
    setEntries(update: SetStateAction<InkChatEntry[]>) {
      setEntriesCalls.push(typeof update === 'function' ? update([]) : update)
    },
    setStatus(next) {
      setStatusCalls.push(next)
    },
    turnTracePrefix: 'turn:test',
  })

  assert.deepEqual(completed, {
    delivery: null,
    deliveryError: null,
    kind: 'completed',
    response: 'final answer',
    session: TEST_SESSION,
    streamedAssistantEntryKey: 'turn:test:assistant:1',
  })
  assert.deepEqual(setEntriesCalls[0], [
    {
      kind: 'trace',
      pending: true,
      text: 'Looking up context',
      traceId: 'turn:test:search',
      traceKind: 'search',
    },
  ])
  assert.deepEqual(setStatusCalls.at(-1), {
    kind: 'info',
    text: 'status update',
  })
  assert.deepEqual(
    finalizeAssistantTurnTraces(
      [
        {
          kind: 'trace',
          pending: true,
          text: 'trace',
          traceId: 'turn:test:trace-1',
          traceKind: 'tool',
        },
      ],
      'turn:test',
    ),
    [
      {
        kind: 'trace',
        pending: false,
        text: 'trace',
        traceId: 'turn:test:trace-1',
        traceKind: 'tool',
      },
    ],
  )

  const recoveredSession = {
    ...TEST_SESSION,
    sessionId: 'recovered-session',
  }
  runtimeMocks.extractRecoveredAssistantSession.mockImplementationOnce(
    () => recoveredSession,
  )
  runtimeMocks.isAssistantProviderInterruptedError.mockReturnValueOnce(true)
  runtimeMocks.sendAssistantMessage.mockRejectedValueOnce(new Error('paused'))

  assert.deepEqual(
    await runAssistantPromptTurn({
      activeModel: null,
      activeReasoningEffort: null,
      input: {
        abortSignal: new AbortController().signal,
        vault: '/tmp/vault',
      } as never,
      prompt: 'pause',
      session: TEST_SESSION,
      setEntries: () => {},
      setStatus: () => {},
      turnTracePrefix: 'turn:pause',
    }),
    {
      kind: 'interrupted',
      recoveredSession,
    },
  )

  await persistAssistantTurnError({
    errorText: 'persist this error',
    sessionId: 'session-runtime-ui',
    vault: '/tmp/vault',
  })
  assert.deepEqual(runtimeMocks.appendAssistantTranscriptEntries.mock.calls[0], [
    '/tmp/vault',
    'session-runtime-ui',
    [
      {
        kind: 'error',
        text: 'persist this error',
      },
    ],
  ])
})

test('runtime helpers ignore empty trace batches, surface the latest error status, and preserve recovered sessions on non-interrupt failures', async () => {
  const setEntriesCalls: InkChatEntry[][] = []
  const setStatusCalls: unknown[] = []
  const recoveredSession = {
    ...TEST_SESSION,
    sessionId: 'recovered-after-error',
  }

  runtimeMocks.sendAssistantMessage.mockImplementationOnce(async (input) => {
    input.onTraceEvent({
      updates: [],
    })
    input.onTraceEvent({
      updates: [
        {
          kind: 'status',
          streamKey: null,
          text: 'warming up',
        },
        {
          kind: 'error',
          streamKey: null,
          text: 'provider failed',
        },
      ],
    })

    throw new Error('provider failed')
  })
  runtimeMocks.extractRecoveredAssistantSession.mockReturnValueOnce(recoveredSession)

  const failed = await runAssistantPromptTurn({
    activeModel: null,
    activeReasoningEffort: null,
    input: {
      abortSignal: new AbortController().signal,
      vault: '/tmp/vault',
    } as never,
    prompt: 'hello',
    session: TEST_SESSION,
    setEntries(update: SetStateAction<InkChatEntry[]>) {
      setEntriesCalls.push(typeof update === 'function' ? update([]) : update)
    },
    setStatus(next) {
      setStatusCalls.push(next)
    },
    turnTracePrefix: 'turn:error',
  })

  assert.deepEqual(failed, {
    error: new Error('provider failed'),
    kind: 'failed',
    recoveredSession,
  })
  assert.equal(setEntriesCalls.length, 1)
  assert.deepEqual(setEntriesCalls[0], [
    {
      kind: 'status',
      text: 'warming up',
    },
    {
      kind: 'error',
      text: 'provider failed',
    },
  ])
  assert.deepEqual(setStatusCalls, [
    {
      kind: 'error',
      text: 'provider failed',
    },
  ])
})

test('turn error presentation distinguishes connection loss, missing sessions, and restored queued prompts', () => {
  runtimeMocks.isAssistantProviderConnectionLostError.mockReturnValueOnce(true)
  assert.deepEqual(
    resolveAssistantTurnErrorPresentation({
      error: new Error('network reset'),
      restoredQueuedPromptCount: 2,
    }),
    {
      entry: {
        kind: 'error',
        text: 'network reset',
      },
      persistTranscriptError: true,
      status: {
        kind: 'error',
        text: 'The assistant lost its provider connection. Restore connectivity, then keep chatting to resume. Queued follow-ups are back in the composer.',
      },
    },
  )

  runtimeMocks.isAssistantSessionNotFoundError.mockReturnValueOnce(true)
  assert.equal(
    resolveAssistantTurnErrorPresentation({
      error: new Error('missing local session'),
      restoredQueuedPromptCount: 0,
    }).persistTranscriptError,
    false,
  )
  assert.deepEqual(
    resolveAssistantTurnErrorPresentation({
      error: 'plain failure',
      restoredQueuedPromptCount: 0,
    }),
    {
      entry: {
        kind: 'error',
        text: 'plain failure',
      },
      persistTranscriptError: true,
      status: {
        kind: 'error',
        text: 'The assistant hit an error. Fix it or keep chatting.',
      },
    },
  )
})

test('model selection helpers resolve the initial choice, persist updates, and trigger catalog discovery when supported', async () => {
  const updatedSession = {
    ...TEST_SESSION,
    providerOptions: {
      ...TEST_SESSION.providerOptions,
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
    },
  }

  runtimeMocks.updateAssistantSessionOptions.mockResolvedValueOnce(updatedSession)

  assert.deepEqual(
    resolveInitialAssistantSelection({
      codexDisplay: TEST_CODEX_DISPLAY,
      input: {
        model: ' cli-model ',
        reasoningEffort: ' high ',
        vault: '/tmp/vault',
      } as never,
      resolvedSession: TEST_SESSION,
      selectedProviderDefaults: {
        model: 'default-model',
        reasoningEffort: 'medium',
      } as never,
    }),
    {
      initialActiveModel: 'cli-model',
      initialActiveReasoningEffort: 'high',
    },
  )

  assert.deepEqual(
    await persistAssistantModelSelection({
      defaults: TEST_DEFAULTS,
      nextModel: 'gpt-5.4',
      nextReasoningEffort: 'medium',
      session: TEST_SESSION,
      vault: '/tmp/vault',
    }),
    updatedSession,
  )
  assert.equal(runtimeMocks.saveAssistantOperatorDefaultsPatch.mock.calls.length, 1)

  let latestCatalog:
    | ReturnType<typeof runtimeMocks.resolveAssistantModelCatalog>
    | undefined
  function Probe(): React.ReactElement {
    latestCatalog = useAssistantModelCatalogState({
      activeModel: 'gpt-5.4',
      activeReasoningEffort: 'medium',
      session: TEST_SESSION,
    })

    return React.createElement(React.Fragment)
  }

  renderToString(React.createElement(Probe))
  await flushAsyncWork()

  assert.deepEqual(latestCatalog, {
    capabilities: {
      supportsModelDiscovery: true,
    },
    models: [],
    modelOptions: [],
  })
  assert.equal(runtimeMocks.discoverAssistantProviderModels.mock.calls.length, 1)
})

test('model catalog hook resets discovery when unsupported or missing a base URL, and initial selection falls back through defaults', async () => {
  runtimeMocks.resolveAssistantModelCatalog.mockReturnValue({
    capabilities: {
      supportsModelDiscovery: false,
    },
    models: [],
    modelOptions: [],
  })

  function Probe(): React.ReactElement {
    useAssistantModelCatalogState({
      activeModel: null,
      activeReasoningEffort: null,
      session: {
        ...TEST_SESSION,
        providerOptions: {
          ...TEST_SESSION.providerOptions,
          baseUrl: '   ',
        },
      },
    })

    return React.createElement(React.Fragment)
  }

  renderToString(React.createElement(Probe))
  await flushAsyncWork()

  assert.equal(runtimeMocks.discoverAssistantProviderModels.mock.calls.length, 0)
  assert.deepEqual(
    resolveInitialAssistantSelection({
      codexDisplay: TEST_CODEX_DISPLAY,
      input: {
        vault: '/tmp/vault',
      } as never,
      resolvedSession: {
        ...TEST_SESSION,
        providerOptions: {
          ...TEST_SESSION.providerOptions,
          model: 'session-model',
          reasoningEffort: 'low',
        },
      },
      selectedProviderDefaults: {
        model: 'default-model',
        reasoningEffort: 'medium',
      } as never,
    }),
    {
      initialActiveModel: 'default-model',
      initialActiveReasoningEffort: 'medium',
    },
  )
  assert.deepEqual(
    resolveInitialAssistantSelection({
      codexDisplay: TEST_CODEX_DISPLAY,
      input: {
        vault: '/tmp/vault',
      } as never,
      resolvedSession: {
        ...TEST_SESSION,
        providerOptions: {
          ...TEST_SESSION.providerOptions,
          model: 'session-model',
          reasoningEffort: 'low',
        },
      },
      selectedProviderDefaults: null,
    }),
    {
      initialActiveModel: 'session-model',
      initialActiveReasoningEffort: 'low',
    },
  )
  assert.deepEqual(
    resolveInitialAssistantSelection({
      codexDisplay: TEST_CODEX_DISPLAY,
      input: {
        vault: '/tmp/vault',
      } as never,
      resolvedSession: TEST_SESSION,
      selectedProviderDefaults: null,
    }),
    {
      initialActiveModel: 'codex-default',
      initialActiveReasoningEffort: null,
    },
  )
})

test('model catalog hook keeps equivalent discovery results, clears stale discovery when support disappears, and ignores cancelled async updates', async () => {
  const discoveriesSeen: unknown[] = []
  const discoveryA = {
    message: ' ready ',
    models: [
      {
        id: 'gpt-5.4',
      },
    ],
    status: 'ready',
  }
  const discoveryB = {
    message: 'ready',
    models: [
      {
        id: 'gpt-5.4',
      },
    ],
    status: 'ready',
  }
  const pendingDiscovery = createDeferred<typeof discoveryA>()

  runtimeMocks.resolveAssistantModelCatalog.mockImplementation((input) => {
    discoveriesSeen.push(input.discovery)
    return {
      capabilities: {
        supportsModelDiscovery: input.discovery === discoveryA ? false : true,
      },
      models: [],
      modelOptions: [],
    }
  })
  runtimeMocks.discoverAssistantProviderModels
    .mockResolvedValueOnce(discoveryA)
    .mockResolvedValueOnce(discoveryB)
    .mockImplementationOnce(() => pendingDiscovery.promise)

  const stdin = createInkTestInput()
  const stdout = createInkTestOutput()
  const stderr = createInkTestOutput()
  let session = TEST_SESSION

  function Probe(): React.ReactElement {
    useAssistantModelCatalogState({
      activeModel: 'gpt-5.4',
      activeReasoningEffort: 'medium',
      session,
    })

    return React.createElement(React.Fragment)
  }

  const instance = render(React.createElement(Probe), {
    patchConsole: false,
    stdin,
    stdout,
    stderr,
  })

  await flushAsyncWork(10)

  assert.equal(runtimeMocks.discoverAssistantProviderModels.mock.calls.length >= 1, true)
  assert.equal(discoveriesSeen.some((value) => value === discoveryA), true)

  session = {
    ...TEST_SESSION,
    providerOptions: {
      ...TEST_SESSION.providerOptions,
      headers: {
        authorization: 'Bearer changed',
      },
    },
  }
  instance.rerender(React.createElement(Probe))
  await flushAsyncWork(10)

  assert.equal(runtimeMocks.discoverAssistantProviderModels.mock.calls.length >= 2, true)
  assert.equal(discoveriesSeen.filter((value) => value === discoveryA).length >= 1, true)

  session = {
    ...session,
    providerOptions: {
      ...session.providerOptions,
      headers: {
        authorization: 'Bearer cancelled',
      },
    },
  }
  instance.rerender(React.createElement(Probe))
  await flushAsyncWork(4)
  instance.unmount()
  pendingDiscovery.resolve({
    message: 'late result',
    models: [
      {
        id: 'late-model',
      },
    ],
    status: 'ready',
  })
  await flushAsyncWork(8)

  assert.equal(runtimeMocks.discoverAssistantProviderModels.mock.calls.length >= 3, true)
  assert.equal(discoveriesSeen.some((value) => value === null), true)

  stdin.destroy()
  stdout.destroy()
  stderr.destroy()
})

test('pause shortcut hook aborts only while a running turn can still be paused', () => {
  let registeredHandler:
    | ((input: string, key: { escape?: boolean }) => void)
    | null = null

  runtimeMocks.useInput.mockImplementation((handler) => {
    registeredHandler = handler
  })

  const abortController = new AbortController()
  const statuses: unknown[] = []
  const actions: unknown[] = []
  const promptQueueStateRef = {
    current: {
      prompts: ['follow-up'],
    },
  }
  const turnStateRef: { current: AssistantTurnState } = {
    current: {
      pauseRequested: false,
      phase: 'running',
    },
  }

  function Probe(): React.ReactElement {
    useAssistantPauseShortcut({
      activeTurnAbortControllerRef: {
        current: abortController,
      },
      modelSwitcherState: null,
      promptQueueStateRef,
      setStatus(next) {
        statuses.push(next)
      },
      turnState: turnStateRef.current,
      turnStateRef,
      updateTurnState(action) {
        actions.push(action)
        turnStateRef.current = {
          pauseRequested: true,
          phase: 'running' as const,
        }
        return turnStateRef.current
      },
    })

    return React.createElement(React.Fragment)
  }

  renderToString(React.createElement(Probe))
  const pauseHandler: unknown = registeredHandler
  if (typeof pauseHandler !== 'function') {
    throw new Error('pause shortcut handler was not registered')
  }
  pauseHandler('', { escape: true })

  assert.equal(abortController.signal.aborted, true)
  assert.deepEqual(actions, [
    {
      kind: 'request-pause',
    },
  ])
  assert.deepEqual(statuses, [
    {
      kind: 'info',
      text: 'Pausing current turn. Queued follow-ups will return to the composer.',
    },
  ])
})

test('pause shortcut hook ignores escape when the turn is not pauseable', () => {
  let registeredHandler:
    | ((input: string, key: { escape?: boolean }) => void)
    | null = null

  runtimeMocks.useInput.mockImplementation((handler) => {
    registeredHandler = handler
  })

  const abortController = new AbortController()
  const statuses: unknown[] = []
  const actions: unknown[] = []
  const turnStateRef: { current: AssistantTurnState } = {
    current: {
      pauseRequested: true,
      phase: 'running',
    },
  }

  function Probe(): React.ReactElement {
    useAssistantPauseShortcut({
      activeTurnAbortControllerRef: {
        current: abortController,
      },
      modelSwitcherState: {
        mode: 'model',
      } as never,
      promptQueueStateRef: {
        current: {
          prompts: [],
        },
      },
      setStatus(next) {
        statuses.push(next)
      },
      turnState: turnStateRef.current,
      turnStateRef,
      updateTurnState(action) {
        actions.push(action)
        return turnStateRef.current
      },
    })

    return React.createElement(React.Fragment)
  }

  renderToString(React.createElement(Probe))
  const ignoreHandler: unknown = registeredHandler
  if (typeof ignoreHandler !== 'function') {
    throw new Error('pause shortcut handler was not registered')
  }
  ignoreHandler('', { escape: true })

  assert.equal(abortController.signal.aborted, false)
  assert.deepEqual(actions, [])
  assert.deepEqual(statuses, [])
})
