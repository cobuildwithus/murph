import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test, vi } from 'vitest'

const runtimeMocks = vi.hoisted(() => ({
  createInterface: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
  routeInboxCaptureWithModel: vi.fn(),
}))

vi.mock('node:readline/promises', () => ({
  default: {
    createInterface: runtimeMocks.createInterface,
  },
  createInterface: runtimeMocks.createInterface,
}))

vi.mock('../src/assistant-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant-provider.js')>(
    '../src/assistant-provider.js',
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
  runtimeMocks.createInterface.mockReset()
  runtimeMocks.executeAssistantProviderTurn.mockReset()
  runtimeMocks.routeInboxCaptureWithModel.mockReset()
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
  assert.equal('vault' in first.session, false)
  assert.equal('stateRoot' in first.session, false)
  assert.equal(second.session.sessionId, first.session.sessionId)
  assert.equal(second.session.turnCount, 2)
  assert.equal(second.session.lastAssistantMessage, 'second reply')

  const firstCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const secondCall = runtimeMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]
  assert.equal(firstCall.resumeProviderSessionId, null)
  assert.equal(secondCall.resumeProviderSessionId, 'thread-123')
  assert.match(firstCall.prompt, /You are Healthy Bob/u)
  assert.equal(secondCall.prompt, 'What about today?')
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
  const inboxServices = {
    list: async () => ({
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
    }),
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

test('runAssistantChat ignores blank input, prints the session id, and exits cleanly', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-chat-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-loop',
    response: 'loop reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  const readlineMock = mockReadlineInputs(['', '/session', 'hello', '/exit'])
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  const result = await runAssistantChat({
    vault: vaultRoot,
    alias: 'chat:bob',
  })

  assert.equal(result.turns, 1)
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(
    errorSpy.mock.calls.some(([value]) => value === result.session.sessionId),
    true,
  )
  assert.equal(
    errorSpy.mock.calls.some(
      ([value]) =>
        typeof value === 'string' && value.includes('assistant> loop reply'),
    ),
    true,
  )
  assert.equal(readlineMock.question.mock.calls.length, 4)
  assert.equal(readlineMock.close.mock.calls.length, 1)
})

test('runAssistantChat sends the optional initial prompt before entering the loop', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-initial-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-initial',
    response: 'initial reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  mockReadlineInputs(['/exit'])
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  const result = await runAssistantChat({
    vault: vaultRoot,
    initialPrompt: 'Start here.',
  })

  assert.equal(result.turns, 1)
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 1)
  assert.equal(
    errorSpy.mock.calls.some(
      ([value]) =>
        typeof value === 'string' && value.includes('assistant> initial reply'),
    ),
    true,
  )
})

test('runAssistantChat logs provider errors and keeps the loop alive for later input', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-retry-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  runtimeMocks.executeAssistantProviderTurn
    .mockRejectedValueOnce(new Error('provider exploded'))
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-recovered',
      response: 'recovered reply',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  mockReadlineInputs(['first turn', 'second turn', '/exit'])
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  const result = await runAssistantChat({
    vault: vaultRoot,
  })

  assert.equal(result.turns, 1)
  assert.equal(runtimeMocks.executeAssistantProviderTurn.mock.calls.length, 2)
  assert.equal(
    errorSpy.mock.calls.some(
      ([value]) =>
        typeof value === 'string' &&
        value.includes('assistant error> provider exploded'),
    ),
    true,
  )
  assert.equal(
    errorSpy.mock.calls.some(
      ([value]) =>
        typeof value === 'string' &&
        value.includes('assistant> recovered reply'),
    ),
    true,
  )
})

function mockReadlineInputs(inputs: string[]) {
  const question = vi.fn(async () => inputs.shift() ?? '/exit')
  const close = vi.fn()

  runtimeMocks.createInterface.mockReturnValue({
    question,
    close,
  })

  return {
    close,
    question,
  }
}

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
