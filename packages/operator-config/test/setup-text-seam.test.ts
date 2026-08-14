import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'

import { afterEach, test, vi } from 'vitest'

import {
  SETUP_RUNTIME_ENV_NOTICE,
  createSetupRuntimeEnvResolver,
  describeSelectedSetupWearables,
  describeSetupChannelStatus,
  describeSetupWearableStatus,
} from '../src/setup-runtime-env.ts'
import { prepareSetupPromptInput } from '../src/setup-prompt-io.ts'
import {
  errorMessage,
  formatStructuredErrorMessage,
  normalizeNullableString,
  redactSensitivePathSegments,
} from '../src/text/shared.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

test('setup prompt input enables interactive streams safely and tolerates minimal streams', () => {
  let rawModeValue: boolean | null = null
  let refCalled = false
  let resumeCalled = false
  const interactiveInput = Object.assign(new PassThrough(), {
    isTTY: true,
    ref() {
      refCalled = true
    },
    resume() {
      resumeCalled = true
      return this
    },
    setRawMode(value: boolean) {
      rawModeValue = value
    },
  })

  prepareSetupPromptInput(interactiveInput)

  assert.equal(rawModeValue, false)
  assert.equal(refCalled, true)
  assert.equal(resumeCalled, true)

  assert.doesNotThrow(() => prepareSetupPromptInput(new PassThrough()))
})

test('setup runtime resolver clones process env and surfaces ready channel and wearable states', async () => {
  const resolver = createSetupRuntimeEnvResolver()
  const currentEnv = resolver.getCurrentEnv()

  assert.notEqual(currentEnv, process.env)
  currentEnv.MURPH_OPERATOR_CONFIG_TEST_KEY = 'mutated'
  assert.notEqual(process.env.MURPH_OPERATOR_CONFIG_TEST_KEY, 'mutated')
  assert.deepEqual(
    await resolver.promptForMissing({
      channels: ['telegram'],
      env: {
        OURA_CLIENT_ID: 'already-set',
        OURA_CLIENT_SECRET: 'already-set',
        TELEGRAM_BOT_TOKEN: 'already-set',
      },
      wearables: ['oura'],
    }),
    {},
  )

  assert.deepEqual(describeSetupChannelStatus('telegram', { TELEGRAM_BOT_TOKEN: 'token' }), {
    badge: 'ready',
    detail: 'Bot token is available in the current environment.',
    missingEnv: [],
    ready: true,
  })
  assert.deepEqual(describeSetupChannelStatus('telegram', {}), {
    badge: 'needs token',
    detail:
      'Add TELEGRAM_BOT_TOKEN to the current environment to enable Telegram auto-reply.',
    missingEnv: ['TELEGRAM_BOT_TOKEN'],
    ready: false,
  })
  assert.deepEqual(
    describeSetupWearableStatus('garmin', {
      JUNCTION_API_KEY: 'sk_us_junction-test',
      JUNCTION_CLIENT_USER_ID_SECRET: 'junction-user-secret',
      JUNCTION_ENV: 'sandbox',
      JUNCTION_REGION: 'us',
    }),
    {
      badge: 'ready',
      detail: 'Junction Link can open Garmin connect after setup.',
      missingEnv: [],
      ready: true,
    },
  )
  assert.deepEqual(
    describeSetupWearableStatus('oura', {
      OURA_CLIENT_ID: 'oura-id',
    }),
    {
      badge: 'needs client keys',
      detail:
        'Add OURA_CLIENT_ID and OURA_CLIENT_SECRET to the current environment to enable Oura connect.',
      missingEnv: ['OURA_CLIENT_SECRET'],
      ready: false,
    },
  )
  assert.deepEqual(
    describeSetupWearableStatus('oura', {
      OURA_CLIENT_ID: 'oura-id',
      OURA_CLIENT_SECRET: 'oura-secret',
    }),
    {
      badge: 'ready',
      detail: 'OAuth connect can open after setup.',
      missingEnv: [],
      ready: true,
    },
  )
  assert.deepEqual(
    describeSetupWearableStatus('whoop', {}),
    {
      badge: 'needs client keys',
      detail:
        'Add WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET to the current environment to enable WHOOP connect.',
      missingEnv: ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET'],
      ready: false,
    },
  )
  assert.deepEqual(
    describeSetupWearableStatus('whoop', {
      WHOOP_CLIENT_ID: 'whoop-id',
      WHOOP_CLIENT_SECRET: 'whoop-secret',
    }),
    {
      badge: 'ready',
      detail: 'OAuth connect can open after setup.',
      missingEnv: [],
      ready: true,
    },
  )
  assert.match(SETUP_RUNTIME_ENV_NOTICE, /saved to local `\.env\.local`/u)
  assert.equal(
    describeSelectedSetupWearables({
      env: {},
      wearables: ['whoop'],
    })[0]?.detail,
    'Selected WHOOP, but it still needs WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET before the connect flow can open.',
  )
})

test('setup env overrides tolerate missing overrides entirely', () => {
  assert.doesNotThrow(() => createSetupRuntimeEnvResolver().getCurrentEnv())
})

test('text shared helpers normalize messages and redact structured path details', () => {
  assert.equal(normalizeNullableString(undefined), null)
  assert.equal(normalizeNullableString('   '), null)
  assert.equal(normalizeNullableString('  value  '), 'value')

  assert.equal(errorMessage(new Error('  failure  ')), 'failure')
  assert.equal(errorMessage(new Error('   ')), 'Error:    ')
  assert.equal(errorMessage({ code: 'boom' }), '[object Object]')

  assert.equal(
    redactSensitivePathSegments(
      '/Users/example/project /home/example/project C:\\Users\\Example\\project',
    ),
    '<HOME_DIR>/project <HOME_DIR>/project <HOME_DIR>\\project',
  )

  assert.equal(
    formatStructuredErrorMessage({
      context: {
        errors: ['  /home/example/.murph/config.json  ', null, 'C:\\Users\\Person\\vault'],
      },
      details: {
        errors: [' /Users/example/vault ', '   '],
      },
      message: 'Failed at /Users/example/vault',
    }),
    [
      '[object Object]',
      'details:',
      '- <HOME_DIR>/vault',
      '- <HOME_DIR>/.murph/config.json',
      '- <HOME_DIR>\\vault',
    ].join('\n'),
  )
  assert.equal(formatStructuredErrorMessage(new Error('plain failure')), 'plain failure')
})
