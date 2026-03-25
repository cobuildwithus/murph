import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Box, Static, type Key } from 'ink'
import * as React from 'react'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  resolveAssistantStatePaths,
} from '../src/assistant-state.js'
import { VaultCliError } from '../src/vault-cli-errors.js'
import {
  resolveOperatorConfigPath,
  saveAssistantOperatorDefaultsPatch,
} from '../src/operator-config.js'
import {
  extractRecoveredAssistantSession,
  isAssistantProviderInterruptedError,
} from '../src/assistant/provider-turn-recovery.js'

const runtimeMocks = vi.hoisted(() => ({
  deliverAssistantMessageOverBinding: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
  routeInboxCaptureWithModel: vi.fn(),
  runAssistantChatWithInk: vi.fn(),
}))

vi.mock('../src/assistant-chat-ink.js', () => ({
  runAssistantChatWithInk: runtimeMocks.runAssistantChatWithInk,
}))

vi.mock('../src/outbound-channel.js', async () => {
  const actual = await vi.importActual<typeof import('../src/outbound-channel.js')>(
    '../src/outbound-channel.js',
  )

  return {
    ...actual,
    deliverAssistantMessageOverBinding:
      runtimeMocks.deliverAssistantMessageOverBinding,
  }
})

vi.mock('../src/chat-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../src/chat-provider.js')>(
    '../src/chat-provider.js',
  )

  return {
    ...actual,
    executeAssistantProviderTurn: runtimeMocks.executeAssistantProviderTurn,
  }
})

vi.mock('../src/inbox-model-harness.js', () => ({
  routeInboxCaptureWithModel: runtimeMocks.routeInboxCaptureWithModel,
}))

import {
  runAssistantAutomation,
  runAssistantChat,
  scanAssistantAutoReplyOnce,
  scanAssistantInboxOnce,
  sendAssistantMessage,
} from '../src/assistant-runtime.js'
import { bridgeAbortSignals } from '../src/assistant/automation/shared.js'
import {
  CHAT_BANNER,
  CHAT_COMPOSER_HINT,
  CHAT_MODEL_OPTIONS,
  CHAT_REASONING_OPTIONS,
  CHAT_SLASH_COMMANDS,
  CHAT_STARTER_SUGGESTIONS,
  applyInkChatTraceUpdates,
  applyProviderProgressEventToEntries,
  findAssistantModelOptionIndex,
  findAssistantReasoningOptionIndex,
  formatBusyStatus,
  formatChatMetadata,
  formatElapsedClock,
  formatSessionBinding,
  getMatchingSlashCommands,
  resolveChatMetadataBadges,
  resolveChatSubmitAction,
  seedChatEntries,
  shouldShowChatComposerGuidance,
  shouldClearComposerForSubmitAction,
} from '../src/assistant/ui/view-model.js'
import {
  applyComposerEditingInput,
  formatFooterBadgeText,
  formatAssistantTerminalHyperlink,
  formatQueuedFollowUpPreview,
  mergeComposerDraftWithQueuedPrompts,
  normalizeComposerInsertedText,
  partitionChatTranscriptEntries,
  renderChatTranscriptFeed,
  renderComposerValue,
  renderWrappedTextBlock,
  resolveAssistantChatViewportWidth,
  resolveAssistantInkInputAdapter,
  resolveAssistantPlainTextWrapColumns,
  resolveChromePanelBoxProps,
  resolveMessageRoleLabel,
  resolveAssistantHyperlinkTarget,
  resolveComposerTerminalAction,
  resolveComposerVerticalCursorMove,
  shouldShowBusyStatus,
  splitAssistantMarkdownLinks,
  supportsAssistantInkRawMode,
  supportsAssistantTerminalHyperlinks,
  wrapAssistantPlainText,
} from '../src/assistant/ui/ink.js'
import { LIGHT_ASSISTANT_INK_THEME } from '../src/assistant/ui/theme.js'

const cleanupPaths: string[] = []

function createComposerKey(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  }
}

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

beforeEach(() => {
  runtimeMocks.deliverAssistantMessageOverBinding.mockReset()
  runtimeMocks.executeAssistantProviderTurn.mockReset()
  runtimeMocks.routeInboxCaptureWithModel.mockReset()
  runtimeMocks.runAssistantChatWithInk.mockReset()
})

test('sendAssistantMessage persists only assistant session metadata and reuses provider sessions via alias keys', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-runtime-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-123',
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-123',
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  const first = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    identityId: 'assistant:primary',
    participantId: 'contact:bob',
    sourceThreadId: 'chat-123',
    provider: 'codex-cli',
    prompt: 'What did Bob eat?',
    reasoningEffort: 'xhigh',
    sandbox: 'read-only',
    approvalPolicy: 'never',
  })

  const second = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    prompt: 'What about today?',
  })

  assert.equal(first.session.turnCount, 1)
  assert.equal(first.session.providerSessionId, 'thread-123')
  assert.equal(first.session.alias, 'imessage:bob')
  assert.equal(first.delivery, null)
  assert.equal(first.deliveryError, null)
  assert.equal(first.session.binding.channel, 'imessage')
  assert.equal(first.session.binding.actorId, 'contact:bob')
  assert.equal(first.session.binding.threadId, 'chat-123')
  assert.equal('vault' in first.session, false)
  assert.equal('stateRoot' in first.session, false)
  assert.equal(second.session.sessionId, first.session.sessionId)
  assert.equal(second.session.turnCount, 2)
  assert.equal('lastUserMessage' in second.session, false)
  assert.equal('lastAssistantMessage' in second.session, false)

  const firstCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(firstCall.resumeProviderSessionId, null)
  assert.equal(secondCall.resumeProviderSessionId, 'thread-123')
  assert.equal(firstCall.reasoningEffort, 'xhigh')
  assert.equal(secondCall.reasoningEffort, 'xhigh')
  assert.match(firstCall.systemPrompt ?? '', /You are Healthy Bob/u)
  assert.equal(firstCall.userPrompt, 'What did Bob eat?')
  assert.equal(firstCall.sessionContext?.binding.channel, 'imessage')
  assert.equal(secondCall.systemPrompt, null)
  assert.equal(secondCall.userPrompt, 'What about today?')
})

test('sendAssistantMessage recovers provider sessions after user interruptions and preserves the interrupt marker', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-interrupt-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const abortController = new AbortController()
  runtimeMocks.executeAssistantProviderTurn.mockRejectedValue(
    new VaultCliError(
      'ASSISTANT_CODEX_INTERRUPTED',
      'Codex CLI was interrupted.',
      {
        interrupted: true,
        providerSessionId: 'thread-pause-1',
      },
    ),
  )

  await assert.rejects(
    sendAssistantMessage({
      vault: vaultRoot,
      alias: 'imessage:bob',
      prompt: 'Pause this turn.',
      abortSignal: abortController.signal,
      provider: 'codex-cli',
    }),
    (error: any) => {
      assert.equal(isAssistantProviderInterruptedError(error), true)
      const recoveredSession = extractRecoveredAssistantSession(error)
      assert.equal(recoveredSession?.providerSessionId, 'thread-pause-1')
      return true
    },
  )

  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(providerCall?.abortSignal, abortController.signal)

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    alias: 'imessage:bob',
    provider: 'codex-cli',
    model: null,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    oss: false,
    profile: null,
    reasoningEffort: null,
    maxSessionAgeMs: null,
  })

  assert.equal(resolved.session.providerSessionId, 'thread-pause-1')
  assert.equal(resolved.session.turnCount, 0)
})

test('sendAssistantMessage can optionally deliver the provider reply over the mapped outbound channel', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-delivery-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'sent reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(
    async (input: { message: string; sessionId: string; vault: string }) => ({
      vault: path.resolve(input.vault),
      message: input.message,
      session: {
        schema: 'healthybob.assistant-session.v2',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-123',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: 'imessage:bob',
        binding: {
          conversationKey: 'channel:imessage|actor:%2B15551234567',
          channel: 'imessage',
          identityId: null,
          actorId: '+15551234567',
          threadId: null,
          threadIsDirect: null,
          delivery: {
            kind: 'participant',
            target: '+15551234567',
          },
        },
        createdAt: '2026-03-16T00:00:00.000Z',
        updatedAt: '2026-03-16T00:00:01.000Z',
        lastTurnAt: '2026-03-16T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'imessage',
        target: '+15551234567',
        targetKind: 'participant',
        sentAt: '2026-03-16T00:00:01.000Z',
        messageLength: input.message.length,
      },
    }),
  )

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    participantId: '+15551234567',
    prompt: 'send it',
    deliverResponse: true,
  })

  assert.equal(result.response, 'sent reply')
  assert.equal(result.delivery?.channel, 'imessage')
  assert.equal(result.delivery?.target, '+15551234567')
  assert.equal(result.deliveryError, null)
  const deliveryCall = runtimeMocks.deliverAssistantMessageOverBinding.mock.calls[0]?.[0]
  assert.equal(deliveryCall?.vault, vaultRoot)
  assert.equal(deliveryCall?.sessionId, result.session.sessionId)
  assert.equal(deliveryCall?.channel, 'imessage')
  assert.equal(deliveryCall?.identityId, null)
  assert.equal(deliveryCall?.actorId, '+15551234567')
  assert.equal(deliveryCall?.threadId, null)
  assert.equal(deliveryCall?.threadIsDirect, null)
  assert.equal(deliveryCall?.target, null)
  assert.equal(deliveryCall?.message, 'sent reply')
})

test('sendAssistantMessage keeps provider success and session updates even when outbound delivery fails', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-delivery-failure-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-500',
    response: 'reply persisted',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockRejectedValue(
    Object.assign(new Error('delivery exploded'), {
      code: 'ASSISTANT_CHANNEL_DELIVERY_FAILED',
    }),
  )

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'imessage:bob',
    channel: 'imessage',
    participantId: '+15551234567',
    prompt: 'send anyway',
    deliverResponse: true,
  })

  assert.equal(result.response, 'reply persisted')
  assert.equal(result.delivery, null)
  assert.deepEqual(result.deliveryError, {
    code: 'ASSISTANT_CHANNEL_DELIVERY_FAILED',
    message: 'delivery exploded',
  })
  assert.equal(result.session.providerSessionId, 'thread-500')
  assert.equal('lastAssistantMessage' in result.session, false)
})

test('sendAssistantMessage reuses saved assistant model defaults and persists reasoning effort metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-defaults',
    response: 'defaults reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    await saveAssistantOperatorDefaultsPatch(
      {
        model: 'gpt-5.4-mini',
        reasoningEffort: 'high',
      },
      homeRoot,
    )

    const result = await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'reuse defaults',
    })

    const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(providerCall.model, 'gpt-5.4-mini')
    assert.equal(providerCall.reasoningEffort, 'high')
    assert.equal(result.session.providerOptions.model, 'gpt-5.4-mini')
    assert.equal(result.session.providerOptions.reasoningEffort, 'high')
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage reuses saved OpenAI-compatible assistant defaults', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-openai-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot
  const originalApiKey = process.env.OLLAMA_API_KEY
  process.env.OLLAMA_API_KEY = 'secret-token'

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'openai-compatible',
    providerSessionId: null,
    response: 'defaults reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    await saveAssistantOperatorDefaultsPatch(
      {
        provider: 'openai-compatible',
        model: 'gpt-oss:20b',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKeyEnv: 'OLLAMA_API_KEY',
        providerName: 'ollama',
      },
      homeRoot,
    )

    const result = await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'reuse openai-compatible defaults',
    })

    const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(providerCall.provider, 'openai-compatible')
    assert.equal(providerCall.model, 'gpt-oss:20b')
    assert.equal(providerCall.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(providerCall.apiKeyEnv, 'OLLAMA_API_KEY')
    assert.equal(providerCall.providerName, 'ollama')
    assert.equal(result.session.provider, 'openai-compatible')
    assert.equal(result.session.providerOptions.model, 'gpt-oss:20b')
    assert.equal(result.session.providerOptions.baseUrl, 'http://127.0.0.1:11434/v1')
    assert.equal(result.session.providerOptions.apiKeyEnv, 'OLLAMA_API_KEY')
    assert.equal(result.session.providerOptions.providerName, 'ollama')
  } finally {
    restoreEnvironmentVariable('OLLAMA_API_KEY', originalApiKey)
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage stores prompt and response excerpts in the local assistant transcript without adding them to session metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-runtime-summary-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const longPrompt = `prompt ${'x'.repeat(400)}`
  const longResponse = `response ${'y'.repeat(400)}`

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-999',
    response: longResponse,
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const result = await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'telegram:bob',
    prompt: longPrompt,
  })

  assert.equal('lastUserMessage' in result.session, false)
  assert.equal('lastAssistantMessage' in result.session, false)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const persisted = JSON.parse(
    await readFile(
      path.join(statePaths.sessionsDirectory, `${result.session.sessionId}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>
  assert.equal('lastUserMessage' in persisted, false)
  assert.equal('lastAssistantMessage' in persisted, false)

  const transcript = await listAssistantTranscriptEntries(
    vaultRoot,
    result.session.sessionId,
  )
  assert.deepEqual(
    transcript.map((entry) => ({
      kind: entry.kind,
      text: entry.text,
    })),
    [
      {
        kind: 'user',
        text: longPrompt,
      },
      {
        kind: 'assistant',
        text: longResponse,
      },
    ],
  )
})

test('sendAssistantMessage redacts vault paths under HOME in returned output', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-home-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-home',
    response: 'home-safe reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'imessage:bob',
      prompt: 'Keep paths private.',
    })

    assert.equal(result.vault, path.join('~', 'vault'))
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('sendAssistantMessage applies assistant defaults from operator config when flags are omitted', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-defaults-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-defaults',
    response: 'defaulted reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    const configPath = resolveOperatorConfigPath(homeRoot)
    await mkdir(path.dirname(configPath), {
      recursive: true,
    })
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          schema: 'healthybob.operator-config.v1',
          defaultVault: null,
          assistant: {
            provider: 'codex-cli',
            codexCommand: '/opt/bin/codex',
            model: 'gpt-oss:20b',
            identityId: 'assistant:primary',
            account: {
              source: 'codex-rpc+codex-auth-json',
              kind: 'account',
              planCode: 'pro',
              planName: 'Pro',
              quota: {
                creditsRemaining: 12,
                creditsUnlimited: false,
                primaryWindow: {
                  usedPercent: 40,
                  remainingPercent: 60,
                  windowMinutes: 300,
                  resetsAt: '2026-03-25T10:00:00.000Z',
                },
                secondaryWindow: null,
              },
            },
            sandbox: 'workspace-write',
            approvalPolicy: 'on-request',
            profile: 'ops',
            oss: true,
          },
          updatedAt: '2026-03-17T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const result = await sendAssistantMessage({
      vault: vaultRoot,
      alias: 'defaults:bob',
      prompt: 'use defaults',
    })

    assert.equal(result.session.binding.identityId, 'assistant:primary')
    assert.equal(result.session.providerOptions.model, 'gpt-oss:20b')
    assert.equal(result.session.providerOptions.sandbox, 'workspace-write')
    assert.equal(result.session.providerOptions.approvalPolicy, 'on-request')
    assert.equal(result.session.providerOptions.profile, 'ops')
    assert.equal(result.session.providerOptions.oss, true)

    const call = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
    assert.equal(call?.codexCommand, '/opt/bin/codex')
    assert.equal(call?.model, 'gpt-oss:20b')
    assert.equal(call?.sandbox, 'workspace-write')
    assert.equal(call?.approvalPolicy, 'on-request')
    assert.equal(call?.profile, 'ops')
    assert.equal(call?.oss, true)
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

test('scanAssistantInboxOnce skips completed captures, waits for parsers, routes canonical writes, and records failures', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-scan-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(path.join(vaultRoot, 'derived', 'inbox', 'cap-existing', 'assistant'), {
    recursive: true,
  })
  await writeFile(
    path.join(vaultRoot, 'derived', 'inbox', 'cap-existing', 'assistant', 'result.json'),
    '{"ok":true}\n',
    'utf8',
  )

  runtimeMocks.routeInboxCaptureWithModel.mockImplementation(async ({ captureId }) => {
    if (captureId === 'cap-noop') {
      return {
        plan: {
          actions: [],
        },
      }
    }

    if (captureId === 'cap-route') {
      return {
        plan: {
          actions: [
            {
              tool: 'meal.add',
            },
          ],
        },
      }
    }

    if (captureId === 'cap-fail') {
      throw new Error('route exploded')
    }

    throw new Error(`Unexpected route capture: ${captureId}`)
  })

  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const listCalls: unknown[] = []
  const cursorProgress: Array<{ occurredAt: string; captureId: string } | null> = []
  const inboxServices = {
    list: async (input: unknown) => {
      listCalls.push(input)
      return {
      items: [
        {
          captureId: 'cap-existing',
          occurredAt: '2026-03-16T16:00:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-promoted',
          occurredAt: '2026-03-16T16:01:00Z',
          promotions: [{}],
        },
        {
          captureId: 'cap-pending',
          occurredAt: '2026-03-16T16:02:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-noop',
          occurredAt: '2026-03-16T16:03:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-route',
          occurredAt: '2026-03-16T16:04:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-fail',
          occurredAt: '2026-03-16T16:05:00Z',
          promotions: [],
        },
        {
          captureId: 'cap-show-fail',
          occurredAt: '2026-03-16T16:06:00Z',
          promotions: [],
        },
      ],
    }
    },
    show: async ({ captureId }: { captureId: string }) => {
      if (captureId === 'cap-show-fail') {
        throw new Error('show exploded')
      }

      return {
        capture: {
          attachments:
            captureId === 'cap-pending'
              ? [
                  {
                    parseState: 'pending',
                  },
                ]
              : [
                  {
                    parseState: 'succeeded',
                  },
                ],
        },
      }
    },
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    afterCursor: {
      occurredAt: '2026-03-16T15:59:00Z',
      captureId: 'cap-before',
    },
    oldestFirst: true,
    onCursorProgress(cursor) {
      cursorProgress.push(cursor)
    },
    onEvent(event) {
      events.push({
        type: event.type,
        captureId: event.captureId,
        details: event.details,
      })
    },
  })

  assert.deepEqual(result, {
    considered: 7,
    failed: 2,
    noAction: 1,
    routed: 1,
    skipped: 3,
  })
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.routed' && event.captureId === 'cap-route',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.failed' &&
        event.captureId === 'cap-show-fail' &&
        event.details === 'show exploded',
    ),
    true,
  )
  assert.deepEqual(listCalls, [
    {
      vault: vaultRoot,
      requestId: null,
      limit: 50,
      sourceId: null,
      afterOccurredAt: '2026-03-16T15:59:00Z',
      afterCaptureId: 'cap-before',
      oldestFirst: true,
    },
  ])
  assert.deepEqual(cursorProgress, [
    {
      occurredAt: '2026-03-16T16:06:00Z',
      captureId: 'cap-show-fail',
    },
  ])
})


test('scanAssistantInboxOnce bypasses parser waits for supported pending meal photos', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-scan-photo-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.routeInboxCaptureWithModel.mockResolvedValue({
    plan: {
      actions: [
        {
          tool: 'meal.add',
        },
      ],
    },
  })

  const inboxServices = {
    list: async () => ({
      items: [
        {
          captureId: 'cap-photo',
          occurredAt: '2026-03-16T16:10:00Z',
          promotions: [],
        },
      ],
    }),
    show: async () => ({
      capture: {
        attachments: [
          {
            kind: 'image',
            fileName: 'meal.jpg',
            mediaType: 'image/jpeg',
            storedPath: 'attachments/2026/03/16/meal.jpg',
            parseState: 'pending',
          },
        ],
      },
    }),
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    noAction: 0,
    routed: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.routeInboxCaptureWithModel.mock.calls.length, 1)
  assert.equal(
    runtimeMocks.routeInboxCaptureWithModel.mock.calls[0]?.[0]?.captureId,
    'cap-photo',
  )
})

test('scanAssistantInboxOnce still waits for pending document parsers', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-scan-doc-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: Array<{ type: string; details?: string }> = []
  const inboxServices = {
    list: async () => ({
      items: [
        {
          captureId: 'cap-doc',
          occurredAt: '2026-03-16T16:11:00Z',
          promotions: [],
        },
      ],
    }),
    show: async () => ({
      capture: {
        attachments: [
          {
            kind: 'document',
            fileName: 'report.pdf',
            mediaType: 'application/pdf',
            storedPath: 'attachments/2026/03/16/report.pdf',
            parseState: 'pending',
          },
        ],
      },
    }),
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    onEvent(event) {
      events.push({
        type: event.type,
        details: event.details,
      })
    },
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.routeInboxCaptureWithModel.mock.calls.length, 0)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.skipped' &&
        event.details === 'waiting for parser completion',
    ),
    true,
  )
})

test('scanAssistantInboxOnce still waits for unsupported pending HEIC photos', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-scan-heic-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const events: Array<{ type: string; details?: string }> = []
  const inboxServices = {
    list: async () => ({
      items: [
        {
          captureId: 'cap-heic',
          occurredAt: '2026-03-16T16:12:00Z',
          promotions: [],
        },
      ],
    }),
    show: async () => ({
      capture: {
        attachments: [
          {
            kind: 'image',
            fileName: 'meal.heic',
            mediaType: 'image/heic',
            storedPath: 'attachments/2026/03/16/meal.heic',
            parseState: 'pending',
          },
        ],
      },
    }),
  } as any

  const result = await scanAssistantInboxOnce({
    inboxServices,
    vault: vaultRoot,
    modelSpec: {
      model: 'gpt-oss:20b',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    onEvent(event) {
      events.push({
        type: event.type,
        details: event.details,
      })
    },
  })

  assert.deepEqual(result, {
    considered: 1,
    failed: 0,
    noAction: 0,
    routed: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.routeInboxCaptureWithModel.mock.calls.length, 0)
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.skipped' &&
        event.details === 'waiting for parser completion',
    ),
    true,
  )
})

test('scanAssistantAutoReplyOnce primes backlog cursors and replies to new inbound iMessages', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-auto-reply-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockImplementation(async (input: any) => {
    input.onEvent?.({
      id: 'search-1',
      kind: 'search',
      rawEvent: {
        type: 'item.started',
      },
      state: 'running',
      text: 'Web: macros today',
    })
    input.onEvent?.({
      id: 'tool-1',
      kind: 'tool',
      rawEvent: {
        type: 'item.completed',
      },
      state: 'completed',
      text: 'Tool healthybob.inbox_list',
    })

    return {
      provider: 'codex-cli',
      providerSessionId: 'thread-auto',
      response: 'auto reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    }
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    vault: path.resolve(input.vault),
    message: input.message,
    session: {
      schema: 'healthybob.assistant-session.v2',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerSessionId: 'thread-auto',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:imessage|thread:chat-2',
        channel: 'imessage',
        identityId: null,
        actorId: '+15551234567',
        threadId: 'chat-2',
        threadIsDirect: true,
        delivery: {
          kind: 'participant',
          target: '+15551234567',
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'imessage',
      target: '+15551234567',
      targetKind: 'participant',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  const events: Array<{
    captureId?: string
    details?: string
    providerKind?: string
    providerState?: string
    type: string
  }> = []
  const listCalls: unknown[] = []

  const inboxServices = {
    async list(input: any) {
      listCalls.push(input)
      if (input.oldestFirst === false) {
        return {
          items: [
            {
              captureId: 'cap-backlog',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-1',
              threadId: 'chat-1',
              threadTitle: null,
              actorId: '+15550001111',
              actorName: 'Backlog',
              actorIsSelf: false,
              occurredAt: '2026-03-18T09:00:00Z',
              receivedAt: null,
              text: 'old message',
              attachmentCount: 0,
              envelopePath: 'raw/inbox/1.json',
              eventId: 'evt-1',
              promotions: [],
            },
          ],
        }
      }

      return {
        items: [
          {
            captureId: 'cap-new',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-2',
            threadId: 'chat-2',
            threadTitle: null,
            actorId: '+15551234567',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:05:00Z',
            receivedAt: null,
            text: 'How are my macros today?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/2.json',
            eventId: 'evt-2',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      assert.equal(input.captureId, 'cap-new')
      return {
        capture: {
          captureId: 'cap-new',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-2',
          threadIsDirect: true,
          actorId: '+15551234567',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:05:00Z',
          text: 'How are my macros today?',
          attachments: [],
        },
      }
    },
  } as any

  const prime = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: false,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(prime, {
    considered: 0,
    failed: 0,
    replied: 0,
    skipped: 0,
  })
  assert.deepEqual(stateProgress[0], {
    cursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-backlog',
    },
    primed: true,
  })

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: stateProgress[0]!.cursor,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(second, {
    considered: 1,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.deepEqual(stateProgress[1], {
    cursor: {
      occurredAt: '2026-03-18T09:05:00Z',
      captureId: 'cap-new',
    },
    primed: true,
  })
  const artifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-new',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  assert.equal(artifact.schema, 'healthybob.assistant-chat-result.v1')
  assert.equal(
    events.some(
      (event) => event.type === 'reply.scan.primed' && event.details?.includes('cap-backlog'),
    ),
    true,
  )
  assert.equal(
    events.some((event) => event.type === 'capture.replied' && event.captureId === 'cap-new'),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-started' &&
        event.captureId === 'cap-new' &&
        event.details === 'assistant provider turn started',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-progress' &&
        event.captureId === 'cap-new' &&
        event.providerKind === 'search' &&
        event.providerState === 'running' &&
        event.details === 'Web: macros today',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-progress' &&
        event.captureId === 'cap-new' &&
        event.providerKind === 'tool' &&
        event.providerState === 'completed' &&
        event.details === 'Tool healthybob.inbox_list',
    ),
    true,
  )
  assert.match(providerCall?.systemPrompt ?? '', /optional onboarding check-in/u)
  assert.match(providerCall?.systemPrompt ?? '', /what tone or response style they want/u)
  assert.deepEqual(listCalls, [
    {
      vault: vaultRoot,
      requestId: null,
      limit: 1,
      sourceId: null,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: false,
    },
    {
      vault: vaultRoot,
      requestId: null,
      limit: 50,
      sourceId: null,
      afterOccurredAt: '2026-03-18T09:00:00Z',
      afterCaptureId: 'cap-backlog',
      oldestFirst: true,
    },
  ])
})

test('scanAssistantAutoReplyOnce injects persisted onboarding answers and asks only for missing items', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-auto-reply-onboarding-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot, { recursive: true })
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-prefill',
      response: 'prefill reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-onboarding-auto',
      response: 'auto reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
  runtimeMocks.deliverAssistantMessageOverBinding.mockResolvedValue({
    delivery: {
      channel: 'imessage',
      target: '+15551239999',
      targetKind: 'participant',
      sentAt: '2026-03-18T10:00:01.000Z',
      messageLength: 10,
    },
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:onboarding-prefill',
    enableFirstTurnOnboarding: true,
    prompt: 'Call me Chris. Keep answers concise.',
  })

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-new',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-9',
            threadId: 'chat-9',
            threadTitle: null,
            actorId: '+15551239999',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T10:00:00Z',
            receivedAt: null,
            text: 'How are my macros today?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/9.json',
            eventId: 'evt-9',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-new',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-9',
          threadIsDirect: true,
          actorId: '+15551239999',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T10:00:00Z',
          text: 'How are my macros today?',
          attachments: [],
        },
      }
    },
  } as any

  await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    vault: vaultRoot,
  })

  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.match(providerCall?.systemPrompt ?? '', /Known onboarding answers/u)
  assert.match(providerCall?.systemPrompt ?? '', /Name: Call the user Chris\./u)
  assert.match(providerCall?.systemPrompt ?? '', /Tone\/style: Keep answers concise\./u)
  assert.match(providerCall?.systemPrompt ?? '', /what goals they want help with/u)
  assert.doesNotMatch(
    providerCall?.systemPrompt ?? '',
    /whether they want to give you a name/u,
  )
  assert.doesNotMatch(
    providerCall?.systemPrompt ?? '',
    /what tone or response style they want/u,
  )
})

test('scanAssistantAutoReplyOnce coalesces same-thread email backlog into one reply', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-email-backlog-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot, { recursive: true })

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    backlogChannels?: readonly string[]
    primed: boolean
  }> = []
  const listCalls: unknown[] = []

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-email-backlog',
    response: 'email backlog reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    vault: path.resolve(input.vault),
    message: input.message,
    session: {
      schema: 'healthybob.assistant-session.v2',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerSessionId: 'thread-email-backlog',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:email|identity:healthybob%40agentmail.to|thread:thread-1',
        channel: 'email',
        identityId: 'healthybob@agentmail.to',
        actorId: 'person@example.test',
        threadId: 'thread-1',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: 'thread-1',
        },
      },
      createdAt: '2026-03-18T09:00:00.000Z',
      updatedAt: '2026-03-18T09:00:00.000Z',
      lastTurnAt: '2026-03-18T09:00:00.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'email',
      target: 'thread-1',
      targetKind: 'thread',
      sentAt: '2026-03-18T09:00:01.000Z',
      messageLength: input.message.length,
    },
    deliveryError: null,
    provider: {
      name: 'codex-cli',
      model: null,
      response: 'email backlog reply',
      rawEvents: [],
    },
    sessionId: input.sessionId,
    transcriptEntries: [],
  }))

  const inboxServices = {
    async list(input: any) {
      listCalls.push(input)
      return {
        items: [
          {
            captureId: 'cap-email-1',
            source: 'email',
            accountId: 'healthybob@agentmail.to',
            externalId: 'email:1',
            threadId: 'thread-1',
            threadTitle: 'Re: whats good',
            actorId: 'person@example.test',
            actorName: 'Person',
            actorIsSelf: false,
            occurredAt: '2026-03-18T08:58:00Z',
            receivedAt: '2026-03-18T08:58:00Z',
            text: 'first email in thread',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/email/1.json',
            eventId: 'evt-email-1',
            promotions: [],
          },
          {
            captureId: 'cap-email-2',
            source: 'email',
            accountId: 'healthybob@agentmail.to',
            externalId: 'email:2',
            threadId: 'thread-1',
            threadTitle: 'Re: whats good',
            actorId: 'person@example.test',
            actorName: 'Person',
            actorIsSelf: false,
            occurredAt: '2026-03-18T08:59:00Z',
            receivedAt: '2026-03-18T08:59:00Z',
            text: 'second email in thread',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/email/2.json',
            eventId: 'evt-email-2',
            promotions: [],
          },
          {
            captureId: 'cap-email-3',
            source: 'email',
            accountId: 'healthybob@agentmail.to',
            externalId: 'email:3',
            threadId: 'thread-1',
            threadTitle: 'Re: whats good',
            actorId: 'person@example.test',
            actorName: 'Person',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: '2026-03-18T09:00:00Z',
            text: 'latest email in thread',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/email/3.json',
            eventId: 'evt-email-3',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      const textByCaptureId: Record<string, string> = {
        'cap-email-1': 'first email in thread',
        'cap-email-2': 'second email in thread',
        'cap-email-3': 'latest email in thread',
      }
      assert.equal(typeof textByCaptureId[input.captureId], 'string')
      return {
        capture: {
          captureId: input.captureId,
          source: 'email',
          accountId: 'healthybob@agentmail.to',
          threadTitle: 'Re: whats good',
          threadId: 'thread-1',
          threadIsDirect: true,
          actorId: 'person@example.test',
          actorName: 'Person',
          actorIsSelf: false,
          occurredAt:
            input.captureId === 'cap-email-1'
              ? '2026-03-18T08:58:00Z'
              : input.captureId === 'cap-email-2'
                ? '2026-03-18T08:59:00Z'
                : '2026-03-18T09:00:00Z',
          text: textByCaptureId[input.captureId],
          attachments: [],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: false,
    backlogChannels: ['email'],
    enabledChannels: ['email'],
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 3,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length > 0, true)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)
  const providerCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  assert.equal(typeof providerCall?.userPrompt, 'string')
  assert.match(providerCall.userPrompt, /Grouped captures: 3/)
  assert.match(providerCall.userPrompt, /Capture 1:/)
  assert.match(providerCall.userPrompt, /first email in thread/)
  assert.match(providerCall.userPrompt, /second email in thread/)
  assert.match(providerCall.userPrompt, /latest email in thread/)
  assert.deepEqual(stateProgress[0], {
    cursor: {
      occurredAt: '2026-03-18T09:00:00Z',
      captureId: 'cap-email-3',
    },
    primed: true,
  })
  assert.deepEqual(listCalls, [
    {
      vault: vaultRoot,
      requestId: null,
      limit: 50,
      sourceId: null,
      afterOccurredAt: null,
      afterCaptureId: null,
      oldestFirst: true,
    },
  ])
})

test('scanAssistantAutoReplyOnce can use self-authored attachment prompts and suppress recent assistant echoes', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-18T00:00:00.000Z'))

  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-self-auto-reply-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  try {
    runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
      provider: 'codex-cli',
      providerSessionId: 'thread-self',
      response: 'auto reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
      vault: path.resolve(input.vault),
      message: input.message,
      session: {
        schema: 'healthybob.assistant-session.v2',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-self',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: 'channel:imessage|thread:self-chat',
          channel: 'imessage',
          identityId: null,
          actorId: '+15550000000',
          threadId: 'self-chat',
          threadIsDirect: true,
          delivery: {
            kind: 'participant',
            target: '+15550000000',
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:00.000Z',
        lastTurnAt: '2026-03-18T00:00:00.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'imessage',
        target: '+15550000000',
        targetKind: 'participant',
        sentAt: '2026-03-18T00:00:00.000Z',
        messageLength: input.message.length,
      },
    }))

    let phase: 'prompt' | 'echo' = 'prompt'
    const stateProgress: Array<{
      cursor: { occurredAt: string; captureId: string } | null
      primed: boolean
    }> = []

    const inboxServices = {
      async list() {
        if (phase === 'prompt') {
          return {
            items: [
              {
                captureId: 'cap-self',
                source: 'imessage',
                accountId: 'self',
                externalId: 'ext-self',
                threadId: 'self-chat',
                threadTitle: 'Self',
                actorId: '+15550000000',
                actorName: 'Self User',
                actorIsSelf: true,
                occurredAt: '2026-03-18T00:00:00.000Z',
                receivedAt: null,
                text: null,
                attachmentCount: 1,
                envelopePath: 'raw/inbox/self.json',
                eventId: 'evt-self',
                promotions: [],
              },
            ],
          }
        }

        return {
          items: [
            {
              captureId: 'cap-echo',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-echo',
              threadId: 'self-chat',
              threadTitle: 'Self',
              actorId: '+15550000000',
              actorName: 'Self User',
              actorIsSelf: true,
              occurredAt: '2026-03-18T00:00:05.000Z',
              receivedAt: null,
              text: 'auto reply',
              attachmentCount: 0,
              envelopePath: 'raw/inbox/echo.json',
              eventId: 'evt-echo',
              promotions: [],
            },
          ],
        }
      },
      async show(input: any) {
        if (input.captureId === 'cap-self') {
          return {
            capture: {
              captureId: 'cap-self',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-self',
              threadId: 'self-chat',
              threadTitle: 'Self',
              threadIsDirect: true,
              actorId: '+15550000000',
              actorName: 'Self User',
              actorIsSelf: true,
              occurredAt: '2026-03-18T00:00:00.000Z',
              receivedAt: null,
              text: null,
              attachmentCount: 1,
              envelopePath: 'raw/inbox/self.json',
              eventId: 'evt-self',
              createdAt: '2026-03-18T00:00:00.000Z',
              promotions: [],
              attachments: [
                {
                  ordinal: 1,
                  kind: 'audio',
                  fileName: 'voice.m4a',
                  transcriptText: 'Remember eggs and yogurt.',
                  extractedText: null,
                  parseState: 'succeeded',
                },
              ],
            },
          }
        }

        return {
          capture: {
            captureId: 'cap-echo',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-echo',
            threadId: 'self-chat',
            threadTitle: 'Self',
            threadIsDirect: true,
            actorId: '+15550000000',
            actorName: 'Self User',
            actorIsSelf: true,
            occurredAt: '2026-03-18T00:00:05.000Z',
            receivedAt: null,
            text: 'auto reply',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/echo.json',
            eventId: 'evt-echo',
            createdAt: '2026-03-18T00:00:05.000Z',
            promotions: [],
            attachments: [],
          },
        }
      },
    } as any

    const first = await scanAssistantAutoReplyOnce({
      afterCursor: null,
      autoReplyPrimed: true,
      allowSelfAuthored: true,
      enabledChannels: ['imessage'],
      inboxServices,
      vault: vaultRoot,
      async onStateProgress(next) {
        stateProgress.push(next)
      },
    })

    assert.deepEqual(first, {
      considered: 1,
      failed: 0,
      replied: 1,
      skipped: 0,
    })
    assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
    const prompt =
      runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]?.userPrompt
    assert.match(prompt ?? '', /Remember eggs and yogurt\./u)
    assert.match(prompt ?? '', /Attachment context:/u)

    phase = 'echo'
    const second = await scanAssistantAutoReplyOnce({
      afterCursor: stateProgress[0]?.cursor ?? null,
      autoReplyPrimed: true,
      allowSelfAuthored: true,
      enabledChannels: ['imessage'],
      inboxServices,
      vault: vaultRoot,
      async onStateProgress(next) {
        stateProgress.push(next)
      },
    })

    assert.deepEqual(second, {
      considered: 1,
      failed: 0,
      replied: 0,
      skipped: 1,
    })
    assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)

    const sessionId = JSON.parse(
      await readFile(
        path.join(
          vaultRoot,
          'derived',
          'inbox',
          'cap-self',
          'assistant',
          'chat-result.json',
        ),
        'utf8',
      ),
    ).sessionId as string
    const transcript = await listAssistantTranscriptEntries(vaultRoot, sessionId)
    assert.equal(
      transcript.some(
        (entry) => entry.kind === 'assistant' && entry.text === 'auto reply',
      ),
      true,
    )
  } finally {
    vi.useRealTimers()
  }
})

test('scanAssistantAutoReplyOnce keeps the cursor on prompt defers but advances it on prompt skips', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-auto-reply-cursor-policy-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  let phase: 'defer' | 'skip' = 'defer'
  const events: Array<{ type: string; captureId?: string; details?: string }> = []
  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []

  const inboxServices = {
    async list() {
      if (phase === 'defer') {
        return {
          items: [
            {
              captureId: 'cap-defer',
              source: 'imessage',
              accountId: 'self',
              externalId: 'ext-defer',
              threadId: 'chat-defer',
              threadTitle: null,
              actorId: '+15550001111',
              actorName: 'Defer User',
              actorIsSelf: false,
              occurredAt: '2026-03-18T09:00:00Z',
              receivedAt: null,
              text: 'Need parsing first',
              attachmentCount: 1,
              envelopePath: 'raw/inbox/defer.json',
              eventId: 'evt-defer',
              promotions: [],
            },
          ],
        }
      }

      return {
        items: [
          {
            captureId: 'cap-skip',
            source: 'imessage',
            accountId: 'self',
            externalId: 'ext-skip',
            threadId: 'chat-skip',
            threadTitle: null,
            actorId: '+15550002222',
            actorName: 'Skip User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:01:00Z',
            receivedAt: null,
            text: null,
            attachmentCount: 1,
            envelopePath: 'raw/inbox/skip.json',
            eventId: 'evt-skip',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      if (phase === 'defer') {
        assert.equal(input.captureId, 'cap-defer')
        return {
          capture: {
            captureId: 'cap-defer',
            source: 'imessage',
            threadTitle: null,
            threadId: 'chat-defer',
            threadIsDirect: true,
            actorId: '+15550001111',
            actorName: 'Defer User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            text: 'Need parsing first',
            attachments: [
              {
                ordinal: 1,
                kind: 'image',
                fileName: 'meal.jpg',
                transcriptText: null,
                extractedText: null,
                parseState: 'pending',
              },
            ],
          },
        }
      }

      assert.equal(input.captureId, 'cap-skip')
      return {
        capture: {
          captureId: 'cap-skip',
          source: 'imessage',
          threadTitle: null,
          threadId: 'chat-skip',
          threadIsDirect: true,
          actorId: '+15550002222',
          actorName: 'Skip User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:01:00Z',
          text: null,
          attachments: [
            {
              ordinal: 1,
              kind: 'image',
              fileName: 'blank.jpg',
              transcriptText: null,
              extractedText: null,
              parseState: 'succeeded',
            },
          ],
        },
      }
    },
  } as any

  const first = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  phase = 'skip'

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['imessage'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.deepEqual(second, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 0)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 0)
  assert.deepEqual(stateProgress, [
    {
      cursor: null,
      primed: true,
    },
    {
      cursor: {
        occurredAt: '2026-03-18T09:01:00Z',
        captureId: 'cap-skip',
      },
      primed: true,
    },
  ])
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-defer' &&
        event.details === 'waiting for parser completion',
    ),
    true,
  )
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-skip' &&
        event.details === 'capture has no text or parsed attachment content',
    ),
    true,
  )
})

test('scanAssistantAutoReplyOnce only auto-replies to Telegram direct chats', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-telegram-scope-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-telegram-scope',
    response: 'direct reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    vault: path.resolve(input.vault),
    message: input.message,
    session: {
      schema: 'healthybob.assistant-session.v2',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-scope',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:telegram|thread:123',
        channel: 'telegram',
        identityId: null,
        actorId: input.actorId ?? null,
        threadId: input.threadId,
        threadIsDirect: input.threadIsDirect,
        delivery: {
          kind: 'thread',
          target: input.threadId,
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'telegram',
      target: input.threadId,
      targetKind: 'thread',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-group',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '-1001',
            threadTitle: 'Group',
            actorId: '111',
            actorName: 'Group Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'hello group',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/group.json',
            eventId: 'evt-group',
            promotions: [],
          },
          {
            captureId: 'cap-direct',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:2',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '222',
            actorName: 'Direct Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:01:00Z',
            receivedAt: null,
            text: 'hello direct',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/direct.json',
            eventId: 'evt-direct',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      if (input.captureId === 'cap-group') {
        return {
          capture: {
            captureId: 'cap-group',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '-1001',
            threadTitle: 'Group',
            threadIsDirect: false,
            actorId: '111',
            actorName: 'Group Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'hello group',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/group.json',
            eventId: 'evt-group',
            createdAt: '2026-03-18T09:00:00Z',
            promotions: [],
            attachments: [],
          },
        }
      }

      return {
        capture: {
          captureId: 'cap-direct',
          source: 'telegram',
          accountId: 'bot',
          externalId: 'update:2',
          threadId: '123',
          threadTitle: 'Direct',
          threadIsDirect: true,
          actorId: '222',
          actorName: 'Direct Bob',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:01:00Z',
          receivedAt: null,
          text: 'hello direct',
          attachmentCount: 0,
          envelopePath: 'raw/inbox/direct.json',
          eventId: 'evt-direct',
          createdAt: '2026-03-18T09:01:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 2,
    failed: 0,
    replied: 1,
    skipped: 1,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(
    runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]?.userPrompt.includes('hello direct'),
    true,
  )
})

test('scanAssistantAutoReplyOnce defers reconnectable provider failures and preserves the resumable session without duplicating transcript turns', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-auto-reply-reconnect-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockRejectedValue(
    new VaultCliError(
      'ASSISTANT_CODEX_CONNECTION_LOST',
      'Codex CLI lost its connection while waiting for the model.',
      {
        connectionLost: true,
        providerSessionId: 'thread-retry-1',
        retryable: true,
      },
    ),
  )

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []
  const events: Array<{ type: string; captureId?: string; details?: string }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-retry',
            source: 'telegram',
            accountId: 'self',
            externalId: 'ext-retry',
            threadId: 'thread-retry',
            threadTitle: 'Retry chat',
            actorId: 'telegram:123',
            actorName: 'Retry User',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:10:00Z',
            receivedAt: null,
            text: 'Can you follow up?',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/retry.json',
            eventId: 'evt-retry',
            promotions: [],
          },
        ],
      }
    },
    async show() {
      return {
        capture: {
          captureId: 'cap-retry',
          source: 'telegram',
          accountId: 'self',
          externalId: 'ext-retry',
          threadId: 'thread-retry',
          threadTitle: 'Retry chat',
          threadIsDirect: true,
          actorId: 'telegram:123',
          actorName: 'Retry User',
          actorIsSelf: false,
          occurredAt: '2026-03-18T09:10:00Z',
          receivedAt: null,
          text: 'Can you follow up?',
          attachmentCount: 0,
          envelopePath: 'raw/inbox/retry.json',
          eventId: 'evt-retry',
          createdAt: '2026-03-18T09:10:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  const first = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    onEvent(event) {
      events.push(event)
    },
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  const second = await scanAssistantAutoReplyOnce({
    afterCursor: stateProgress[0]?.cursor ?? null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
    vault: vaultRoot,
  })

  assert.deepEqual(first, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.deepEqual(second, {
    considered: 1,
    failed: 0,
    replied: 0,
    skipped: 1,
  })
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 0)
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.deepEqual(stateProgress[0], {
    cursor: null,
    primed: true,
  })
  assert.deepEqual(stateProgress[1], {
    cursor: null,
    primed: true,
  })
  assert.equal(
    events.some(
      (event) =>
        event.type === 'capture.reply-skipped' &&
        event.captureId === 'cap-retry' &&
        event.details?.includes('Will retry this capture after the provider reconnects.'),
    ),
    true,
  )

  const resolved = await resolveAssistantSession({
    vault: vaultRoot,
    channel: 'telegram',
    actorId: 'telegram:123',
    threadId: 'thread-retry',
    threadIsDirect: true,
    provider: 'codex-cli',
    model: null,
    sandbox: 'workspace-write',
    approvalPolicy: 'on-request',
    oss: false,
    profile: null,
    reasoningEffort: null,
    maxSessionAgeMs: null,
  })

  assert.equal(resolved.session.providerSessionId, 'thread-retry-1')
  assert.equal(resolved.session.turnCount, 0)
  assert.deepEqual(
    await listAssistantTranscriptEntries(vaultRoot, resolved.session.sessionId),
    [],
  )
})

test('scanAssistantAutoReplyOnce keeps scanning after a failed Telegram delivery and records the failure artifact', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-telegram-failure-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-failure',
      response: 'first reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-failure',
      response: 'second reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
  runtimeMocks.deliverAssistantMessageOverBinding
    .mockRejectedValueOnce(new Error('Telegram delivery failed'))
    .mockImplementationOnce(async (input: any) => ({
      vault: path.resolve(input.vault),
      message: input.message,
      session: {
        schema: 'healthybob.assistant-session.v2',
        sessionId: input.sessionId,
        provider: 'codex-cli',
        providerSessionId: 'thread-telegram-failure',
        providerOptions: {
          model: null,
          reasoningEffort: null,
          sandbox: 'read-only',
          approvalPolicy: 'never',
          profile: null,
          oss: false,
        },
        alias: null,
        binding: {
          conversationKey: `channel:telegram|thread:${input.threadId}`,
          channel: 'telegram',
          identityId: null,
          actorId: input.actorId ?? null,
          threadId: input.threadId,
          threadIsDirect: input.threadIsDirect,
          delivery: {
            kind: 'thread',
            target: input.threadId,
          },
        },
        createdAt: '2026-03-18T00:00:00.000Z',
        updatedAt: '2026-03-18T00:00:01.000Z',
        lastTurnAt: '2026-03-18T00:00:01.000Z',
        turnCount: 1,
      },
      delivery: {
        channel: 'telegram',
        target: input.threadId,
        targetKind: 'thread',
        sentAt: '2026-03-18T00:00:01.000Z',
        messageLength: input.message.length,
      },
    }))

  const stateProgress: Array<{
    cursor: { occurredAt: string; captureId: string } | null
    primed: boolean
  }> = []

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-fail',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'first question',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/fail.json',
            eventId: 'evt-fail',
            promotions: [],
          },
          {
            captureId: 'cap-pass',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:2',
            threadId: '456',
            threadTitle: 'Direct',
            actorId: '222',
            actorName: 'Alice',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:01:00Z',
            receivedAt: null,
            text: 'second question',
            attachmentCount: 0,
            envelopePath: 'raw/inbox/pass.json',
            eventId: 'evt-pass',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      const directThreadId = input.captureId === 'cap-fail' ? '123' : '456'
      const actorId = input.captureId === 'cap-fail' ? '111' : '222'
      const actorName = input.captureId === 'cap-fail' ? 'Bob' : 'Alice'
      const text = input.captureId === 'cap-fail' ? 'first question' : 'second question'
      const captureId = input.captureId

      return {
        capture: {
          captureId,
          source: 'telegram',
          accountId: 'bot',
          externalId: captureId === 'cap-fail' ? 'update:1' : 'update:2',
          threadId: directThreadId,
          threadTitle: 'Direct',
          threadIsDirect: true,
          actorId,
          actorName,
          actorIsSelf: false,
          occurredAt: captureId === 'cap-fail' ? '2026-03-18T09:00:00Z' : '2026-03-18T09:01:00Z',
          receivedAt: null,
          text,
          attachmentCount: 0,
          envelopePath: captureId === 'cap-fail' ? 'raw/inbox/fail.json' : 'raw/inbox/pass.json',
          eventId: captureId === 'cap-fail' ? 'evt-fail' : 'evt-pass',
          createdAt: captureId === 'cap-fail' ? '2026-03-18T09:00:00Z' : '2026-03-18T09:01:00Z',
          promotions: [],
          attachments: [],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    vault: vaultRoot,
    async onStateProgress(next) {
      stateProgress.push(next)
    },
  })

  assert.deepEqual(result, {
    considered: 2,
    failed: 1,
    replied: 1,
    skipped: 0,
  })
  assert.deepEqual(stateProgress.at(-1), {
    cursor: {
      occurredAt: '2026-03-18T09:01:00Z',
      captureId: 'cap-pass',
    },
    primed: true,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 2)

  const errorArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-fail',
        'assistant',
        'chat-error.json',
      ),
      'utf8',
    ),
  )
  assert.equal(errorArtifact.schema, 'healthybob.assistant-chat-error.v1')

  const successArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-pass',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  assert.equal(successArtifact.captureId, 'cap-pass')
})

test('scanAssistantAutoReplyOnce groups Telegram media albums into one assistant reply', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-telegram-album-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(path.join(vaultRoot, 'raw', 'inbox'), {
    recursive: true,
  })
  cleanupPaths.push(parent)

  await writeFile(
    path.join(vaultRoot, 'raw', 'inbox', 'album-1.json'),
    JSON.stringify({
      input: {
        raw: {
          message: {
            media_group_id: 'album-7',
          },
        },
      },
    }),
    'utf8',
  )
  await writeFile(
    path.join(vaultRoot, 'raw', 'inbox', 'album-2.json'),
    JSON.stringify({
      input: {
        raw: {
          message: {
            media_group_id: 'album-7',
          },
        },
      },
    }),
    'utf8',
  )

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-telegram-album',
    response: 'album reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })
  runtimeMocks.deliverAssistantMessageOverBinding.mockImplementation(async (input: any) => ({
    vault: path.resolve(input.vault),
    message: input.message,
    session: {
      schema: 'healthybob.assistant-session.v2',
      sessionId: input.sessionId,
      provider: 'codex-cli',
      providerSessionId: 'thread-telegram-album',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: 'channel:telegram|thread:123',
        channel: 'telegram',
        identityId: null,
        actorId: '111',
        threadId: '123',
        threadIsDirect: true,
        delivery: {
          kind: 'thread',
          target: '123',
        },
      },
      createdAt: '2026-03-18T00:00:00.000Z',
      updatedAt: '2026-03-18T00:00:01.000Z',
      lastTurnAt: '2026-03-18T00:00:01.000Z',
      turnCount: 1,
    },
    delivery: {
      channel: 'telegram',
      target: '123',
      targetKind: 'thread',
      sentAt: '2026-03-18T00:00:01.000Z',
      messageLength: input.message.length,
    },
  }))

  const inboxServices = {
    async list() {
      return {
        items: [
          {
            captureId: 'cap-album-1',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:1',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:00Z',
            receivedAt: null,
            text: 'photo set',
            attachmentCount: 1,
            envelopePath: 'raw/inbox/album-1.json',
            eventId: 'evt-album-1',
            promotions: [],
          },
          {
            captureId: 'cap-album-2',
            source: 'telegram',
            accountId: 'bot',
            externalId: 'update:2',
            threadId: '123',
            threadTitle: 'Direct',
            actorId: '111',
            actorName: 'Bob',
            actorIsSelf: false,
            occurredAt: '2026-03-18T09:00:01Z',
            receivedAt: null,
            text: null,
            attachmentCount: 1,
            envelopePath: 'raw/inbox/album-2.json',
            eventId: 'evt-album-2',
            promotions: [],
          },
        ],
      }
    },
    async show(input: any) {
      const first = input.captureId === 'cap-album-1'
      return {
        capture: {
          captureId: input.captureId,
          source: 'telegram',
          accountId: 'bot',
          externalId: first ? 'update:1' : 'update:2',
          threadId: '123',
          threadTitle: 'Direct',
          threadIsDirect: true,
          actorId: '111',
          actorName: 'Bob',
          actorIsSelf: false,
          occurredAt: first ? '2026-03-18T09:00:00Z' : '2026-03-18T09:00:01Z',
          receivedAt: null,
          text: first ? 'photo set' : null,
          attachmentCount: 1,
          envelopePath: first ? 'raw/inbox/album-1.json' : 'raw/inbox/album-2.json',
          eventId: first ? 'evt-album-1' : 'evt-album-2',
          createdAt: first ? '2026-03-18T09:00:00Z' : '2026-03-18T09:00:01Z',
          promotions: [],
          attachments: [
            {
              ordinal: 1,
              kind: 'image',
              fileName: first ? 'meal-1.jpg' : 'meal-2.jpg',
              transcriptText: null,
              extractedText: first ? 'plate one' : 'plate two',
              parseState: 'succeeded',
            },
          ],
        },
      }
    },
  } as any

  const result = await scanAssistantAutoReplyOnce({
    afterCursor: null,
    autoReplyPrimed: true,
    enabledChannels: ['telegram'],
    inboxServices,
    vault: vaultRoot,
  })

  assert.deepEqual(result, {
    considered: 2,
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(runtimeMocks.deliverAssistantMessageOverBinding.mock.calls.length, 1)

  const firstArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-album-1',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  const secondArtifact = JSON.parse(
    await readFile(
      path.join(
        vaultRoot,
        'derived',
        'inbox',
        'cap-album-2',
        'assistant',
        'chat-result.json',
      ),
      'utf8',
    ),
  )
  assert.deepEqual(firstArtifact.groupCaptureIds, ['cap-album-1', 'cap-album-2'])
  assert.deepEqual(secondArtifact.groupCaptureIds, ['cap-album-1', 'cap-album-2'])
})

test('runAssistantAutomation reports daemon failures as error results', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-daemon-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const assistantEvents: Array<{ type: string; details?: string }> = []
  const inboxEvents: Array<{ type: string; connectorId?: string; source?: string }> = []

  const result = await runAssistantAutomation({
    vault: vaultRoot,
    once: false,
    scanIntervalMs: 5,
    modelSpec: {
      model: 'gpt-oss:20b',
    },
    inboxServices: {
      list: async () => ({
        items: [],
      }),
      run: async (_input: unknown, options?: { onEvent?: (event: unknown) => void }) => {
        options?.onEvent?.({
          type: 'connector.watch.started',
          connectorId: 'imessage:self',
          source: 'imessage',
        })
        throw new Error('daemon exploded')
      },
    } as any,
    onEvent(event) {
      assistantEvents.push(event)
    },
    onInboxEvent(event) {
      inboxEvents.push(event)
    },
  })

  assert.equal(result.reason, 'error')
  assert.equal(result.daemonStarted, true)
  assert.equal(result.lastError, 'daemon exploded')
  assert.equal(result.scans, 1)
  assert.equal(result.replyConsidered, 0)
  assert.equal(result.replied, 0)
  assert.equal(result.replySkipped, 0)
  assert.equal(result.replyFailed, 0)
  assert.equal(
    inboxEvents.some(
      (event) =>
        event.type === 'connector.watch.started' &&
        event.connectorId === 'imessage:self' &&
        event.source === 'imessage',
    ),
    true,
  )
  assert.equal(
    assistantEvents.some(
      (event) => event.type === 'daemon.failed' && event.details === 'daemon exploded',
    ),
    true,
  )
})

test('bridgeAbortSignals forces process exit after local SIGINT grace when teardown hangs', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const exitCodes: number[] = []
  const cleanup = bridgeAbortSignals(controller, undefined, {
    exitProcess(code) {
      exitCodes.push(code)
    },
    forceExitGraceMs: 25,
  })

  try {
    process.emit('SIGINT')
    assert.equal(controller.signal.aborted, true)
    assert.deepEqual(exitCodes, [])

    await vi.advanceTimersByTimeAsync(25)
    assert.deepEqual(exitCodes, [130])
  } finally {
    cleanup()
    vi.useRealTimers()
  }
})

test('bridgeAbortSignals cancels forced exit when teardown completes inside the grace period', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const exitCodes: number[] = []
  const cleanup = bridgeAbortSignals(controller, undefined, {
    exitProcess(code) {
      exitCodes.push(code)
    },
    forceExitGraceMs: 25,
  })

  try {
    process.emit('SIGINT')
    assert.equal(controller.signal.aborted, true)

    cleanup()
    await vi.advanceTimersByTimeAsync(25)
    assert.deepEqual(exitCodes, [])
  } finally {
    vi.useRealTimers()
  }
})

test('bridgeAbortSignals keeps upstream aborts non-fatal', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const upstream = new AbortController()
  const exitCodes: number[] = []
  const cleanup = bridgeAbortSignals(controller, upstream.signal, {
    exitProcess(code) {
      exitCodes.push(code)
    },
    forceExitGraceMs: 25,
  })

  try {
    upstream.abort()
    assert.equal(controller.signal.aborted, true)

    await vi.advanceTimersByTimeAsync(25)
    assert.deepEqual(exitCodes, [])
  } finally {
    cleanup()
    vi.useRealTimers()
  }
})

test('runAssistantChat delegates to the Ink UI implementation', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-chat-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.runAssistantChatWithInk.mockResolvedValue({
    vault: vaultRoot,
    startedAt: '2026-03-17T00:00:00.000Z',
    stoppedAt: '2026-03-17T00:00:01.000Z',
    turns: 2,
    session: {
      schema: 'healthybob.assistant-session.v2',
      sessionId: 'asst_123',
      provider: 'codex-cli',
      providerSessionId: 'thread-ink',
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        profile: null,
        oss: false,
      },
      alias: 'chat:bob',
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
      updatedAt: '2026-03-17T00:00:01.000Z',
      lastTurnAt: '2026-03-17T00:00:01.000Z',
      turnCount: 2,
    },
  })

  const result = await runAssistantChat({
    vault: vaultRoot,
    alias: 'chat:bob',
    initialPrompt: 'hello',
  })

  assert.equal(result.session.sessionId, 'asst_123')
  assert.equal(result.turns, 2)
  assert.deepEqual(runtimeMocks.runAssistantChatWithInk.mock.calls, [
    [
      {
        vault: vaultRoot,
        alias: 'chat:bob',
        initialPrompt: 'hello',
      },
    ],
  ])
})

test('runAssistantChat surfaces Ink chat errors to the caller', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-chat-error-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.runAssistantChatWithInk.mockRejectedValue(new Error('ink exploded'))

  await assert.rejects(
    runAssistantChat({
      vault: vaultRoot,
    }),
    /ink exploded/u,
  )
})

test('assistant Ink view-model replays persisted local transcript entries', () => {
  const entries = seedChatEntries([
    {
      schema: 'healthybob.assistant-transcript-entry.v1',
      kind: 'user',
      text: 'hello',
      createdAt: '2026-03-17T00:00:00.000Z',
    },
    {
      schema: 'healthybob.assistant-transcript-entry.v1',
      kind: 'assistant',
      text: 'hi',
      createdAt: '2026-03-17T00:00:01.000Z',
    },
    {
      schema: 'healthybob.assistant-transcript-entry.v1',
      kind: 'error',
      text: 'boom',
      createdAt: '2026-03-17T00:00:02.000Z',
    },
  ])

  assert.deepEqual(entries, [
    {
      kind: 'user',
      text: 'hello',
    },
    {
      kind: 'assistant',
      text: 'hi',
    },
    {
      kind: 'error',
      text: 'boom',
    },
  ])
})


test('assistant Ink view-model merges streaming trace updates by stream key', () => {
  const entries = applyInkChatTraceUpdates(
    [
      {
        kind: 'user',
        text: 'hello',
      },
    ],
    [
      {
        kind: 'thinking',
        mode: 'append',
        streamKey: 'turn-1:thinking:main',
        text: 'Checking files',
      },
      {
        kind: 'thinking',
        mode: 'append',
        streamKey: 'turn-1:thinking:main',
        text: '…',
      },
      {
        kind: 'assistant',
        mode: 'replace',
        streamKey: 'turn-1:assistant:main',
        text: 'Hi there.',
      },
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'turn-1:status:connection',
        text: 'Reconnecting…',
      },
      {
        kind: 'status',
        mode: 'replace',
        streamKey: 'turn-1:status:connection',
        text: 'Reconnected.',
      },
    ],
  )

  assert.deepEqual(entries, [
    {
      kind: 'user',
      text: 'hello',
    },
    {
      kind: 'thinking',
      streamKey: 'turn-1:thinking:main',
      text: 'Checking files…',
    },
    {
      kind: 'assistant',
      streamKey: 'turn-1:assistant:main',
      text: 'Hi there.',
    },
    {
      kind: 'status',
      streamKey: 'turn-1:status:connection',
      text: 'Reconnected.',
    },
  ])
})

test('assistant Ink view-model upserts provider progress rows and ignores final message events', () => {
  const started = applyProviderProgressEventToEntries({
    entries: [],
    event: {
      id: 'turn-1:reason-1',
      kind: 'reasoning',
      state: 'running',
      text: 'Thinking…',
      rawEvent: {
        type: 'item.started',
      },
    },
  })

  assert.deepEqual(started, [
    {
      kind: 'trace',
      pending: true,
      text: 'Thinking…',
      traceId: 'turn-1:reason-1',
      traceKind: 'reasoning',
    },
  ])

  const completed = applyProviderProgressEventToEntries({
    entries: started,
    event: {
      id: 'turn-1:reason-1',
      kind: 'reasoning',
      state: 'completed',
      text: 'Thought through the next step.',
      rawEvent: {
        type: 'item.completed',
      },
    },
  })

  assert.deepEqual(completed, [
    {
      kind: 'trace',
      pending: false,
      text: 'Thought through the next step.',
      traceId: 'turn-1:reason-1',
      traceKind: 'reasoning',
    },
  ])

  assert.deepEqual(
    applyProviderProgressEventToEntries({
      entries: completed,
      event: {
        id: 'turn-1:msg-1',
        kind: 'message',
        state: 'completed',
        text: 'final answer',
        rawEvent: {
          type: 'item.completed',
        },
      },
    }),
    completed,
  )
})

test('assistant Ink view-model preserves prior progress rows when later turns use the same raw provider item ids', () => {
  const firstTurn = applyProviderProgressEventToEntries({
    entries: [],
    event: {
      id: 'turn-1:codex-connection-status',
      kind: 'status',
      state: 'running',
      text: 'Re-connecting...',
      rawEvent: {
        type: 'stderr',
      },
    },
  })

  const secondTurn = applyProviderProgressEventToEntries({
    entries: firstTurn,
    event: {
      id: 'turn-2:codex-connection-status',
      kind: 'status',
      state: 'completed',
      text: 'Exceeded retry limit.',
      rawEvent: {
        type: 'stderr',
      },
    },
  })

  assert.deepEqual(secondTurn, [
    {
      kind: 'trace',
      pending: true,
      text: 'Re-connecting...',
      traceId: 'turn-1:codex-connection-status',
      traceKind: 'status',
    },
    {
      kind: 'trace',
      pending: false,
      text: 'Exceeded retry limit.',
      traceId: 'turn-2:codex-connection-status',
      traceKind: 'status',
    },
  ])
})

test('assistant Ink view-model exposes codex-style footer metadata and busy copy', () => {
  const session = {
    schema: 'healthybob.assistant-session.v2',
    sessionId: 'asst_demo',
    provider: 'codex-cli',
    providerSessionId: null,
    providerOptions: {
      model: 'gpt-5.4',
      reasoningEffort: null,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: null,
      oss: false,
    },
    alias: null,
    binding: {
      conversationKey: null,
      channel: 'imessage',
      identityId: null,
      actorId: 'contact:bob',
      threadId: 'thread-123',
      threadIsDirect: null,
      delivery: null,
    },
    createdAt: '2026-03-17T00:00:00.000Z',
    updatedAt: '2026-03-17T00:00:00.000Z',
    lastTurnAt: null,
    turnCount: 0,
  } as const

  assert.equal(
    CHAT_BANNER,
    'Local-first chat backed by transcript history and resumable provider sessions when available.',
  )
  assert.equal(
    CHAT_COMPOSER_HINT,
    'Enter send · Tab queue when busy · Shift+Enter newline · Esc pause · /model switch model · /session show session · /exit quit',
  )
  assert.deepEqual(CHAT_STARTER_SUGGESTIONS, [
    'Summarize recent sleep and recovery',
    'Review meal and workout patterns',
    'Find recent health anomalies',
  ])
  assert.equal(shouldShowChatComposerGuidance(0), true)
  assert.equal(shouldShowChatComposerGuidance(1), false)
  assert.equal(resolveMessageRoleLabel('assistant'), null)
  assert.equal(resolveMessageRoleLabel('error'), 'error')
  assert.equal(resolveMessageRoleLabel('user'), null)

  const plainPanel = resolveChromePanelBoxProps({})
  const tintedPanel = resolveChromePanelBoxProps({
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    marginBottom: 0,
    paddingY: 1,
  })
  const fixedWidthPanel = resolveChromePanelBoxProps({
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    width: 78,
  })

  assert.equal('borderColor' in plainPanel, false)
  assert.equal('borderStyle' in plainPanel, false)
  assert.equal(resolveAssistantChatViewportWidth(80), 78)
  assert.equal(resolveAssistantChatViewportWidth(2), 1)
  assert.equal(resolveAssistantPlainTextWrapColumns(80), 77)
  assert.equal(resolveAssistantPlainTextWrapColumns(2), 1)
  assert.deepEqual(plainPanel, {
    flexDirection: 'column',
    marginBottom: 1,
    paddingX: 0,
    paddingY: 0,
    width: '100%',
  })
  assert.deepEqual(tintedPanel, {
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    flexDirection: 'column',
    marginBottom: 0,
    paddingX: 1,
    paddingY: 1,
    width: '100%',
  })
  assert.deepEqual(fixedWidthPanel, {
    backgroundColor: LIGHT_ASSISTANT_INK_THEME.switcherBackground,
    flexDirection: 'column',
    marginBottom: 1,
    paddingX: 1,
    paddingY: 0,
    width: 78,
  })

  assert.equal(
    formatFooterBadgeText({
      key: 'model',
      label: 'model',
      value: 'gpt-5.4',
    }),
    ' gpt-5.4 ',
  )
  assert.equal(
    formatFooterBadgeText({
      key: 'reasoning',
      label: 'reasoning',
      value: 'high',
    }),
    ' high ',
  )
  assert.equal(
    formatFooterBadgeText({
      key: 'vault',
      label: 'vault',
      value: '~/vault',
    }),
    ' vault: ~/vault ',
  )
  assert.equal(CHAT_MODEL_OPTIONS[0]?.value, 'gpt-5.4')
  assert.equal(CHAT_REASONING_OPTIONS[3]?.value, 'xhigh')
  assert.equal(CHAT_SLASH_COMMANDS[0]?.command, '/model')
  assert.equal(findAssistantModelOptionIndex('gpt-5.3-codex'), 2)
  assert.equal(findAssistantReasoningOptionIndex('xhigh'), 3)
  assert.equal(findAssistantReasoningOptionIndex(null), 1)
  assert.deepEqual(
    getMatchingSlashCommands('/m').map((command) => command.command),
    ['/model'],
  )
  assert.equal(getMatchingSlashCommands('hello').length, 0)
  assert.equal(formatElapsedClock(0), '0:00')
  assert.equal(formatElapsedClock(73), '1:13')
  assert.equal(formatBusyStatus(0), 'Working · 0:00')
  assert.equal(formatBusyStatus(13), 'Working · 0:13')
  assert.equal(
    formatChatMetadata(
      {
        provider: session.provider,
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      '~/vault',
    ),
    'gpt-5.4 xhigh · ~/vault',
  )
  assert.deepEqual(
    resolveChatMetadataBadges(
      {
        provider: session.provider,
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      '~/vault',
    ),
    [
      {
        key: 'model',
        label: 'model',
        value: 'gpt-5.4',
      },
      {
        key: 'reasoning',
        label: 'reasoning',
        value: 'xhigh',
      },
      {
        key: 'vault',
        label: 'vault',
        value: '~/vault',
      },
    ],
  )
  assert.equal(
    formatSessionBinding(session),
    'imessage · contact:bob · thread-123',
  )
})

test('assistant Ink raw-mode support helper only accepts TTY streams with setRawMode', () => {
  assert.equal(
    supportsAssistantInkRawMode({
      isTTY: true,
      setRawMode: () => {},
    } as unknown as NodeJS.ReadStream),
    true,
  )
  assert.equal(
    supportsAssistantInkRawMode({
      isTTY: true,
    } as unknown as NodeJS.ReadStream),
    false,
  )
  assert.equal(
    supportsAssistantInkRawMode({
      isTTY: false,
      setRawMode: () => {},
    } as unknown as NodeJS.ReadStream),
    false,
  )
})

test('assistant Ink input adapter reuses process stdin when raw mode is supported', () => {
  const stdin = {
    isTTY: true,
    setRawMode: () => {},
  } as unknown as NodeJS.ReadStream

  const adapter = resolveAssistantInkInputAdapter({
    stdin,
  })

  assert.equal(adapter.source, 'stdin')
  assert.equal(adapter.stdin, stdin)
})

test('assistant Ink input adapter falls back to the controlling terminal when needed', () => {
  const destroyTtyInput = vi.fn()
  const ttyInput = {
    destroy: destroyTtyInput,
    isTTY: true,
    setRawMode: () => {},
  } as unknown as NodeJS.ReadStream
  const openTtyFd = vi.fn(() => 42)
  const createTtyReadStream = vi.fn(() => ttyInput)

  const adapter = resolveAssistantInkInputAdapter({
    createTtyReadStream,
    openTtyFd,
    stdin: {
      isTTY: false,
    } as unknown as NodeJS.ReadStream,
    ttyPath: '/dev/test-tty',
  })

  assert.equal(adapter.source, 'tty')
  assert.equal(adapter.stdin, ttyInput)
  assert.deepEqual(openTtyFd.mock.calls, [['/dev/test-tty', 'r']])
  assert.deepEqual(createTtyReadStream.mock.calls, [[42]])
  adapter.close()
  assert.equal(destroyTtyInput.mock.calls.length, 1)
})

test('assistant Ink view-model resolves composer submit actions and clear behavior', () => {
  assert.deepEqual(resolveChatSubmitAction('   ', false), {
    kind: 'ignore',
  })
  assert.deepEqual(resolveChatSubmitAction('hello', true), {
    kind: 'ignore',
  })
  assert.deepEqual(
    resolveChatSubmitAction('hello', {
      busy: true,
      trigger: 'tab',
    }),
    {
      kind: 'queue',
      prompt: 'hello',
    },
  )
  assert.deepEqual(
    resolveChatSubmitAction('/model', {
      busy: true,
      trigger: 'tab',
    }),
    {
      kind: 'ignore',
    },
  )
  assert.deepEqual(resolveChatSubmitAction('/quit', false), {
    kind: 'exit',
  })
  assert.deepEqual(resolveChatSubmitAction('/session', false), {
    kind: 'session',
  })

  const modelAction = resolveChatSubmitAction('/model', false)
  const promptAction = resolveChatSubmitAction('  hello Bob  ', false)
  const queueAction = resolveChatSubmitAction('  hello Bob  ', {
    busy: true,
    trigger: 'tab',
  })

  assert.deepEqual(modelAction, {
    kind: 'model',
  })
  assert.equal(shouldClearComposerForSubmitAction(modelAction), true)
  assert.deepEqual(promptAction, {
    kind: 'prompt',
    prompt: 'hello Bob',
  })
  assert.equal(shouldClearComposerForSubmitAction(promptAction), true)
  assert.deepEqual(queueAction, {
    kind: 'queue',
    prompt: 'hello Bob',
  })
  assert.equal(shouldClearComposerForSubmitAction(queueAction), true)
  assert.equal(
    shouldClearComposerForSubmitAction(resolveChatSubmitAction('/session', false)),
    false,
  )
})

test('assistant Ink merges queued follow-ups back into the composer draft with blank lines', () => {
  assert.equal(mergeComposerDraftWithQueuedPrompts('', []), '')
  assert.equal(
    mergeComposerDraftWithQueuedPrompts('', ['first follow-up', 'second follow-up']),
    'first follow-up\n\nsecond follow-up',
  )
  assert.equal(
    mergeComposerDraftWithQueuedPrompts('existing draft', ['queued follow-up']),
    'existing draft\n\nqueued follow-up',
  )
})

test('assistant Ink view-model falls back to default model labels when needed', () => {
  const ossSession = {
    schema: 'healthybob.assistant-session.v2',
    sessionId: 'asst_demo',
    provider: 'codex-cli',
    providerSessionId: null,
    providerOptions: {
      model: null,
      reasoningEffort: null,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: null,
      oss: true,
    },
    alias: null,
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
    turnCount: 0,
  } as const

  const defaultSession = {
    ...ossSession,
    providerOptions: {
      ...ossSession.providerOptions,
      oss: false,
    },
  } as const

  assert.equal(
    formatChatMetadata(
      {
        provider: ossSession.provider,
        model: null,
        reasoningEffort: 'high',
      },
      '~/vault',
    ),
    'codex-cli high · ~/vault',
  )
  assert.equal(
    formatChatMetadata(
      {
        provider: defaultSession.provider,
        model: null,
        reasoningEffort: null,
      },
      '~/vault',
    ),
    'codex-cli · ~/vault',
  )
  assert.equal(formatSessionBinding(defaultSession), null)
})

test('assistant Ink composer editing supports line kills and yank', () => {
  const afterKillEnd = applyComposerEditingInput(
    {
      cursorOffset: 5,
      killBuffer: '',
      value: 'hello there',
    },
    'k',
    createComposerKey({
      ctrl: true,
    }),
  )

  assert.deepEqual(afterKillEnd, {
    cursorOffset: 5,
    handled: true,
    killBuffer: ' there',
    value: 'hello',
  })

  const afterYank = applyComposerEditingInput(
    afterKillEnd,
    'y',
    createComposerKey({
      ctrl: true,
    }),
  )

  assert.deepEqual(afterYank, {
    cursorOffset: 11,
    handled: true,
    killBuffer: ' there',
    value: 'hello there',
  })

  const afterKillStart = applyComposerEditingInput(
    {
      cursorOffset: 5,
      killBuffer: '',
      value: 'hello there',
    },
    'u',
    createComposerKey({
      ctrl: true,
    }),
  )

  assert.deepEqual(afterKillStart, {
    cursorOffset: 0,
    handled: true,
    killBuffer: 'hello',
    value: ' there',
  })
})

test('assistant Ink composer editing supports word movement and word deletion', () => {
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 16,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      '',
      createComposerKey({
        leftArrow: true,
        meta: true,
      }),
    ),
    {
      cursorOffset: 11,
      handled: true,
      killBuffer: '',
      value: 'alpha beta gamma',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      '',
      createComposerKey({
        rightArrow: true,
        ctrl: true,
      }),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'alpha beta gamma',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 10,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      '',
      createComposerKey({
        backspace: true,
        meta: true,
      }),
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: 'beta',
      value: 'alpha  gamma',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 6,
        killBuffer: '',
        value: 'alpha beta gamma',
      },
      'd',
      createComposerKey({
        meta: true,
      }),
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: 'beta',
      value: 'alpha  gamma',
    },
  )
})

test('assistant Ink composer editing supports forward delete and best-effort super shortcuts', () => {
  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        delete: true,
      }),
    ),
    {
      cursorOffset: 5,
      handled: true,
      killBuffer: '',
      value: 'alphabeta',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        rightArrow: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 10,
      handled: true,
      killBuffer: '',
      value: 'alpha beta',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 10,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        backspace: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 0,
      handled: true,
      killBuffer: 'alpha beta',
      value: '',
    },
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 6,
        killBuffer: '',
        value: 'alpha beta',
      },
      '',
      createComposerKey({
        delete: true,
        super: true,
      }),
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: 'beta',
      value: 'alpha ',
    },
  )
})

test('assistant Ink composer editing normalizes pasted carriage returns to newlines', () => {
  assert.equal(
    normalizeComposerInsertedText('alpha\r\nbeta\rgamma'),
    'alpha\nbeta\ngamma',
  )

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 0,
        killBuffer: '',
        value: '',
      },
      'alpha\r\nbeta\rgamma',
      createComposerKey(),
    ),
    {
      cursorOffset: 16,
      handled: true,
      killBuffer: '',
      value: 'alpha\nbeta\ngamma',
    },
  )
})

test('assistant Ink composer render highlights the active character instead of inserting a spacer', () => {
  const rendered = renderComposerValue({
    cursorOffset: 2,
    disabled: false,
    placeholder: 'Type a message',
    theme: LIGHT_ASSISTANT_INK_THEME,
    value: 'alpha',
  })
  const renderedProps = rendered.props as {
    children?: React.ReactNode
    color?: string
    wrap?: string
  }
  const children = React.Children.toArray(renderedProps.children)

  assert.equal(renderedProps.wrap, 'wrap')
  assert.equal(renderedProps.color, LIGHT_ASSISTANT_INK_THEME.composerTextColor)
  assert.deepEqual(children.length, 3)
  assert.equal(children[0], 'al')
  assert.equal(children[2], 'ha')
  assert.equal(React.isValidElement(children[1]), true)

  if (!React.isValidElement(children[1])) {
    throw new Error('Expected the cursor segment to render as a React element.')
  }

  const cursorProps = children[1].props as {
    backgroundColor?: string
    children?: React.ReactNode
    color?: string
  }
  assert.equal(cursorProps.children, 'p')
  assert.equal(
    cursorProps.backgroundColor,
    LIGHT_ASSISTANT_INK_THEME.composerCursorBackground,
  )
  assert.equal(
    cursorProps.color,
    LIGHT_ASSISTANT_INK_THEME.composerCursorTextColor,
  )
})

test('assistant Ink transcript partition keeps completed turns static while the current busy turn stays live', () => {
  const entries = [
    {
      kind: 'user' as const,
      text: 'previous turn',
    },
    {
      kind: 'assistant' as const,
      text: 'previous reply',
    },
    {
      kind: 'user' as const,
      text: 'current turn',
    },
    {
      kind: 'thinking' as const,
      text: 'working on it',
      streamKey: 'thinking:1',
    },
  ]

  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: false,
      entries,
    }),
    {
      liveEntries: [],
      staticEntries: entries,
    },
  )
  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: true,
      entries,
    }),
    {
      liveEntries: entries.slice(3),
      staticEntries: entries.slice(0, 3),
    },
  )
})

test('assistant Ink transcript partition keeps all rows live when no user turn has been committed yet', () => {
  const entries = [
    {
      kind: 'thinking' as const,
      text: 'warming up',
      streamKey: 'thinking:1',
    },
    {
      kind: 'assistant' as const,
      text: 'partial reply',
      streamKey: 'assistant:1',
    },
  ]

  assert.deepEqual(
    partitionChatTranscriptEntries({
      busy: true,
      entries,
    }),
    {
      liveEntries: entries,
      staticEntries: [],
    },
  )
})

test('assistant Ink busy status hides once the current turn already has a visible assistant row', () => {
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        {
          kind: 'user',
          text: 'current turn',
        },
        {
          kind: 'assistant',
          text: 'partial reply',
          streamKey: 'assistant:1',
        },
      ],
    }),
    false,
  )
})

test('assistant Ink busy status hides once the current turn already has a visible error row', () => {
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        {
          kind: 'user',
          text: 'current turn',
        },
        {
          kind: 'error',
          text: 'provider blew up',
        },
      ],
    }),
    false,
  )
})

test('assistant Ink busy status stays visible while the current turn has no visible reply yet', () => {
  assert.equal(
    shouldShowBusyStatus({
      busy: true,
      entries: [
        {
          kind: 'user',
          text: 'current turn',
        },
        {
          kind: 'thinking',
          text: 'working on it',
          streamKey: 'thinking:1',
        },
      ],
    }),
    true,
  )
})

test('assistant Ink transcript feed renders the header and committed rows via Ink Static output', () => {
  const rendered = renderChatTranscriptFeed({
    bindingSummary: 'imessage · assistant:primary · chat-123',
    busy: true,
    entries: [
      {
        kind: 'user',
        text: 'previous turn',
      },
      {
        kind: 'assistant',
        text: 'previous reply',
      },
      {
        kind: 'user',
        text: 'current turn',
      },
      {
        kind: 'assistant',
        text: 'streaming now',
        streamKey: 'assistant:live',
      },
    ],
    sessionId: 'asst_test_session',
  })
  const fragmentChildren = React.Children.toArray(
    (rendered.props as { children?: React.ReactNode }).children,
  )

  assert.equal(rendered.type, React.Fragment)
  assert.equal(fragmentChildren.length, 2)
  assert.equal(React.isValidElement(fragmentChildren[0]), true)
  assert.equal(React.isValidElement(fragmentChildren[1]), true)

  if (
    !React.isValidElement(fragmentChildren[0]) ||
    !React.isValidElement(fragmentChildren[1])
  ) {
    throw new Error('Expected transcript feed children to be valid React elements.')
  }

  assert.equal(fragmentChildren[0].type, Static)
  assert.equal(fragmentChildren[1].type, Box)

  const staticProps = fragmentChildren[0].props as {
    items?: unknown[]
  }
  const liveProps = fragmentChildren[1].props as {
    children?: React.ReactNode
    flexDirection?: string
    width?: string
  }
  const liveChildren = React.Children.toArray(liveProps.children)

  assert.equal(staticProps.items?.length, 4)
  assert.equal(liveProps.flexDirection, 'column')
  assert.equal(liveProps.width, '100%')
  assert.equal(liveChildren.length, 1)
})

test('assistant Ink transcript feed header omits the session id label', () => {
  const rendered = renderChatTranscriptFeed({
    bindingSummary: 'imessage · assistant:primary · chat-123',
    busy: false,
    entries: [],
    sessionId: 'asst_test_session',
  })
  const fragmentChildren = React.Children.toArray(
    (rendered.props as { children?: React.ReactNode }).children,
  )

  assert.equal(React.isValidElement(fragmentChildren[0]), true)
  if (!React.isValidElement(fragmentChildren[0])) {
    throw new Error('Expected transcript feed static output to be a valid React element.')
  }

  const staticProps = fragmentChildren[0].props as {
    children?: ((item: unknown, index: number) => React.ReactElement) | React.ReactNode
    items?: unknown[]
  }
  const renderStaticRow = staticProps.children

  assert.equal(typeof renderStaticRow, 'function')
  assert.equal(staticProps.items?.length, 1)
  if (typeof renderStaticRow !== 'function') {
    throw new Error('Expected transcript feed static output to expose a row renderer.')
  }

  const header = renderStaticRow(staticProps.items?.[0], 0)
  assert.equal(React.isValidElement(header), true)
  if (!React.isValidElement(header)) {
    throw new Error('Expected transcript feed header to be a valid React element.')
  }

  assert.deepEqual(Object.keys(header.props as Record<string, unknown>), ['bindingSummary'])
  assert.equal((header.props as { bindingSummary?: string | null }).bindingSummary, 'imessage · assistant:primary · chat-123')
  assert.doesNotMatch(JSON.stringify(header.props), /asst_test_session/u)
})

test('assistant Ink transcript feed keeps the empty chat state free of an intro banner', () => {
  const rendered = renderChatTranscriptFeed({
    bindingSummary: null,
    busy: false,
    entries: [],
    sessionId: 'asst_empty_session',
  })
  const fragmentChildren = React.Children.toArray(
    (rendered.props as { children?: React.ReactNode }).children,
  )

  assert.equal(fragmentChildren.length, 2)
  assert.equal(React.isValidElement(fragmentChildren[0]), true)
  assert.equal(React.isValidElement(fragmentChildren[1]), true)

  if (
    !React.isValidElement(fragmentChildren[0]) ||
    !React.isValidElement(fragmentChildren[1])
  ) {
    throw new Error('Expected transcript feed children to be valid React elements.')
  }

  const staticProps = fragmentChildren[0].props as {
    items?: unknown[]
  }
  const liveProps = fragmentChildren[1].props as {
    children?: React.ReactNode
  }
  const liveChildren = React.Children.toArray(liveProps.children)

  assert.equal(fragmentChildren[0].type, Static)
  assert.equal(fragmentChildren[1].type, Box)
  assert.equal(staticProps.items?.length, 1)
  assert.equal(liveChildren.length, 0)
})

test('assistant Ink link helpers split markdown links and map absolute file paths to file URLs', () => {
  const fileTarget = '/tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10'

  assert.deepEqual(
    splitAssistantMarkdownLinks(
      `See [workout.ts](${fileTarget}) and [docs](https://example.com/reference).`,
    ),
    [
      {
        kind: 'text',
        text: 'See ',
      },
      {
        kind: 'link',
        label: 'workout.ts',
        target: fileTarget,
      },
      {
        kind: 'text',
        text: ' and ',
      },
      {
        kind: 'link',
        label: 'docs',
        target: 'https://example.com/reference',
      },
      {
        kind: 'text',
        text: '.',
      },
    ],
  )

  assert.equal(
    resolveAssistantHyperlinkTarget(fileTarget),
    'file:///tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10',
  )
  assert.equal(
    resolveAssistantHyperlinkTarget('https://example.com/reference'),
    'https://example.com/reference',
  )
  assert.equal(resolveAssistantHyperlinkTarget('packages/cli/src/usecases/workout.ts'), null)
  assert.equal(
    formatAssistantTerminalHyperlink(
      'workout.ts',
      'file:///tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10',
    ),
    '\u001B]8;;file:///tmp/mock-vault/packages/cli/src/usecases/workout.ts#L10\u0007workout.ts\u001B]8;;\u0007',
  )
})

test('assistant Ink wrapped text block keeps assistant replies in a single full-width wrapped block', () => {
  const text =
    'All good. What do you want to sort out: a health question, something in the vault, or a reminder/routine?'
  const rendered = renderWrappedTextBlock({ children: text })

  assert.equal(rendered.type, Box)

  const wrapperProps = rendered.props as {
    children?: React.ReactNode
    flexDirection?: string
    width?: string
  }
  const children = React.Children.toArray(wrapperProps.children)

  assert.equal(wrapperProps.flexDirection, 'column')
  assert.equal(wrapperProps.width, '100%')
  assert.equal(children.length, 1)
  assert.equal(React.isValidElement(children[0]), true)

  if (!React.isValidElement(children[0])) {
    throw new Error('Expected the wrapped assistant message child to render as a React element.')
  }

  const textProps = children[0].props as {
    children?: React.ReactNode
    wrap?: string
  }

  assert.equal(textProps.wrap, 'wrap')
  assert.equal(textProps.children, text)
})

test('assistant Ink plain-text wrapping keeps words intact on narrow widths', () => {
  assert.equal(
    wrapAssistantPlainText('pull context from the vault if you want', 10),
    'pull\ncontext\nfrom the\nvault if\nyou want',
  )
})

test('assistant Ink hyperlink support only enables terminal links on supported tty environments', () => {
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        TERM_PROGRAM: 'Apple_Terminal',
      },
      isTTY: true,
    }),
    true,
  )
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        TERM_PROGRAM: 'Apple_Terminal',
      },
      isTTY: false,
    }),
    false,
  )
  assert.equal(
    supportsAssistantTerminalHyperlinks({
      env: {
        CI: 'true',
        TERM_PROGRAM: 'Apple_Terminal',
      },
      isTTY: true,
    }),
    false,
  )
})

test('assistant Ink composer render highlights the first placeholder character when empty', () => {
  const rendered = renderComposerValue({
    cursorOffset: 0,
    disabled: false,
    placeholder: 'Type a message',
    theme: LIGHT_ASSISTANT_INK_THEME,
    value: '',
  })
  const renderedProps = rendered.props as {
    children?: React.ReactNode
    color?: string
    wrap?: string
  }
  const children = React.Children.toArray(renderedProps.children)

  assert.equal(renderedProps.wrap, 'wrap')
  assert.equal(renderedProps.color, LIGHT_ASSISTANT_INK_THEME.composerPlaceholderColor)
  assert.deepEqual(children.length, 2)
  assert.equal(children[1], 'ype a message')
  assert.equal(React.isValidElement(children[0]), true)

  if (!React.isValidElement(children[0])) {
    throw new Error('Expected the placeholder cursor segment to render as a React element.')
  }

  const cursorProps = children[0].props as {
    backgroundColor?: string
    children?: React.ReactNode
    color?: string
  }
  assert.equal(cursorProps.children, 'T')
  assert.equal(
    cursorProps.backgroundColor,
    LIGHT_ASSISTANT_INK_THEME.composerCursorBackground,
  )
  assert.equal(
    cursorProps.color,
    LIGHT_ASSISTANT_INK_THEME.composerCursorTextColor,
  )
})

test('assistant Ink composer vertical cursor movement preserves preferred columns across uneven lines', () => {
  const firstMove = resolveComposerVerticalCursorMove({
    cursorOffset: 5,
    direction: 'down',
    preferredColumn: null,
    value: 'alpha\nbe\ncharlie',
  })

  assert.deepEqual(firstMove, {
    cursorOffset: 8,
    preferredColumn: 5,
  })

  const secondMove = resolveComposerVerticalCursorMove({
    cursorOffset: firstMove.cursorOffset,
    direction: 'down',
    preferredColumn: firstMove.preferredColumn,
    value: 'alpha\nbe\ncharlie',
  })

  assert.deepEqual(secondMove, {
    cursorOffset: 14,
    preferredColumn: 5,
  })

  assert.deepEqual(
    resolveComposerVerticalCursorMove({
      cursorOffset: secondMove.cursorOffset,
      direction: 'up',
      preferredColumn: secondMove.preferredColumn,
      value: 'alpha\nbe\ncharlie',
    }),
    {
      cursorOffset: 8,
      preferredColumn: 5,
    },
  )
})

test('assistant Ink composer terminal actions treat tab as a queue submit', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      tab: true,
    }),
  )

  assert.deepEqual(action, {
    kind: 'submit',
    mode: 'tab',
  })
})

test('assistant Ink composer terminal actions treat option+up as editing the last queued follow-up', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      meta: true,
      upArrow: true,
    }),
  )

  assert.deepEqual(action, {
    kind: 'edit-last-queued',
  })
})

test('assistant Ink composer terminal actions treat shift+enter as a newline edit', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      return: true,
      shift: true,
    }),
  )

  assert.equal(action.kind, 'edit')
  assert.equal(action.input, '\n')
  assert.equal(action.key.return, false)

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello',
      },
      action.input,
      action.key,
    ),
    {
      cursorOffset: 6,
      handled: true,
      killBuffer: '',
      value: 'hello\n',
    },
  )
})

test('assistant Ink composer terminal actions treat raw DEL bytes as backspace edits', () => {
  const action = resolveComposerTerminalAction('\u007f', createComposerKey())

  assert.equal(action.kind, 'edit')
  assert.equal(action.input, '')
  assert.equal(action.key.backspace, true)
  assert.equal(action.key.delete, false)
})

test('assistant Ink composer terminal actions treat xterm-style shift+enter escape sequences as a newline edit', () => {
  for (const rawInput of ['[27;2;13~', '\u001b[27;2;13~']) {
    const action = resolveComposerTerminalAction(rawInput, createComposerKey())

    assert.equal(action.kind, 'edit')
    assert.equal(action.input, '\n')
    assert.equal(action.key.return, false)
    assert.equal(action.key.shift, true)
  }
})

test('assistant Ink composer terminal actions map terminal delete keypresses to backward delete', () => {
  const action = resolveComposerTerminalAction(
    '',
    createComposerKey({
      delete: true,
    }),
  )

  assert.equal(action.kind, 'edit')
  assert.equal(action.key.backspace, true)
  assert.equal(action.key.delete, false)

  assert.deepEqual(
    applyComposerEditingInput(
      {
        cursorOffset: 5,
        killBuffer: '',
        value: 'hello',
      },
      action.input,
      action.key,
    ),
    {
      cursorOffset: 4,
      handled: true,
      killBuffer: '',
      value: 'hell',
    },
  )
})

test('assistant Ink queued follow-up previews collapse whitespace and truncate long prompts', () => {
  assert.equal(
    formatQueuedFollowUpPreview('  name should be optional\nand only asked once  '),
    'name should be optional and only asked once',
  )
  assert.equal(
    formatQueuedFollowUpPreview(
      'This is a deliberately long queued follow-up prompt that should collapse whitespace and trim down to a concise single-line preview for the Ink queue panel.',
    ),
    'This is a deliberately long queued follow-up prompt that should collapse whitespace…',
  )
})

test('assistant Ink composer render keeps newline-adjacent cursors in one wrapped text flow', () => {
  const rendered = renderComposerValue({
    cursorOffset: 5,
    disabled: false,
    placeholder: 'Type a message',
    theme: LIGHT_ASSISTANT_INK_THEME,
    value: 'alpha\nbeta gamma',
  })
  const renderedProps = rendered.props as {
    children?: React.ReactNode
    color?: string
    wrap?: string
  }
  const children = React.Children.toArray(renderedProps.children)

  assert.equal(renderedProps.wrap, 'wrap')
  assert.equal(renderedProps.color, LIGHT_ASSISTANT_INK_THEME.composerTextColor)
  assert.deepEqual(children.length, 3)
  assert.equal(children[0], 'alpha')
  assert.equal(children[2], '\nbeta gamma')
  assert.equal(React.isValidElement(children[1]), true)

  if (!React.isValidElement(children[1])) {
    throw new Error('Expected the cursor segment to render as a React element.')
  }

  const cursorProps = children[1].props as {
    backgroundColor?: string
    children?: React.ReactNode
    color?: string
  }
  assert.equal(cursorProps.children, ' ')
  assert.equal(
    cursorProps.backgroundColor,
    LIGHT_ASSISTANT_INK_THEME.composerCursorBackground,
  )
  assert.equal(
    cursorProps.color,
    LIGHT_ASSISTANT_INK_THEME.composerCursorTextColor,
  )
})

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
