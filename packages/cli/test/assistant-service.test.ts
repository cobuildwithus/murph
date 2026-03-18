import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  deliverAssistantMessage: vi.fn(),
  executeAssistantProviderTurn: vi.fn(),
}))

vi.mock('../src/outbound-channel.js', async () => {
  const actual = await vi.importActual<typeof import('../src/outbound-channel.js')>(
    '../src/outbound-channel.js',
  )

  return {
    ...actual,
    deliverAssistantMessage: serviceMocks.deliverAssistantMessage,
  }
})

vi.mock('../src/chat-provider.js', async () => {
  const actual = await vi.importActual<typeof import('../src/chat-provider.js')>(
    '../src/chat-provider.js',
  )

  return {
    ...actual,
    executeAssistantProviderTurn: serviceMocks.executeAssistantProviderTurn,
  }
})

import { sendAssistantMessage } from '../src/assistant/service.js'
import { resolveAssistantStatePaths } from '../src/assistant-state.js'

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
  vi.restoreAllMocks()
})

beforeEach(() => {
  serviceMocks.deliverAssistantMessage.mockReset()
  serviceMocks.executeAssistantProviderTurn.mockReset()
})

test('sendAssistantMessage gives the first provider turn direct Incur-backed CLI guidance and PATH access', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(homeRoot, { recursive: true })
  await mkdir(vaultRoot, { recursive: true })

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  serviceMocks.executeAssistantProviderTurn.mockResolvedValue({
    provider: 'codex-cli',
    providerSessionId: 'thread-123',
    response: 'assistant reply',
    stderr: '',
    stdout: '',
    rawEvents: [],
  })

  try {
    await sendAssistantMessage({
      vault: vaultRoot,
      prompt: 'Inspect the vault with the CLI.',
    })
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }

  const firstCall = serviceMocks.executeAssistantProviderTurn.mock.calls[0]?.[0]
  const expectedUserBinDirectory = path.join(homeRoot, '.local', 'bin')

  assert.equal(firstCall?.workingDirectory, vaultRoot)
  assert.match(firstCall?.systemPrompt ?? '', /Start with the smallest relevant context/u)
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli <command> --help/u)
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli <command> --schema --format json/u)
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli --llms/u)
  assert.match(firstCall?.systemPrompt ?? '', /vault-cli --llms-full/u)
  assert.match(firstCall?.systemPrompt ?? '', /healthybob/u)
  assert.equal(
    String(firstCall?.env?.PATH ?? '').split(path.delimiter)[0],
    expectedUserBinDirectory,
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

test('sendAssistantMessage loads vault-scoped assistant memory into new sessions after prior preference turns', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-memory-1',
      response: 'Noted.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-memory-2',
      response: 'I remember.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:one',
    prompt: 'Call me Chris. Going forward, keep answers concise. We are working on the assistant memory implementation.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:two',
    prompt: 'What should you remember across sessions?',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.match(longTermMemory, /Call the user Chris\./u)
  assert.match(longTermMemory, /keep answers concise\./iu)
  assert.match(secondCall?.systemPrompt ?? '', /Long-term assistant memory:/u)
  assert.match(secondCall?.systemPrompt ?? '', /Call the user Chris\./u)
  assert.match(secondCall?.systemPrompt ?? '', /keep answers concise\./iu)
  assert.match(secondCall?.systemPrompt ?? '', /Recent daily assistant memory/u)
})

test('sendAssistantMessage bootstraps only the latest mutable long-term memory on fresh sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-upsert-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-upsert-1',
      response: 'Noted.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-upsert-2',
      response: 'Updated.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-upsert-3',
      response: 'I remember the latest preferences.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:upsert-one',
    prompt: 'Call me Chris. Going forward, keep answers concise. Use imperial units.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:upsert-two',
    prompt:
      'Actually, call me Alex from now on. From now on, keep answers detailed. Use metric units.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:upsert-three',
    prompt: 'What should you remember across sessions now?',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const thirdCall = serviceMocks.executeAssistantProviderTurn.mock.calls[2]?.[0]

  assert.match(longTermMemory, /Call the user Alex\./u)
  assert.doesNotMatch(longTermMemory, /Call the user Chris\./u)
  assert.match(longTermMemory, /keep answers detailed\./iu)
  assert.doesNotMatch(longTermMemory, /keep answers concise\./iu)
  assert.match(longTermMemory, /Use metric units\./u)
  assert.doesNotMatch(longTermMemory, /Use imperial units\./u)
  assert.match(thirdCall?.systemPrompt ?? '', /Call the user Alex\./u)
  assert.doesNotMatch(thirdCall?.systemPrompt ?? '', /Call the user Chris\./u)
  assert.match(thirdCall?.systemPrompt ?? '', /keep answers detailed\./iu)
  assert.doesNotMatch(thirdCall?.systemPrompt ?? '', /keep answers concise\./iu)
  assert.match(thirdCall?.systemPrompt ?? '', /Use metric units\./u)
  assert.doesNotMatch(thirdCall?.systemPrompt ?? '', /Use imperial units\./u)
})

test('sendAssistantMessage can persist selected health context into assistant memory for future sessions', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-service-sensitive-memory-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await mkdir(vaultRoot, { recursive: true })

  serviceMocks.executeAssistantProviderTurn
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-sensitive-1',
      response: 'Noted.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })
    .mockResolvedValueOnce({
      provider: 'codex-cli',
      providerSessionId: 'thread-sensitive-2',
      response: 'I remember.',
      stderr: '',
      stdout: '',
      rawEvents: [],
    })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:health-one',
    prompt: 'Remember that my blood pressure is 120 over 80.',
  })

  await sendAssistantMessage({
    vault: vaultRoot,
    alias: 'chat:health-two',
    prompt: 'What health context should carry into future chats?',
  })

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const longTermMemory = await readFile(statePaths.longTermMemoryPath, 'utf8')
  const secondCall = serviceMocks.executeAssistantProviderTurn.mock.calls[1]?.[0]

  assert.match(longTermMemory, /## Health context/u)
  assert.match(longTermMemory, /User's blood pressure is 120 over 80\./u)
  assert.match(secondCall?.systemPrompt ?? '', /Long-term assistant memory:/u)
  assert.match(secondCall?.systemPrompt ?? '', /User's blood pressure is 120 over 80\./u)
  assert.match(secondCall?.systemPrompt ?? '', /Recent daily assistant memory/u)
})
