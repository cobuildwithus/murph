import assert from 'node:assert/strict'
import * as React from 'react'
import { render } from 'ink'
import { beforeEach, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexDisplayOptions } from '@murphai/assistant-engine/assistant-codex'
import type { AssistantOperatorDefaults } from '@murphai/operator-config/operator-config'

const controllerMocks = vi.hoisted(() => ({
  createAssistantTurnTracePrefix: vi.fn(),
  exit: vi.fn(),
  finalizeAssistantTurnTraces: vi.fn(),
  persistAssistantModelSelection: vi.fn(),
  persistAssistantTurnError: vi.fn(),
  render: vi.fn(),
  resolveAssistantTurnErrorPresentation: vi.fn(),
  resolveInitialAssistantSelection: vi.fn(),
  runAssistantPromptTurn: vi.fn(),
  useAssistantModelCatalogState: vi.fn(),
  useAssistantPauseShortcut: vi.fn(),
}))

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink')
  controllerMocks.render.mockImplementation((node, options) =>
    actual.render(node, options),
  )

  return {
    ...actual,
    render: controllerMocks.render,
    useApp: () => ({
      exit: controllerMocks.exit,
    }),
  }
})

vi.mock('../src/assistant/ui/chat-controller-runtime.js', () => ({
  createAssistantTurnTracePrefix: controllerMocks.createAssistantTurnTracePrefix,
  finalizeAssistantTurnTraces: controllerMocks.finalizeAssistantTurnTraces,
  persistAssistantTurnError: controllerMocks.persistAssistantTurnError,
  resolveAssistantTurnErrorPresentation:
    controllerMocks.resolveAssistantTurnErrorPresentation,
  runAssistantPromptTurn: controllerMocks.runAssistantPromptTurn,
}))

vi.mock('../src/assistant/ui/chat-controller-models.js', () => ({
  persistAssistantModelSelection: controllerMocks.persistAssistantModelSelection,
  resolveInitialAssistantSelection: controllerMocks.resolveInitialAssistantSelection,
  useAssistantModelCatalogState: controllerMocks.useAssistantModelCatalogState,
}))

vi.mock('../src/assistant/ui/chat-controller-pause.js', () => ({
  useAssistantPauseShortcut: controllerMocks.useAssistantPauseShortcut,
}))

import {
  useAssistantChatController,
  type AssistantChatController,
  type UseAssistantChatControllerInput,
} from '../src/assistant/ui/chat-controller.js'
import {
  createInkTestInput,
  createInkTestOutput,
  flushAsyncWork,
} from './helpers.ts'

const TEST_SESSION: AssistantSession = {
  schema: 'murph.assistant-session.v1',
  sessionId: 'session-controller-ui',
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
    continuityFingerprint: 'fingerprint-ui-controller',
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
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
  alias: 'chat:controller',
  binding: {
    conversationKey: 'chat:controller',
    channel: 'local',
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

const MODEL_OPTIONS = [
  {
    description: 'Fast default',
    label: 'GPT-5.4',
    value: 'gpt-5.4',
  },
  {
    description: 'Cheaper fallback',
    label: 'GPT-5.4 mini',
    value: 'gpt-5.4-mini',
  },
]

const MODELS = [
  {
    capabilities: {
      images: false,
      pdf: false,
      reasoning: true,
      streaming: true,
      tools: true,
    },
    description: 'Fast default',
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    source: 'static',
  },
  {
    capabilities: {
      images: false,
      pdf: false,
      reasoning: false,
      streaming: true,
      tools: true,
    },
    description: 'Cheaper fallback',
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    source: 'static',
  },
]

function createControllerInput(
  overrides: Partial<UseAssistantChatControllerInput> = {},
): UseAssistantChatControllerInput {
  const codexDisplay: CodexDisplayOptions = {
    model: null,
    reasoningEffort: null,
  }
  const defaults: AssistantOperatorDefaults = {
    backend: null,
    identityId: null,
    selfDeliveryTargets: null,
  }

  return {
    codexDisplay,
    defaults,
    input: {
      initialPrompt: null,
      vault: '/tmp/vault',
    } as never,
    redactedVault: '<VAULT>',
    resolvedSession: TEST_SESSION,
    selectedProviderDefaults: null,
    transcriptEntries: [],
    ...overrides,
  }
}

async function mountController(
  overrides: Partial<UseAssistantChatControllerInput> = {},
): Promise<{
  cleanup: () => Promise<void>
  getController: () => AssistantChatController
}> {
  const input = createControllerInput(overrides)
  const stdin = createInkTestInput()
  const stdout = createInkTestOutput()
  const stderr = createInkTestOutput()
  let latestController: AssistantChatController | null = null

  function Probe(): React.ReactElement {
    latestController = useAssistantChatController(input)
    return React.createElement('ink-box')
  }

  const instance = render(React.createElement(Probe), {
    patchConsole: false,
    stdin,
    stdout,
    stderr,
  })
  await flushAsyncWork(8)

  if (!latestController) {
    throw new Error('assistant controller did not mount')
  }

  return {
    cleanup: async () => {
      instance.unmount()
      await flushAsyncWork(4)
      stdin.destroy()
      stdout.destroy()
      stderr.destroy()
    },
    getController: () => {
      if (!latestController) {
        throw new Error('assistant controller is unavailable')
      }

      return latestController
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  controllerMocks.createAssistantTurnTracePrefix.mockReturnValue('turn:test')
  controllerMocks.finalizeAssistantTurnTraces.mockImplementation((entries) => entries)
  controllerMocks.persistAssistantTurnError.mockResolvedValue(undefined)
  controllerMocks.resolveInitialAssistantSelection.mockReturnValue({
    initialActiveModel: 'gpt-5.4',
    initialActiveReasoningEffort: 'medium',
  })
  controllerMocks.useAssistantModelCatalogState.mockReturnValue({
    modelOptions: MODEL_OPTIONS,
    models: MODELS,
  })
  controllerMocks.persistAssistantModelSelection.mockImplementation(
    async ({ nextModel, nextReasoningEffort, session }) => ({
      ...session,
      providerOptions: {
        ...session.providerOptions,
        model: nextModel,
        reasoningEffort: nextReasoningEffort,
      },
      updatedAt: '2026-04-08T00:00:01.000Z',
    }),
  )
  controllerMocks.useAssistantPauseShortcut.mockImplementation(() => {})
})

test('chat controller handles session info, model selection, and completed prompt turns on a mounted Ink tree', async () => {
  controllerMocks.runAssistantPromptTurn.mockResolvedValue({
    delivery: null,
    deliveryError: null,
    kind: 'completed',
    response: 'assistant reply',
    session: TEST_SESSION,
    streamedAssistantEntryKey: null,
  })

  const mounted = await mountController()
  const controller = () => mounted.getController()

  assert.equal(controller().submitPrompt('/session', 'enter'), 'keep')
  await flushAsyncWork(6)
  assert.deepEqual(controller().status, {
    kind: 'info',
    text: `session ${TEST_SESSION.sessionId}`,
  })

  assert.equal(controller().submitPrompt('/model', 'enter'), 'clear')
  await flushAsyncWork(6)
  assert.equal(controller().modelSwitcherState?.mode, 'model')

  controller().confirmModelSwitcher()
  await flushAsyncWork(6)
  assert.equal(controller().modelSwitcherState?.mode, 'reasoning')

  controller().confirmModelSwitcher()
  await flushAsyncWork(6)
  assert.equal(
    controllerMocks.persistAssistantModelSelection.mock.calls.length,
    1,
  )
  assert.deepEqual(controller().status, {
    kind: 'info',
    text: 'Using gpt-5.4 medium.',
  })

  assert.equal(controller().submitPrompt('hello there', 'enter'), 'clear')
  await flushAsyncWork(8)
  assert.equal(controllerMocks.runAssistantPromptTurn.mock.calls.length, 1)
  assert.equal(controller().latestTurnsRef.current, 1)
  assert.equal(controller().busy, false)
  assert.deepEqual(controller().entries, [
    {
      kind: 'user',
      text: 'hello there',
    },
    {
      kind: 'assistant',
      text: 'assistant reply',
    },
  ])

  await mounted.cleanup()
})

test('chat controller queues a busy follow-up and replays it after the current turn finishes', async () => {
  const firstTurn = createDeferred<{
    delivery: null
    deliveryError: null
    kind: 'completed'
    response: string
    session: AssistantSession
    streamedAssistantEntryKey: null
  }>()

  controllerMocks.runAssistantPromptTurn.mockImplementationOnce(
    () => firstTurn.promise,
  )
  controllerMocks.runAssistantPromptTurn.mockResolvedValueOnce({
    delivery: null,
    deliveryError: null,
    kind: 'completed',
    response: 'queued reply',
    session: TEST_SESSION,
    streamedAssistantEntryKey: null,
  })

  const mounted = await mountController()
  const controller = () => mounted.getController()

  assert.equal(controller().submitPrompt('first prompt', 'enter'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().busy, true)

  assert.equal(controller().submitPrompt('queued prompt', 'tab'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().queuedPromptCount, 1)
  assert.equal(controller().lastQueuedPrompt, 'queued prompt')

  firstTurn.resolve({
    delivery: null,
    deliveryError: null,
    kind: 'completed',
    response: 'first reply',
    session: TEST_SESSION,
    streamedAssistantEntryKey: null,
  })

  await flushAsyncWork(12)

  assert.equal(controllerMocks.runAssistantPromptTurn.mock.calls.length, 2)
  assert.equal(controllerMocks.runAssistantPromptTurn.mock.calls[1]?.[0]?.prompt, 'queued prompt')
  assert.equal(controller().latestTurnsRef.current, 2)
  assert.equal(controller().queuedPromptCount, 0)
  assert.deepEqual(controller().entries, [
    {
      kind: 'user',
      text: 'first prompt',
    },
    {
      kind: 'assistant',
      text: 'first reply',
    },
    {
      kind: 'user',
      text: 'queued prompt',
    },
    {
      kind: 'assistant',
      text: 'queued reply',
    },
  ])

  await mounted.cleanup()
})

test('chat controller restores queued prompts and persists error presentation after a failed turn', async () => {
  const firstTurn = createDeferred<{
    error: Error
    kind: 'failed'
    recoveredSession: AssistantSession
  }>()
  const recoveredSession = {
    ...TEST_SESSION,
    sessionId: 'session-controller-recovered',
  }

  controllerMocks.runAssistantPromptTurn.mockImplementationOnce(
    () => firstTurn.promise,
  )
  controllerMocks.resolveAssistantTurnErrorPresentation.mockReturnValue({
    entry: {
      kind: 'error',
      text: 'provider connection dropped',
    },
    persistTranscriptError: true,
    status: {
      kind: 'error',
      text: 'Queued follow-ups are back in the composer.',
    },
  })

  const mounted = await mountController()
  const controller = () => mounted.getController()

  assert.equal(controller().submitPrompt('first prompt', 'enter'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().submitPrompt('queued prompt', 'tab'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().queuedPromptCount, 1)

  firstTurn.resolve({
    error: new Error('provider failed'),
    kind: 'failed',
    recoveredSession,
  })

  await flushAsyncWork(12)

  assert.equal(
    controllerMocks.resolveAssistantTurnErrorPresentation.mock.calls.length,
    1,
  )
  assert.deepEqual(
    controllerMocks.resolveAssistantTurnErrorPresentation.mock.calls[0]?.[0],
    {
      error: new Error('provider failed'),
      restoredQueuedPromptCount: 1,
    },
  )
  assert.equal(controller().session.sessionId, recoveredSession.sessionId)
  assert.equal(controller().queuedPromptCount, 0)
  assert.equal(controller().composerValue, 'queued prompt')
  assert.deepEqual(controller().status, {
    kind: 'error',
    text: 'Queued follow-ups are back in the composer.',
  })
  assert.deepEqual(controller().entries, [
    {
      kind: 'user',
      text: 'first prompt',
    },
    {
      kind: 'error',
      text: 'provider connection dropped',
    },
  ])
  assert.deepEqual(controllerMocks.persistAssistantTurnError.mock.calls[0]?.[0], {
    errorText: 'provider connection dropped',
    sessionId: recoveredSession.sessionId,
    vault: '/tmp/vault',
  })

  await mounted.cleanup()
})

test('chat controller bootstraps the initial prompt once and handles model switcher cancellation plus save failures', async () => {
  controllerMocks.runAssistantPromptTurn.mockResolvedValue({
    delivery: null,
    deliveryError: null,
    kind: 'completed',
    response: 'bootstrapped reply',
    session: TEST_SESSION,
    streamedAssistantEntryKey: null,
  })
  controllerMocks.persistAssistantModelSelection.mockRejectedValueOnce(
    new Error('save failed'),
  )

  const mounted = await mountController({
    input: {
      initialPrompt: 'boot prompt',
      vault: '/tmp/vault',
    } as never,
  })
  const controller = () => mounted.getController()

  await flushAsyncWork(10)
  assert.equal(controllerMocks.runAssistantPromptTurn.mock.calls.length, 1)
  assert.equal(controllerMocks.runAssistantPromptTurn.mock.calls[0]?.[0]?.prompt, 'boot prompt')
  assert.equal(controller().latestTurnsRef.current, 1)

  assert.equal(controller().submitPrompt('/model', 'enter'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().modelSwitcherState?.mode, 'model')

  controller().confirmModelSwitcher()
  await flushAsyncWork(4)
  assert.equal(controller().modelSwitcherState?.mode, 'reasoning')

  controller().cancelModelSwitcher()
  await flushAsyncWork(4)
  assert.equal(controller().modelSwitcherState?.mode, 'model')

  controller().cancelModelSwitcher()
  await flushAsyncWork(4)
  assert.equal(controller().modelSwitcherState, null)

  assert.equal(controller().submitPrompt('/model', 'enter'), 'clear')
  await flushAsyncWork(4)
  controller().confirmModelSwitcher()
  await flushAsyncWork(4)
  controller().confirmModelSwitcher()
  await flushAsyncWork(8)

  assert.deepEqual(controller().status, {
    kind: 'error',
    text:
      'Using gpt-5.4 medium for now, but failed to save it for later chats: save failed',
  })

  await mounted.cleanup()
})

test('chat controller handles streamed completions, queued edit recovery, exit commands, and paused completion replay branches', async () => {
  const runningTurn = createDeferred<{
    delivery:
      | {
          channel: string
          target: string
        }
      | null
    deliveryError:
      | {
          message: string
        }
      | null
    kind: 'completed'
    response: string
    session: AssistantSession
    streamedAssistantEntryKey: string | null
  }>()

  let latestPauseArgs:
    | Parameters<typeof controllerMocks.useAssistantPauseShortcut>[0][0]
    | null = null
  controllerMocks.useAssistantPauseShortcut.mockImplementation((args) => {
    latestPauseArgs = args
  })
  controllerMocks.runAssistantPromptTurn.mockImplementationOnce(() => runningTurn.promise)

  const mounted = await mountController()
  const controller = () => mounted.getController()

  assert.equal(controller().editLastQueuedPrompt(), undefined)
  assert.equal(controller().submitPrompt('/quit', 'enter'), 'keep')
  assert.equal(controllerMocks.exit.mock.calls.length, 1)

  assert.equal(controller().submitPrompt('first prompt', 'enter'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().busy, true)
  assert.equal(controller().submitPrompt('ignored while busy', 'enter'), 'keep')

  assert.equal(controller().submitPrompt('queued prompt', 'tab'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().lastQueuedPrompt, 'queued prompt')
  controller().editLastQueuedPrompt()
  await flushAsyncWork(4)
  assert.equal(controller().composerValue, 'queued prompt')
  assert.equal(controller().queuedPromptCount, 0)

  latestPauseArgs?.updateTurnState({
    kind: 'request-pause',
  })

  runningTurn.resolve({
    delivery: {
      channel: 'telegram',
      target: '@murph',
    },
    deliveryError: null,
    kind: 'completed',
    response: 'streamed reply',
    session: TEST_SESSION,
    streamedAssistantEntryKey: 'stream:assistant',
  })

  await flushAsyncWork(12)

  assert.deepEqual(controller().status, {
    kind: 'info',
    text: 'Stopped after the current turn.',
  })
  assert.deepEqual(controller().entries, [
    {
      kind: 'user',
      text: 'first prompt',
    },
    {
      kind: 'assistant',
      streamKey: 'stream:assistant',
      text: 'streamed reply',
    },
  ])
  assert.equal(controller().busy, false)

  await mounted.cleanup()
})

test('chat controller restores queued prompts after interruption and surfaces delivery-error completions', async () => {
  const interruptedTurn = createDeferred<{
    kind: 'interrupted'
    recoveredSession: AssistantSession
  }>()
  const recoveredSession = {
    ...TEST_SESSION,
    sessionId: 'session-controller-interrupted',
  }

  let latestPauseArgs:
    | Parameters<typeof controllerMocks.useAssistantPauseShortcut>[0][0]
    | null = null
  controllerMocks.useAssistantPauseShortcut.mockImplementation((args) => {
    latestPauseArgs = args
  })
  controllerMocks.runAssistantPromptTurn.mockImplementationOnce(() => interruptedTurn.promise)
  controllerMocks.runAssistantPromptTurn.mockResolvedValueOnce({
    delivery: null,
    deliveryError: {
      message: 'linq target missing',
    },
    kind: 'completed',
    response: 'second reply',
    session: recoveredSession,
    streamedAssistantEntryKey: null,
  })

  const mounted = await mountController()
  const controller = () => mounted.getController()

  assert.equal(controller().submitPrompt('first prompt', 'enter'), 'clear')
  await flushAsyncWork(4)
  assert.equal(controller().submitPrompt('queued prompt', 'tab'), 'clear')
  await flushAsyncWork(4)

  latestPauseArgs?.updateTurnState({
    kind: 'request-pause',
  })
  interruptedTurn.resolve({
    kind: 'interrupted',
    recoveredSession,
  })
  await flushAsyncWork(12)

  assert.equal(controller().session.sessionId, recoveredSession.sessionId)
  assert.deepEqual(controller().status, {
    kind: 'info',
    text: 'Paused current turn. Queued follow-ups are back in the composer.',
  })
  assert.equal(controller().composerValue, 'queued prompt')
  assert.equal(controller().queuedPromptCount, 0)

  assert.equal(controller().submitPrompt('second prompt', 'enter'), 'clear')
  await flushAsyncWork(10)
  assert.deepEqual(controller().status, {
    kind: 'error',
    text: 'Response saved locally, but delivery failed: linq target missing',
  })
  assert.equal(controller().latestTurnsRef.current, 1)
  assert.deepEqual(controller().entries, [
    {
      kind: 'user',
      text: 'first prompt',
    },
    {
      kind: 'user',
      text: 'second prompt',
    },
    {
      kind: 'assistant',
      text: 'second reply',
    },
  ])

  await mounted.cleanup()
})
