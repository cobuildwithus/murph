import fs from 'node:fs'
import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

const inkUiMocks = vi.hoisted(() => ({
  captureAssistantInkThemeBaseline: vi.fn(),
  listAssistantTranscriptEntries: vi.fn(),
  openAssistantConversation: vi.fn(),
  redactAssistantDisplayPath: vi.fn(),
  redactAssistantSessionForDisplay: vi.fn(),
  render: vi.fn(),
  resolveAssistantInkThemeForOpenChat: vi.fn(),
  resolveAssistantOperatorDefaults: vi.fn(),
  resolveAssistantProviderDefaults: vi.fn(),
  resolveCodexDisplayOptions: vi.fn(),
  useAssistantChatController: vi.fn(),
}))

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink')
  inkUiMocks.render.mockImplementation((node, options) =>
    actual.render(node, options),
  )

  return {
    ...actual,
    render: inkUiMocks.render,
  }
})

vi.mock('../src/assistant/service.js', () => ({
  openAssistantConversation: inkUiMocks.openAssistantConversation,
}))

vi.mock('../src/assistant/store.js', () => ({
  listAssistantTranscriptEntries: inkUiMocks.listAssistantTranscriptEntries,
  redactAssistantDisplayPath: inkUiMocks.redactAssistantDisplayPath,
}))

vi.mock('@murphai/operator-config/operator-config', async () => {
  const actual =
    await vi.importActual<typeof import('@murphai/operator-config/operator-config')>(
      '@murphai/operator-config/operator-config',
    )

  return {
    ...actual,
    resolveAssistantOperatorDefaults: inkUiMocks.resolveAssistantOperatorDefaults,
    resolveAssistantProviderDefaults: inkUiMocks.resolveAssistantProviderDefaults,
  }
})

vi.mock('@murphai/assistant-engine/assistant-codex', () => ({
  resolveCodexDisplayOptions: inkUiMocks.resolveCodexDisplayOptions,
}))

vi.mock('@murphai/assistant-engine/assistant-runtime', async () => {
  const actual =
    await vi.importActual<typeof import('@murphai/assistant-engine/assistant-runtime')>(
      '@murphai/assistant-engine/assistant-runtime',
    )

  return {
    ...actual,
    redactAssistantSessionForDisplay: inkUiMocks.redactAssistantSessionForDisplay,
  }
})

vi.mock('../src/assistant/ui/theme.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/assistant/ui/theme.js')>(
      '../src/assistant/ui/theme.js',
    )

  return {
    ...actual,
    captureAssistantInkThemeBaseline:
      inkUiMocks.captureAssistantInkThemeBaseline,
    resolveAssistantInkThemeForOpenChat:
      inkUiMocks.resolveAssistantInkThemeForOpenChat,
  }
})

vi.mock('../src/assistant/ui/chat-controller.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/assistant/ui/chat-controller.js')>(
      '../src/assistant/ui/chat-controller.js',
    )

  return {
    ...actual,
    useAssistantChatController: inkUiMocks.useAssistantChatController,
  }
})

import {
  resolveAssistantInkInputAdapter,
  runAssistantChatWithInk,
  supportsAssistantInkRawMode,
} from '../src/assistant/ui/ink.js'
import * as assistantChatInk from '../src/assistant-chat-ink.js'
import {
  createInkTestInput,
  flushAsyncWork,
} from './helpers.ts'

const TEST_SESSION: AssistantSession = {
  schema: 'murph.assistant-session.v4',
  sessionId: 'session-ink-ui',
  target: {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpoint: 'http://127.0.0.1:11434/v1',
    headers: null,
    model: null,
    providerName: 'local',
    reasoningEffort: null,
  },
  resumeState: null,
  provider: 'openai-compatible',
  providerOptions: {
    model: 'gpt-5.4',
    reasoningEffort: 'medium',
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
  alias: 'chat:ink',
  binding: {
    conversationKey: 'chat:ink',
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

beforeEach(() => {
  vi.clearAllMocks()
  inkUiMocks.resolveAssistantOperatorDefaults.mockResolvedValue({
    schema: 'murph.operator-defaults.v1',
  })
  inkUiMocks.captureAssistantInkThemeBaseline.mockReturnValue({
    initialAppleInterfaceStyle: null,
    initialColorFgbg: '0;15',
    theme: {
      mode: 'light',
      accentColor: '#2563eb',
      assistantLabelColor: '#9333ea',
      borderColor: '#cbd5e1',
      composerBackground: '#f3f4f6',
      composerBorderColor: '#cbd5e1',
      composerCursorBackground: '#1d4ed8',
      composerCursorTextColor: '#ffffff',
      composerPlaceholderColor: '#6b7280',
      composerTextColor: '#111827',
      errorColor: '#dc2626',
      footerBadgeBackground: '#e2e8f0',
      footerBadgeTextColor: '#0f172a',
      infoColor: '#2563eb',
      mutedColor: '#64748b',
      successColor: '#16a34a',
      switcherBackground: '#f8fafc',
      switcherBorderColor: '#cbd5e1',
      switcherMutedColor: '#64748b',
      switcherSelectionBackground: '#dbeafe',
      switcherSelectionTextColor: '#0f172a',
      switcherTextColor: '#111827',
      userLabelColor: '#1d4ed8',
    },
  })
  inkUiMocks.openAssistantConversation.mockResolvedValue({
    session: TEST_SESSION,
  })
  inkUiMocks.resolveAssistantProviderDefaults.mockReturnValue(null)
  inkUiMocks.listAssistantTranscriptEntries.mockResolvedValue([])
  inkUiMocks.redactAssistantDisplayPath.mockReturnValue('<VAULT>')
  inkUiMocks.resolveCodexDisplayOptions.mockResolvedValue({
    model: 'gpt-5.4',
    reasoningEffort: null,
  })
  inkUiMocks.redactAssistantSessionForDisplay.mockImplementation((session) => session)
  inkUiMocks.resolveAssistantInkThemeForOpenChat.mockImplementation(
    ({ currentMode }) => ({
      ...inkUiMocks.captureAssistantInkThemeBaseline.mock.results[0]?.value?.theme,
      mode: currentMode,
    }),
  )
  inkUiMocks.useAssistantChatController.mockReturnValue({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'medium',
    bindingSummary: null,
    busy: false,
    cancelModelSwitcher: () => {},
    composerValue: '',
    confirmModelSwitcher: () => {},
    editLastQueuedPrompt: () => {},
    entries: [],
    lastQueuedPrompt: null,
    latestSessionRef: {
      current: TEST_SESSION,
    },
    latestTurnsRef: {
      current: 2,
    },
    metadataBadges: [],
    modelSwitcherState: null,
    moveModelSwitcherSelection: () => {},
    queuedPromptCount: 0,
    session: TEST_SESSION,
    setComposerValue: () => undefined,
    status: null,
    submitPrompt: () => 'keep',
  })
})

test('Ink input helpers detect raw mode support and fall back to a TTY stream when needed', () => {
  const stdin = createInkTestInput()

  assert.equal(supportsAssistantInkRawMode(stdin), true)
  assert.deepEqual(
    resolveAssistantInkInputAdapter({
      stdin,
    }).source,
    'stdin',
  )

  const ttyStream = createInkTestInput()
  const destroyTtyStream = ttyStream.destroy.bind(ttyStream)
  let ttyClosed = false
  const adapter = resolveAssistantInkInputAdapter({
    createTtyReadStream: () =>
      Object.assign(ttyStream, {
        destroy: () => {
          ttyClosed = true
          destroyTtyStream()
        },
      }),
    openTtyFd: () => 42,
    stdin: {
      isTTY: false,
    } as NodeJS.ReadStream,
    ttyPath: '/tmp/fake-tty',
  })

  assert.equal(adapter.source, 'tty')
  assert.ok(adapter.stdin)
  adapter.close()
  assert.equal(ttyClosed, true)

  const unsupportedAdapter = resolveAssistantInkInputAdapter({
    openTtyFd: () => {
      throw new Error('tty unavailable')
    },
    stdin: {
      isTTY: false,
    } as NodeJS.ReadStream,
  })
  assert.equal(typeof unsupportedAdapter.close, 'function')
  assert.equal(unsupportedAdapter.source, 'unsupported')
  assert.equal(unsupportedAdapter.stdin, null)
})

test('Ink input adapter closes the fallback file descriptor when a TTY stream still lacks raw mode support', () => {
  const closeSyncSpy = vi.spyOn(fs, 'closeSync').mockImplementation(() => undefined)
  let destroyed = false

  try {
    const adapter = resolveAssistantInkInputAdapter({
      createTtyReadStream: () => ({
        destroy: () => {
          destroyed = true
        },
        isTTY: true,
      }) as NodeJS.ReadStream,
      openTtyFd: () => 77,
      stdin: {
        isTTY: false,
      } as NodeJS.ReadStream,
    })

    assert.equal(adapter.source, 'unsupported')
    assert.equal(adapter.stdin, null)
    assert.equal(destroyed, true)
    assert.deepEqual(closeSyncSpy.mock.calls, [[77]])
  } finally {
    closeSyncSpy.mockRestore()
  }
})

test('runAssistantChatWithInk resolves a redacted result after Ink unmounts and the package barrel re-exports it', async () => {
  const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const stdin = createInkTestInput()
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stdin,
  })

  try {
    const resultPromise = runAssistantChatWithInk({
      initialPrompt: null,
      vault: '/tmp/vault',
    } as never)

    await flushAsyncWork(8)

    const instance = inkUiMocks.render.mock.results[0]?.value
    assert.ok(instance)
    instance.unmount()

    const result = await resultPromise

    assert.equal(assistantChatInk.runAssistantChatWithInk, runAssistantChatWithInk)
    assert.equal(result.vault, '<VAULT>')
    assert.equal(result.turns, 2)
    assert.deepEqual(result.session, TEST_SESSION)
    assert.match(result.startedAt, /^\d{4}-\d{2}-\d{2}T/u)
    assert.match(result.stoppedAt, /^\d{4}-\d{2}-\d{2}T/u)
    assert.equal(inkUiMocks.openAssistantConversation.mock.calls.length, 1)
    assert.equal(inkUiMocks.listAssistantTranscriptEntries.mock.calls.length, 1)
    assert.equal(inkUiMocks.useAssistantChatController.mock.calls.length, 1)
  } finally {
    if (originalStdinDescriptor) {
      Object.defineProperty(process, 'stdin', originalStdinDescriptor)
    }
    stdin.destroy()
  }
})

test('runAssistantChatWithInk rejects when no interactive input is available or Ink render initialization throws', async () => {
  const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const openSyncSpy = vi.spyOn(fs, 'openSync').mockImplementation(() => {
    throw new Error('no tty')
  })

  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: {
      isTTY: false,
    },
  })

  try {
    await assert.rejects(
      () =>
        runAssistantChatWithInk({
          initialPrompt: null,
          vault: '/tmp/vault',
        } as never),
      /requires interactive terminal input/u,
    )
  } finally {
    openSyncSpy.mockRestore()
    if (originalStdinDescriptor) {
      Object.defineProperty(process, 'stdin', originalStdinDescriptor)
    }
  }

  const stdin = createInkTestInput()
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stdin,
  })
  inkUiMocks.render.mockImplementationOnce(() => {
    throw new Error('render exploded')
  })

  try {
    await assert.rejects(
      () =>
        runAssistantChatWithInk({
          initialPrompt: null,
          vault: '/tmp/vault',
        } as never),
      /render exploded/u,
    )
  } finally {
    if (originalStdinDescriptor) {
      Object.defineProperty(process, 'stdin', originalStdinDescriptor)
    }
    stdin.destroy()
  }
})

test(
  'runAssistantChatWithInk refreshes the theme on macOS interval ticks before unmounting',
  async () => {
  const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  const stdin = createInkTestInput()

  inkUiMocks.resolveAssistantInkThemeForOpenChat
    .mockImplementationOnce(({ currentMode }) => ({
      ...inkUiMocks.captureAssistantInkThemeBaseline.mock.results[0]?.value?.theme,
      mode: currentMode,
    }))
    .mockImplementationOnce(() => ({
      ...inkUiMocks.captureAssistantInkThemeBaseline.mock.results[0]?.value?.theme,
      mode: 'dark',
    }))

  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stdin,
  })
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'darwin',
  })

  try {
    const resultPromise = runAssistantChatWithInk({
      initialPrompt: null,
      vault: '/tmp/vault',
    } as never)

    await flushAsyncWork(8)
    await new Promise((resolve) => {
      setTimeout(resolve, 2_100)
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 2_100)
    })

    const instance = inkUiMocks.render.mock.results.at(-1)?.value
    assert.ok(instance)
    instance.unmount()

    await resultPromise
    assert.equal(inkUiMocks.resolveAssistantInkThemeForOpenChat.mock.calls.length >= 2, true)
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
    if (originalStdinDescriptor) {
      Object.defineProperty(process, 'stdin', originalStdinDescriptor)
    }
    stdin.destroy()
  }
  },
  10_000,
)

test('runAssistantChatWithInk uses codex home config paths on non-macOS and renders the model switcher when active', async () => {
  const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  const stdin = createInkTestInput()
  const codexSession = {
    ...TEST_SESSION,
    provider: 'codex-cli' as const,
    providerOptions: {
      model: null,
      reasoningEffort: null,
      sandbox: null,
      approvalPolicy: null,
      profile: null,
      oss: false,
      codexHome: '/tmp/codex-home',
    },
  }

  inkUiMocks.openAssistantConversation.mockResolvedValueOnce({
    session: codexSession,
  })
  inkUiMocks.resolveAssistantProviderDefaults.mockReturnValueOnce({
    codexHome: '/tmp/fallback-home',
    model: 'fallback-model',
    profile: 'fallback-profile',
  })
  inkUiMocks.useAssistantChatController.mockReturnValueOnce({
    activeModel: 'gpt-5.4',
    activeReasoningEffort: 'medium',
    bindingSummary: null,
    busy: false,
    cancelModelSwitcher: () => {},
    composerValue: '',
    confirmModelSwitcher: () => {},
    editLastQueuedPrompt: () => {},
    entries: [],
    lastQueuedPrompt: null,
    latestSessionRef: {
      current: codexSession,
    },
    latestTurnsRef: {
      current: 0,
    },
    metadataBadges: [],
    modelSwitcherState: {
      mode: 'model',
      modelIndex: 0,
      modelOptions: [
        {
          description: 'Fast default',
          label: 'GPT-5.4',
          value: 'gpt-5.4',
        },
      ],
      models: [],
      reasoningIndex: 0,
      reasoningOptions: [],
    },
    moveModelSwitcherSelection: () => {},
    queuedPromptCount: 0,
    session: codexSession,
    setComposerValue: () => undefined,
    status: null,
    submitPrompt: () => 'keep',
  })

  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stdin,
  })
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'linux',
  })

  try {
    const resultPromise = runAssistantChatWithInk({
      initialPrompt: null,
      model: 'cli-model',
      profile: 'cli-profile',
      vault: '/tmp/vault',
    } as never)

    await flushAsyncWork(8)

    const instance = inkUiMocks.render.mock.results.at(-1)?.value
    assert.ok(instance)
    instance.unmount()

    await resultPromise
    assert.deepEqual(inkUiMocks.resolveCodexDisplayOptions.mock.calls.at(-1)?.[0], {
      configPath: '/tmp/codex-home/config.toml',
      model: 'cli-model',
      profile: 'cli-profile',
    })
  } finally {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor)
    }
    if (originalStdinDescriptor) {
      Object.defineProperty(process, 'stdin', originalStdinDescriptor)
    }
    stdin.destroy()
  }
})

test('runAssistantChatWithInk fails fast when neither stdin nor a controlling tty support raw mode', async () => {
  const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: {
      isTTY: false,
    } as NodeJS.ReadStream,
  })

  try {
    await assert.rejects(
      () =>
        runAssistantChatWithInk({
          initialPrompt: null,
          vault: '/tmp/vault',
        } as never),
      /requires interactive terminal input/u,
    )
  } finally {
    if (originalStdinDescriptor) {
      Object.defineProperty(process, 'stdin', originalStdinDescriptor)
    }
  }
})

test('runAssistantChatWithInk rejects when Ink render initialization throws', async () => {
  const originalStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const stdin = createInkTestInput()
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stdin,
  })
  inkUiMocks.render.mockImplementationOnce(() => {
    throw new Error('render failed')
  })

  try {
    await assert.rejects(
      () =>
        runAssistantChatWithInk({
          initialPrompt: null,
          vault: '/tmp/vault',
        } as never),
      /render failed/u,
    )
  } finally {
    if (originalStdinDescriptor) {
      Object.defineProperty(process, 'stdin', originalStdinDescriptor)
    }
    stdin.destroy()
  }
})
