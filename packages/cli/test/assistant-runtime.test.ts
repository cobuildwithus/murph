import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test, vi } from 'vitest'
import { resolveOperatorConfigPath } from '../src/operator-config.js'

const runtimeMocks = vi.hoisted(() => ({
  deliverAssistantMessage: vi.fn(),
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
    deliverAssistantMessage: runtimeMocks.deliverAssistantMessage,
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
  scanAssistantInboxOnce,
  sendAssistantMessage,
} from '../src/assistant-runtime.js'
import {
  ACTIVE_CHAT_FOOTER,
  BUSY_CHAT_STATUS,
  DEFAULT_CHAT_FOOTER,
  formatEntry,
  seedChatEntries,
} from '../src/assistant/ui/view-model.js'

const cleanupPaths: string[] = []

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
  runtimeMocks.deliverAssistantMessage.mockReset()
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
  assert.equal(second.session.lastAssistantMessage, 'second reply')

  const firstCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(firstCall.resumeProviderSessionId, null)
  assert.equal(secondCall.resumeProviderSessionId, 'thread-123')
  assert.match(firstCall.systemPrompt ?? '', /You are Healthy Bob/u)
  assert.equal(firstCall.userPrompt, 'What did Bob eat?')
  assert.equal(firstCall.sessionContext?.binding.channel, 'imessage')
  assert.equal(secondCall.systemPrompt, null)
  assert.equal(secondCall.userPrompt, 'What about today?')
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
  runtimeMocks.deliverAssistantMessage.mockImplementation(
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
        lastUserMessage: 'send it',
        lastAssistantMessage: input.message,
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
  assert.deepEqual(runtimeMocks.deliverAssistantMessage.mock.calls, [
    [
      {
        vault: vaultRoot,
        sessionId: result.session.sessionId,
        channel: 'imessage',
        identityId: null,
        actorId: '+15551234567',
        threadId: null,
        threadIsDirect: null,
        target: null,
        message: 'sent reply',
      },
    ],
  ])
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
  runtimeMocks.deliverAssistantMessage.mockRejectedValue(
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
  assert.equal(result.session.lastAssistantMessage, 'reply persisted')
})

test('sendAssistantMessage stores only short turn excerpts in assistant state', async () => {
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

  assert.equal(result.session.lastUserMessage?.length, 280)
  assert.equal(result.session.lastAssistantMessage?.length, 280)
  assert.match(result.session.lastUserMessage ?? '', /\.\.\.$/u)
  assert.match(result.session.lastAssistantMessage ?? '', /\.\.\.$/u)
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

test('runAssistantAutomation reports daemon failures as error results', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-daemon-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

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
      run: async () => {
        throw new Error('daemon exploded')
      },
    } as any,
  })

  assert.equal(result.reason, 'error')
  assert.equal(result.daemonStarted, true)
  assert.equal(result.lastError, 'daemon exploded')
  assert.equal(result.scans, 1)
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
      lastUserMessage: 'hello',
      lastAssistantMessage: 'loop reply',
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

test('assistant Ink view-model starts with a shorter local-first system message', () => {
  const entries = seedChatEntries({
    schema: 'healthybob.assistant-session.v2',
    sessionId: 'asst_demo',
    provider: 'codex-cli',
    providerSessionId: null,
    providerOptions: {
      model: null,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      profile: null,
      oss: false,
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
    lastUserMessage: 'hello',
    lastAssistantMessage: 'hi',
  })

  assert.deepEqual(entries, [
    {
      kind: 'system',
      text: 'Local-first chat. Provider transcripts stay with the provider when supported.',
    },
    {
      kind: 'user',
      text: 'hello',
    },
    {
      kind: 'assistant',
      text: 'hi',
    },
  ])
})

test('assistant Ink view-model keeps busy copy single-purpose', () => {
  assert.equal(formatEntry({ kind: 'assistant', text: 'thinking...' }), 'assistant> thinking...')
  assert.equal(BUSY_CHAT_STATUS, 'assistant> thinking...')
  assert.match(DEFAULT_CHAT_FOOTER, /^Type a message\./u)
  assert.doesNotMatch(DEFAULT_CHAT_FOOTER, /Waiting for the assistant/u)
  assert.doesNotMatch(ACTIVE_CHAT_FOOTER, /Waiting for the assistant/u)
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
