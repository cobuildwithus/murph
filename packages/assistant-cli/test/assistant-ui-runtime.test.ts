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
  isAssistantProviderConnectionLostError: vi.fn(() => false),
  isAssistantProviderInterruptedError: vi.fn(() => false),
  isAssistantSessionNotFoundError: vi.fn(() => false),
  resolveCodexModelCatalog: vi.fn(),
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
  ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX: 'murph.assistant-no-reply.v1 ',
  isAssistantProviderConnectionLostError:
    runtimeMocks.isAssistantProviderConnectionLostError,
  isAssistantProviderInterruptedError:
    runtimeMocks.isAssistantProviderInterruptedError,
}))

vi.mock('@murphai/assistant-engine/assistant-provider-catalog', () => ({
  resolveCodexModelCatalog: runtimeMocks.resolveCodexModelCatalog,
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
  schema: 'murph.assistant-conversation.v2',
  conversationId: 'session-runtime-ui',
  sessionId: 'session-runtime-ui',
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
  pendingComputerResume: null,
  provider: 'codex-cli',
  providerOptions: {
    continuityFingerprint: 'fingerprint-ui-runtime',
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

const TEST_CATALOG_CAPABILITIES = {
  supportedUserMessageContentTypes: ['text'],
  supportsNativeResume: true,
  supportsReasoningEffort: true,
  supportsRichUserMessageContent: false,
} as const

beforeEach(() => {
  vi.clearAllMocks()
  runtimeMocks.resolveCodexModelCatalog.mockReturnValue({
    capabilities: TEST_CATALOG_CAPABILITIES,
    models: [],
    modelOptions: [],
  })
})

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

  runtimeMocks.sendAssistantMessage.mockResolvedValueOnce({
    delivery: null,
    deliveryError: null,
    response: '',
    responseDisposition: 'none',
    session: TEST_SESSION,
  })
  assert.deepEqual(
    await runAssistantPromptTurn({
      activeModel: 'gpt-5.4',
      activeReasoningEffort: 'high',
      input: {
        abortSignal: new AbortController().signal,
        vault: '/tmp/vault',
      } as never,
      prompt: 'no reply',
      session: TEST_SESSION,
      setEntries: () => {},
      setStatus: () => {},
      turnTracePrefix: 'turn:no-reply',
    }),
    {
      delivery: null,
      deliveryError: null,
      kind: 'completed',
      response: '',
      responseDisposition: 'none',
      session: TEST_SESSION,
      streamedAssistantEntryKey: null,
    },
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

test('runtime helpers ignore empty trace batches and surface the latest error status on non-interrupt failures', async () => {
  const setEntriesCalls: InkChatEntry[][] = []
  const setStatusCalls: unknown[] = []

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

test('model selection helpers resolve the initial choice, persist updates, and use the Codex catalog', async () => {
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
    | ReturnType<typeof runtimeMocks.resolveCodexModelCatalog>
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
    capabilities: TEST_CATALOG_CAPABILITIES,
    models: [],
    modelOptions: [],
  })
})

test('model catalog hook uses Codex catalog inputs, and initial selection falls back through defaults', async () => {
  runtimeMocks.resolveCodexModelCatalog.mockReturnValue({
    capabilities: TEST_CATALOG_CAPABILITIES,
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
          modelProvider: null,
        },
      },
    })

    return React.createElement(React.Fragment)
  }

  renderToString(React.createElement(Probe))
  await flushAsyncWork()

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
      initialActiveModel: null,
      initialActiveReasoningEffort: null,
    },
  )
})

test('model catalog hook updates when Codex model state changes', async () => {
  const catalogInputs: unknown[] = []
  runtimeMocks.resolveCodexModelCatalog.mockImplementation((input) => {
    catalogInputs.push(input)
    return {
      capabilities: TEST_CATALOG_CAPABILITIES,
      models: [],
      modelOptions: [],
    }
  })

  const stdin = createInkTestInput()
  const stdout = createInkTestOutput()
  const stderr = createInkTestOutput()
  let activeModel: string | null = 'gpt-5.4'
  let activeReasoningEffort: string | null = 'medium'
  let session = TEST_SESSION

  function Probe(): React.ReactElement {
    useAssistantModelCatalogState({
      activeModel,
      activeReasoningEffort,
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

  await flushAsyncWork(2)
  activeModel = 'gpt-5.5'
  activeReasoningEffort = 'high'
  session = {
    ...TEST_SESSION,
    providerOptions: {
      ...TEST_SESSION.providerOptions,
      oss: true,
    },
  }
  instance.rerender(React.createElement(Probe))
  await flushAsyncWork(2)
  instance.unmount()

  assert.deepEqual(catalogInputs, [
    {
      currentModel: 'gpt-5.4',
      currentReasoningEffort: 'medium',
      oss: false,
      provider: 'codex-cli',
    },
    {
      currentModel: 'gpt-5.5',
      currentReasoningEffort: 'high',
      oss: true,
      provider: 'codex-cli',
    },
  ])

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
