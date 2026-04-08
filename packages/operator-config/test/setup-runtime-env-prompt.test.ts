import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import { importWithMocks } from './import-with-mocks.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

test('setup runtime resolver prompts for missing keys in deterministic order and skips blank answers', async () => {
  const prompts: string[] = []
  const stderrWrites: string[] = []
  const answers = [
    ' telegram-token ',
    '',
    ' garmin-id ',
    ' garmin-secret ',
    ' openai-key ',
  ]

  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    stderrWrites.push(String(chunk))
    return true
  }) as typeof process.stderr.write)

  const { createSetupRuntimeEnvResolver } = await importWithMocks(
    '../src/setup-runtime-env.ts',
    () => {
      vi.doMock('node:readline', () => ({
        createInterface() {
          return {
            close() {},
            once() {},
            question(question: string, callback: (answer: string) => void) {
              prompts.push(question)
              callback(answers.shift() ?? '')
            },
            removeListener() {},
          }
        },
      }))
    },
  )
  const resolver = createSetupRuntimeEnvResolver()

  const overrides = await resolver.promptForMissing({
    assistantApiKeyEnv: ' OPENAI_API_KEY ',
    channels: ['telegram', 'linq', 'telegram'],
    env: {
      LINQ_API_TOKEN: 'linq-token',
    },
    wearables: ['garmin', 'garmin'],
  })

  assert.deepEqual(prompts, [
    'Enter TELEGRAM_BOT_TOKEN for this setup run (leave blank to skip): ',
    'Enter LINQ_WEBHOOK_SECRET for this setup run (leave blank to skip): ',
    'Enter GARMIN_CLIENT_ID for this setup run (leave blank to skip): ',
    'Enter GARMIN_CLIENT_SECRET for this setup run (leave blank to skip): ',
    'Enter OPENAI_API_KEY for this setup run (leave blank to skip): ',
  ])
  assert.deepEqual(overrides, {
    GARMIN_CLIENT_ID: 'garmin-id',
    GARMIN_CLIENT_SECRET: 'garmin-secret',
    OPENAI_API_KEY: 'openai-key',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
  })
  assert.match(stderrWrites.join(''), /only used for this run/u)
  assert.match(stderrWrites.join(''), /Leave a prompt blank to skip/u)
})

test('setup runtime resolver turns SIGINT prompt cancellation into a setup_cancelled error', async () => {
  let cancelPrompt: (() => void) | null = null

  const { createSetupRuntimeEnvResolver } = await importWithMocks(
    '../src/setup-runtime-env.ts',
    () => {
      vi.doMock('node:readline', () => ({
        createInterface() {
          return {
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
          }
        },
      }))
    },
  )
  const { VaultCliError } = await import('../src/vault-cli-errors.ts')
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
