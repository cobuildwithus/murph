import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

const readlineMock = vi.hoisted(() => ({
  createInterface: vi.fn(),
}))

vi.mock('node:readline', () => ({
  createInterface: readlineMock.createInterface,
}))

import {
  createSetupRuntimeEnvResolver,
} from '../src/setup-runtime-env.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
  readlineMock.createInterface.mockReset()
})

test('setup runtime resolver prompts for missing keys in deterministic order and skips blank answers', async () => {
  const prompts: string[] = []
  const stderrWrites: string[] = []
  const answers = [
    ' telegram-token ',
    ' sk_us_junction-test ',
    ' junction-user-secret ',
    ' sandbox ',
    ' us ',
  ]

  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderrWrites.push(String(chunk))
    return true
  }) as typeof process.stderr.write)

  readlineMock.createInterface.mockImplementation(() => ({
    close() {},
    once() {},
    question(question: string, callback: (answer: string) => void) {
      prompts.push(question)
      callback(answers.shift() ?? '')
    },
    removeListener() {},
  }))
  const resolver = createSetupRuntimeEnvResolver()

  const overrides = await resolver.promptForMissing({
    channels: ['telegram', 'telegram'],
    env: {},
    wearables: ['garmin', 'garmin'],
  })

  assert.deepEqual(prompts, [
    'Enter TELEGRAM_BOT_TOKEN for this setup run (leave blank to skip): ',
    'Enter JUNCTION_API_KEY for this setup run (leave blank to skip): ',
    'Enter JUNCTION_CLIENT_USER_ID_SECRET for this setup run (leave blank to skip): ',
    'Enter JUNCTION_ENV for this setup run (leave blank to skip): ',
    'Enter JUNCTION_REGION for this setup run (leave blank to skip): ',
  ])
  assert.deepEqual(overrides, {
    JUNCTION_API_KEY: 'sk_us_junction-test',
    JUNCTION_CLIENT_USER_ID_SECRET: 'junction-user-secret',
    JUNCTION_ENV: 'sandbox',
    JUNCTION_REGION: 'us',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
  })
  assert.match(stderrWrites.join(''), /saved to local `\.env\.local`/u)
  assert.match(stderrWrites.join(''), /Leave a prompt blank to skip/u)
})

test('setup runtime resolver derives a selected provider credential from provider config', async () => {
  const prompts: string[] = []
  const answers = [' venice-secret-test ']

  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  readlineMock.createInterface.mockImplementation(() => ({
    close() {},
    once() {},
    question(question: string, callback: (answer: string) => void) {
      prompts.push(question)
      callback(answers.shift() ?? '')
    },
    removeListener() {},
  }))
  const resolver = createSetupRuntimeEnvResolver()

  const overrides = await resolver.promptForMissing({
    assistantModelProvider: 'venice',
    channels: [],
    env: {},
    wearables: [],
  })

  assert.deepEqual(prompts, [
    'Enter VENICE_API_KEY for this setup run (leave blank to skip): ',
  ])
  assert.deepEqual(overrides, {
    VENICE_API_KEY: 'venice-secret-test',
  })
})

test('setup runtime resolver skips provider credential prompt when env already has it', async () => {
  const resolver = createSetupRuntimeEnvResolver()

  const overrides = await resolver.promptForMissing({
    assistantModelProvider: 'venice',
    channels: [],
    env: {
      VENICE_API_KEY: 'present',
    },
    wearables: [],
  })

  assert.deepEqual(overrides, {})
  assert.equal(readlineMock.createInterface.mock.calls.length, 0)
})

test('setup runtime resolver turns SIGINT prompt cancellation into a setup_cancelled error', async () => {
  let cancelPrompt: (() => void) | null = null

  readlineMock.createInterface.mockImplementation(() => ({
    close() {},
    once(event: string, handler: () => void) {
      if (event === 'SIGINT') {
        cancelPrompt = handler
      }
    },
    question() {
      cancelPrompt?.()
    },
    removeListener() {},
  }))
  const resolver = createSetupRuntimeEnvResolver()

  await assert.rejects(
    resolver.promptForMissing({
      channels: ['telegram'],
      env: {},
      wearables: [],
    }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'setup_cancelled' &&
      error.message === 'Murph setup was cancelled.',
  )
})

test('setup runtime resolver reprints help text on ? or help and treats q as cancellation', async () => {
  const prompts: string[] = []
  const stderrWrites: string[] = []
  const answers = ['?', 'help', 'q']

  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderrWrites.push(String(chunk))
    return true
  }) as typeof process.stderr.write)

  readlineMock.createInterface.mockImplementation(() => ({
    close() {},
    once() {},
    question(question: string, callback: (answer: string) => void) {
      prompts.push(question)
      callback(answers.shift() ?? '')
    },
    removeListener() {},
  }))

  const resolver = createSetupRuntimeEnvResolver()

  await assert.rejects(
    resolver.promptForMissing({
      channels: [],
      env: {},
      helpText: [
        'Local test path:',
        '  ngrok http 8788',
      ],
      wearables: ['oura'],
    }),
    (error: unknown) =>
      error instanceof VaultCliError &&
      error.code === 'setup_cancelled' &&
      error.message === 'Murph setup was cancelled.',
  )

  assert.deepEqual(prompts, [
    'Enter OURA_CLIENT_ID for this setup run (leave blank to skip): ',
    'Enter OURA_CLIENT_ID for this setup run (leave blank to skip): ',
    'Enter OURA_CLIENT_ID for this setup run (leave blank to skip): ',
  ])
  const stderrOutput = stderrWrites.join('')
  assert.match(
    stderrOutput,
    /Type \? or help to reprint the callback, webhook, tunnel, and docs guidance\. Type q to cancel setup\./u,
  )
  assert.match(stderrOutput, /Local test path:/u)
  assert.match(stderrOutput, /ngrok http 8788/u)
})
