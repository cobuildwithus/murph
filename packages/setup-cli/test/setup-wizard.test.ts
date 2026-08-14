import assert from 'node:assert/strict'
import { afterAll, test, vi } from 'vitest'

const originalCi = vi.hoisted(() => {
  const previousCi = process.env.CI
  process.env.CI = 'false'
  return previousCi
})

afterAll(() => {
  if (originalCi === undefined) {
    delete process.env.CI
    return
  }

  process.env.CI = originalCi
})

import {
  buildSetupWizardPublicUrlReview,
  createSetupWizardCompletionController as createSetupWizardController,
  getDefaultSetupWizardChannels,
  describeSetupWizardPublicUrlStrategyChoice,
  getDefaultSetupWizardScheduledUpdates,
  getDefaultSetupWizardWearables,
  inferSetupWizardAssistantProvider,
  listSetupWizardAssistantProviderOptions,
  resolveSetupWizardAssistantSelection,
  resolveSetupWizardInitialScheduledUpdates,
  toggleSetupWizardChannel,
  toggleSetupWizardScheduledUpdate,
  toggleSetupWizardWearable,
  runSetupWizard,
} from '../src/setup-wizard.js'
import {
  createSetupWizardCompletionController,
  wrapSetupWizardIndex,
} from '../src/setup-wizard-core.js'
import {
  formatSetupChannel,
  formatSetupScheduledUpdate,
  formatSetupWearable,
} from '../src/setup-wizard-options.ts'
import {
  buildSetupWizardPublicUrlHelpText,
  formatSetupPublicUrlStrategy,
  normalizeSetupWizardText,
} from '../src/setup-wizard-public-url.ts'
import {
  buildSetupWizardRuntimeBadges,
  describeSetupWizardRuntimeStatus,
  normalizeSetupWizardRuntimeStatus,
  resolveSetupWizardChannelStatus,
  resolveSetupWizardWearableStatus,
} from '../src/setup-wizard-runtime-status.ts'
import { waitForRenderedText, withMockProcessTty } from './helpers.ts'

const WIZARD_TEST_TIMEOUT_MS = 90_000

test('setup wizard core wraps indices and waits for exit before resolving', async () => {
  const controller =
    createSetupWizardCompletionController<{ selected: string }>({
      unexpectedExitMessage: 'expected exit guard',
    })

  const waitForResult = controller.waitForResult()
  let settled = false
  waitForResult.then(() => {
    settled = true
  })

  controller.submit({ selected: 'codex' })
  await Promise.resolve()
  assert.equal(settled, false)

  controller.completeExit()

  assert.deepEqual(await waitForResult, { selected: 'codex' })
  assert.equal(wrapSetupWizardIndex(0, 0, 3), 0)
  assert.equal(wrapSetupWizardIndex(0, 4, -1), 3)
  assert.equal(wrapSetupWizardIndex(3, 4, 2), 1)
})

test('setup wizard completion controller rejects unexpected exits and preserves the first terminal state', async () => {
  const controller = createSetupWizardCompletionController<string>({
    unexpectedExitMessage: 'wizard exited early',
  })

  controller.completeExit()

  await assert.rejects(controller.waitForResult(), /wizard exited early/u)

  controller.submit('late')
  controller.fail(new Error('ignored'))

  await assert.rejects(controller.waitForResult(), /wizard exited early/u)
})

test('setup wizard scheduled updates keep the starter bundle unless explicitly overridden', () => {
  assert.deepEqual(getDefaultSetupWizardScheduledUpdates(), [
    'environment-health-watch',
    'weekly-health-snapshot',
  ])
  assert.deepEqual(resolveSetupWizardInitialScheduledUpdates(undefined), [
    'environment-health-watch',
    'weekly-health-snapshot',
  ])
  assert.deepEqual(resolveSetupWizardInitialScheduledUpdates([]), [])
  assert.deepEqual(
    resolveSetupWizardInitialScheduledUpdates(['weekly-health-snapshot']),
    ['weekly-health-snapshot'],
  )
  assert.deepEqual(
    toggleSetupWizardScheduledUpdate(
      ['environment-health-watch'],
      'weekly-health-snapshot',
    ),
    ['environment-health-watch', 'weekly-health-snapshot'],
  )
  assert.deepEqual(
    toggleSetupWizardScheduledUpdate(
      ['environment-health-watch', 'weekly-health-snapshot'],
      'environment-health-watch',
    ),
    ['weekly-health-snapshot'],
  )
})

test('setup wizard selection toggles keep channels and wearables in canonical order', () => {
  assert.deepEqual(toggleSetupWizardChannel([], 'telegram'), ['telegram'])
  assert.deepEqual(toggleSetupWizardChannel(['telegram'], 'telegram'), [])
  assert.deepEqual(toggleSetupWizardWearable(['whoop'], 'garmin'), [
    'garmin',
    'whoop',
  ])
  assert.deepEqual(toggleSetupWizardWearable(['garmin', 'oura'], 'garmin'), ['oura'])
})

test('setup wizard exposes Venice through the registry-backed assistant selection', () => {
  assert.equal(
    inferSetupWizardAssistantProvider({
      modelProvider: ' Venice ',
      oss: false,
      preset: 'codex',
    }),
    'venice',
  )
  assert.ok(
    listSetupWizardAssistantProviderOptions().some(
      (option) =>
        option.provider === 'venice' &&
        option.title === 'Venice.ai' &&
        /API key/u.test(option.description),
    ),
  )
  assert.deepEqual(
    resolveSetupWizardAssistantSelection({
      method: 'venice',
      provider: 'venice',
    }),
    {
      detail: 'Murph will ask which Venice model id to save next.',
      methodLabel: null,
      modelProvider: 'venice',
      oss: false,
      preset: 'codex',
      providerLabel: 'Venice.ai',
      summary: 'Venice.ai',
    },
  )
})

test('setup wizard exported defaults and wrapper controller keep platform-specific decisions stable', async () => {
  assert.deepEqual(getDefaultSetupWizardChannels('darwin'), [])
  assert.deepEqual(getDefaultSetupWizardChannels('linux'), [])
  assert.deepEqual(getDefaultSetupWizardWearables(), [])
  assert.deepEqual(
    resolveSetupWizardInitialScheduledUpdates([
      'weekly-health-snapshot',
      'environment-health-watch',
      'weekly-health-snapshot',
      'unknown-preset',
    ]),
    [
      'environment-health-watch',
      'weekly-health-snapshot',
      'unknown-preset',
    ],
  )

  const controller = createSetupWizardController()
  controller.completeExit()

  await assert.rejects(
    controller.waitForResult(),
    /Murph setup wizard exited unexpectedly\./u,
  )
})

test.sequential('setup wizard preserves an explicit empty channel selection on darwin', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      initialAssistantPreset: 'skip',
      initialChannels: [],
      platform: 'darwin',
      vault: './wizard-explicit-empty-channels',
    })

    await flush()
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /How should Murph answer\?/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Chat channels/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Review your setup/u)
    await writeInput('\r')

    assert.deepEqual(await wizardResultPromise, {
      assistantModelProvider: null,
      assistantOss: null,
      assistantPreset: 'skip',
      channels: [],
      scheduledUpdates: [
        'environment-health-watch',
        'weekly-health-snapshot',
      ],
      wearables: [],
    })
  })
}, WIZARD_TEST_TIMEOUT_MS)

test.sequential('setup wizard wrapper rejects when Ink render throws before initialization completes', async () => {
  const renderError = new Error('render failed')

  vi.resetModules()
  vi.doMock('ink', async () => {
    const actual = await vi.importActual<typeof import('ink')>('ink')
    return {
      ...actual,
      render() {
        throw renderError
      },
    }
  })

  try {
    const { runSetupWizard: runMockedSetupWizard } = await import(
      '../src/setup-wizard.ts'
    )

    await assert.rejects(
      runMockedSetupWizard({
        vault: './wizard-render-failure',
      }),
      /render failed/u,
    )
  } finally {
    vi.doUnmock('ink')
    vi.resetModules()
  }
}, WIZARD_TEST_TIMEOUT_MS)

test.sequential('setup wizard wrapper rejects when Ink exits with an error after rendering', async () => {
  const exitError = new Error('terminal crashed')

  vi.resetModules()
  vi.doMock('ink', async () => {
    const actual = await vi.importActual<typeof import('ink')>('ink')
    return {
      ...actual,
      render() {
        return {
          unmount() {},
          waitUntilExit() {
            return Promise.reject(exitError)
          },
        }
      },
    }
  })

  try {
    const { runSetupWizard: runMockedSetupWizard } = await import(
      '../src/setup-wizard.ts'
    )

    await assert.rejects(
      runMockedSetupWizard({
        vault: './wizard-exit-failure',
      }),
      /terminal crashed/u,
    )
  } finally {
    vi.doUnmock('ink')
    vi.resetModules()
  }
}, WIZARD_TEST_TIMEOUT_MS)

test('setup wizard extracted option and public-url helpers keep labels and trimming stable', () => {
  assert.equal(formatSetupChannel('telegram'), 'Telegram')
  assert.equal(formatSetupWearable('garmin'), 'Garmin')
  assert.equal(formatSetupWearable('oura'), 'Oura')
  assert.equal(formatSetupScheduledUpdate('environment-health-watch'), 'Environment health watch')
  assert.equal(formatSetupScheduledUpdate('custom-update'), 'custom-update')
  assert.equal(formatSetupPublicUrlStrategy('local'), 'Local callbacks')
  assert.equal(formatSetupPublicUrlStrategy('hosted'), 'Hosted web app')
  assert.equal(formatSetupPublicUrlStrategy('tunnel'), 'Webhook tunnel')
  assert.equal(normalizeSetupWizardText('  https://murph.example  '), 'https://murph.example')
  assert.equal(normalizeSetupWizardText('   '), null)
  assert.equal(normalizeSetupWizardText(undefined), null)
})

test('setup wizard runtime-status helpers preserve defaulting, detail copy, and badge tones', () => {
  const defaultStatus = normalizeSetupWizardRuntimeStatus(undefined)
  assert.deepEqual(defaultStatus, {
    badge: 'optional',
    detail: '',
    missingEnv: [],
    ready: true,
  })
  assert.equal(
    describeSetupWizardRuntimeStatus(defaultStatus),
    'Ready to connect now.',
  )
  assert.deepEqual(buildSetupWizardRuntimeBadges(defaultStatus), [
    { label: 'optional', tone: 'success' },
  ])

  const needsEnvStatus = resolveSetupWizardChannelStatus(
    {
      telegram: {
        badge: 'needs env',
        detail: 'Missing bot token.',
        missingEnv: ['TELEGRAM_BOT_TOKEN'],
        ready: false,
      },
    },
    'telegram',
  )
  assert.equal(
    describeSetupWizardRuntimeStatus(needsEnvStatus),
    'Needs TELEGRAM_BOT_TOKEN before this can connect.',
  )
  assert.deepEqual(buildSetupWizardRuntimeBadges(needsEnvStatus), [
    { label: 'needs env', tone: 'warn' },
  ])

  const macosStatus = resolveSetupWizardWearableStatus(
    {
      whoop: {
        badge: 'macOS only',
        detail: 'Unavailable on Linux.',
        missingEnv: [],
        ready: false,
      },
    },
    'whoop',
  )
  assert.equal(
    describeSetupWizardRuntimeStatus(macosStatus),
    'Only available on macOS.',
  )
  assert.deepEqual(buildSetupWizardRuntimeBadges(macosStatus), [
    { label: 'macOS only', tone: 'accent' },
  ])
})

test.sequential('setup wizard carries Codex local selection into confirm review', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      initialAssistantOss: true,
      initialAssistantPreset: 'codex',
      platform: 'linux',
      vault: './wizard-codex-local',
    })

    const introOutput = await waitForRenderedText(flush, readOutput, /Before you start/u)
    assert.match(introOutput, /Before you start/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /How should Murph answer\?/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Chat channels/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\r')

    const confirmOutput = await waitForRenderedText(flush, readOutput, /Review/u)
    assert.match(confirmOutput, /Review your setup/u)
    assert.match(confirmOutput, /Assistant: Codex local model/u)

    await writeInput('\r')

    assert.deepEqual(await wizardResultPromise, {
      assistantModelProvider: null,
      assistantOss: true,
      assistantPreset: 'codex',
      channels: [],
      scheduledUpdates: [
        'environment-health-watch',
        'weekly-health-snapshot',
      ],
      wearables: [],
    })
  })
}, WIZARD_TEST_TIMEOUT_MS)

test.sequential('setup wizard preserves current provider-backed Codex selection', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      initialAssistantModelProvider: 'vercel-ai-gateway',
      initialAssistantOss: false,
      initialAssistantPreset: 'codex',
      platform: 'linux',
      vault: './wizard-vercel-gateway',
    })

    await flush()
    await writeInput('\r')
    const assistantOutput = await waitForRenderedText(
      flush,
      readOutput,
      /How should Murph answer\?/u,
    )
    assert.match(assistantOutput, /Vercel AI Gateway/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Chat channels/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\r')
    const confirmOutput = await waitForRenderedText(
      flush,
      readOutput,
      /Review your setup/u,
    )
    assert.match(confirmOutput, /Assistant: Vercel AI Gateway/u)

    await writeInput('\r')

    assert.deepEqual(await wizardResultPromise, {
      assistantModelProvider: 'vercel-ai-gateway',
      assistantOss: false,
      assistantPreset: 'codex',
      channels: [],
      scheduledUpdates: [
        'environment-health-watch',
        'weekly-health-snapshot',
      ],
      wearables: [],
    })
  })
}, WIZARD_TEST_TIMEOUT_MS)

test('setup wizard public URL guidance keeps local callbacks when a public webhook base is already set', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['oura'],
    publicBaseUrl: 'https://murph.example/device-sync/',
    deviceSyncLocalBaseUrl: ' http://127.0.0.1:8788 ',
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'local')
  assert.match(review.summary, /callbacks can stay on localhost/u)
  assert.deepEqual(
    review.targets.map((target) => [
      target.label,
      target.localReceiverUrl,
      target.providerUrl,
      target.requirement,
    ]),
    [
      [
        'Oura callback',
        'http://127.0.0.1:8788/oauth/oura/callback',
        'http://127.0.0.1:8788/oauth/oura/callback',
        'required',
      ],
      [
        'Oura webhook',
        'http://127.0.0.1:8788/webhooks/oura',
        'https://murph.example/device-sync/webhooks/oura',
        'optional',
      ],
    ],
  )
  assert.deepEqual(review.tunnelCommands, [])
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'local',
    }),
    'Register the shown localhost OAuth callback URLs. Only add a public HTTPS URL for optional provider webhooks.',
  )
})

test('setup wizard public URL guidance keeps callbacks local and webhooks public', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['garmin', 'oura'],
    deviceSyncLocalBaseUrl: ' http://127.0.0.1:8788 ',
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'local')
  assert.match(review.summary, /callbacks can stay on localhost/u)
  assert.deepEqual(
    review.targets.map((target) => [
      target.label,
      target.localReceiverUrl,
      target.providerUrl,
      target.requirement,
    ]),
    [
      [
        'Junction callback',
        'http://127.0.0.1:8788/connect/junction/callback',
        'http://127.0.0.1:8788/connect/junction/callback',
        'required',
      ],
      [
        'Oura callback',
        'http://127.0.0.1:8788/oauth/oura/callback',
        'http://127.0.0.1:8788/oauth/oura/callback',
        'required',
      ],
      [
        'Oura webhook',
        'http://127.0.0.1:8788/webhooks/oura',
        'https://<your-public-host>/webhooks/oura',
        'optional',
      ],
    ],
  )
  assert.deepEqual(review.providerDocs.map((link) => link.label), [
    'Junction dashboard',
    'Oura auth docs',
  ])
  assert.deepEqual(review.tunnelCommands, [
    'ngrok http 8788',
    'cloudflared tunnel --url http://127.0.0.1:8788',
  ])
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'local',
    }),
    'Register the shown localhost OAuth callback URLs. Only add a public HTTPS URL for optional provider webhooks.',
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'hosted',
    }),
    'Use hosted `apps/web` only when you intentionally run the hosted receiver. For local setup, keep OAuth callbacks on localhost and use public HTTPS only for webhook targets.',
  )
})

test('setup wizard public URL guidance stays disabled when no public callbacks are needed', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: [],
  })

  assert.equal(review.enabled, false)
  assert.equal(review.recommendedStrategy, 'local')
  assert.deepEqual(review.targets, [])
  assert.equal(review.summary, '')
})

test('setup wizard public URL help text renders warnings, docs, and provider-less targets', () => {
  const lines = buildSetupWizardPublicUrlHelpText({
    review: {
      enabled: true,
      providerDocs: [
        {
          label: 'WHOOP OAuth docs',
          url: 'https://developer.whoop.com/docs/developing/oauth/',
        },
      ],
      recommendedStrategy: 'local',
      summary: 'Device OAuth callbacks can stay on localhost.',
      targets: [
        {
          detail: 'Register this redirect URL in the WHOOP dashboard.',
          label: 'WHOOP callback',
          localReceiverUrl: 'http://127.0.0.1:8788/oauth/whoop/callback',
          providerUrl: 'http://127.0.0.1:8788/oauth/whoop/callback',
          requirement: 'required',
        },
      ],
      tunnelCommands: ['ngrok http 8788'],
    },
  })

  assert.deepEqual(lines, [
    'Device OAuth callbacks can stay on localhost.',
    '',
    'OAuth callbacks can use Murph’s localhost receiver for local setup. Only provider webhooks need a public HTTPS URL from a tunnel or hosted deployment.',
    '',
    'Webhook tunnel path:',
    '  Use the tunnel URL only for provider webhook fields. Keep OAuth callback fields on localhost; do not use the tunnel for control routes.',
    '  ngrok http 8788',
    '',
    'WHOOP callback (required)',
    '  Local receiver: http://127.0.0.1:8788/oauth/whoop/callback',
    '  Paste into provider: http://127.0.0.1:8788/oauth/whoop/callback',
    '  Register this redirect URL in the WHOOP dashboard.',
    '',
    'Provider setup docs:',
    '  WHOOP OAuth docs: https://developer.whoop.com/docs/developing/oauth/',
    '',
    'This step is informational only. Murph does not save a public URL choice yet.',
  ])

  assert.deepEqual(
    buildSetupWizardPublicUrlHelpText({
      review: {
        enabled: false,
        providerDocs: [],
        recommendedStrategy: 'local',
        summary: '',
        targets: [],
        tunnelCommands: [],
      },
    }),
    [],
  )
})

test('setup wizard public URL guidance trims local endpoints and lists WHOOP targets when wearables need a tunnel', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['whoop'],
    publicBaseUrl: '   ',
    deviceSyncLocalBaseUrl: ' http://127.0.0.1:9797/base/ ',
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'local')
  assert.match(review.summary, /callbacks can stay on localhost/u)
  assert.deepEqual(
    review.targets.map((target) => [
      target.label,
      target.localReceiverUrl,
      target.providerUrl,
      target.requirement,
    ]),
    [
      [
        'WHOOP callback',
        'http://127.0.0.1:9797/oauth/whoop/callback',
        'http://127.0.0.1:9797/oauth/whoop/callback',
        'required',
      ],
      [
        'WHOOP webhook',
        'http://127.0.0.1:9797/webhooks/whoop',
        'https://<your-public-host>/webhooks/whoop',
        'optional',
      ],
    ],
  )
  assert.deepEqual(review.providerDocs.map((link) => link.label), [
    'WHOOP OAuth docs',
    'WHOOP webhook docs',
  ])
  assert.deepEqual(review.tunnelCommands, [
    'ngrok http 9797',
    'cloudflared tunnel --url http://127.0.0.1:9797',
  ])
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'local',
    }),
    'Register the shown localhost OAuth callback URLs. Only add a public HTTPS URL for optional provider webhooks.',
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'tunnel',
    }),
    'Expose the local webhook routes through a tunnel. Keep OAuth callbacks on localhost, then paste the public HTTPS tunnel URL only for webhook targets.',
  )
})

test('setup wizard public URL guidance includes Strava callback and webhook targets', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['strava'],
    deviceSyncLocalBaseUrl: ' http://127.0.0.1:8788/base/ ',
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'local')
  assert.deepEqual(
    review.targets.map((target) => [
      target.label,
      target.localReceiverUrl,
      target.providerUrl,
      target.requirement,
    ]),
    [
      [
        'Strava callback',
        'http://127.0.0.1:8788/oauth/strava/callback',
        'http://127.0.0.1:8788/oauth/strava/callback',
        'required',
      ],
      [
        'Strava webhook',
        'http://127.0.0.1:8788/webhooks/strava',
        'https://<your-public-host>/webhooks/strava',
        'optional',
      ],
    ],
  )
  assert.deepEqual(review.providerDocs.map((link) => link.label), [
    'Strava auth docs',
    'Strava webhook docs',
  ])
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'local',
    }),
    'Register the shown localhost OAuth callback URLs. Only add a public HTTPS URL for optional provider webhooks.',
  )
})

test('setup wizard public URL guidance stays enabled when the configured public base is localhost', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['oura'],
    publicBaseUrl: 'http://localhost:8788',
  })

  assert.equal(review.enabled, true)
  assert.equal(review.targets[0]?.providerUrl, 'http://localhost:8788/oauth/oura/callback')
})

test('setup wizard public URL guidance handles invalid public URLs and tunnel command edge cases', () => {
  const invalidPublicBaseReview = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['garmin'],
    publicBaseUrl: 'ftp://murph.example',
  })
  assert.equal(invalidPublicBaseReview.enabled, true)
  assert.equal(
    invalidPublicBaseReview.targets[0]?.providerUrl,
    'http://localhost:8788/connect/junction/callback',
  )

  const httpPublicBaseReview = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['whoop'],
    publicBaseUrl: 'http://murph.example',
  })
  assert.equal(
    httpPublicBaseReview.targets[1]?.providerUrl,
    'https://<your-public-host>/webhooks/whoop',
  )

  const ipv6LoopbackReview = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['oura'],
    publicBaseUrl: 'https://[::1]:8788',
  })
  assert.equal(ipv6LoopbackReview.enabled, true)

  const httpTunnelReview = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['oura'],
    deviceSyncLocalBaseUrl: 'http://127.0.0.1/base',
  })
  assert.deepEqual(httpTunnelReview.tunnelCommands, [
    'ngrok http 80',
    'cloudflared tunnel --url http://127.0.0.1',
  ])

  const httpsTunnelReview = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['oura'],
    deviceSyncLocalBaseUrl: 'https://127.0.0.1/base',
  })
  assert.deepEqual(httpsTunnelReview.tunnelCommands, [
    'ngrok http 443',
    'cloudflared tunnel --url https://127.0.0.1',
  ])

  const unsupportedTunnelReview = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['oura'],
    deviceSyncLocalBaseUrl: 'ws://127.0.0.1/base',
  })
  assert.deepEqual(unsupportedTunnelReview.tunnelCommands, [
    'ngrok http 8788',
    'cloudflared tunnel --url http://localhost:8788',
  ])
})

test.sequential('setup wizard runs the public-link flow, preserves explicit opt-outs, and returns sorted selections', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      channelStatuses: {},
      initialAssistantPreset: 'skip',
      initialChannels: [],
      initialScheduledUpdates: [],
      initialWearables: [],
      platform: 'linux',
      vault: './wizard-public-links',
      wearableStatuses: {
        whoop: {
          badge: 'needs env',
          detail: 'Missing WHOOP client credentials.',
          missingEnv: ['WHOOP_CLIENT_ID', 'WHOOP_CLIENT_SECRET'],
          ready: false,
        },
      },
    })

    await flush()
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /How should Murph answer\?/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Chat channels/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\u001B[A')
    await waitForRenderedText(flush, readOutput, /› □ WHOOP/u)
    await writeInput(' ')
    await waitForRenderedText(flush, readOutput, /› ■ WHOOP/u)
    await writeInput('\r')
    const publicLinkOutput = await waitForRenderedText(
      flush,
      readOutput,
      /Public links/u,
    )
    assert.match(publicLinkOutput, /Public links/u)
    assert.match(publicLinkOutput, /WHOOP callback \(required\)/u)
    assert.match(publicLinkOutput, /WHOOP webhook \(optional\)/u)
    assert.match(
      publicLinkOutput,
      /Local receiver: http:\/\/localhost:8788\/oauth\/whoop\/callback/u,
    )
    assert.match(
      publicLinkOutput,
      /Paste into provider: http:\/\/localhost:8788\/oauth\/whoop\/callback/u,
    )
    assert.match(publicLinkOutput, /Webhook tunnel path/u)
    assert.match(publicLinkOutput, /ngrok http 8788/u)
    assert.match(
      publicLinkOutput,
      /cloudflared tunnel --url http:\/\/localhost:8788/u,
    )
    assert.match(publicLinkOutput, /WHOOP OAuth docs/u)
    assert.match(
      publicLinkOutput,
      /This step is informational only\. Murph does not save a public URL choice yet\./u,
    )

    await writeInput('\u001B')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Public links/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Review your setup/u)
    await writeInput('\r')

    await assert.doesNotReject(wizardResultPromise)
    assert.deepEqual(await wizardResultPromise, {
      assistantModelProvider: null,
      assistantOss: null,
      assistantPreset: 'skip',
      channels: [],
      scheduledUpdates: [],
      wearables: ['whoop'],
    })
  })
}, WIZARD_TEST_TIMEOUT_MS)

test.sequential('setup wizard keeps Codex cloud review guidance when no public-link step is needed', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      initialAssistantOss: false,
      initialAssistantPreset: 'codex',
      platform: 'linux',
      vault: './wizard-codex',
    })

    await flush()
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /How should Murph answer\?/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Chat channels/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\r')
    const confirmOutput = await waitForRenderedText(
      flush,
      readOutput,
      /Review your setup/u,
    )
    assert.match(confirmOutput, /Assistant: ChatGPT \/ Codex sign-in/u)
    assert.match(confirmOutput, /Needs keys first: None/u)

    await writeInput('\u001B[D')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Review your setup/u)
    await writeInput('\r')

    assert.deepEqual(await wizardResultPromise, {
      assistantModelProvider: null,
      assistantOss: false,
      assistantPreset: 'codex',
      channels: [],
      scheduledUpdates: [
        'environment-health-watch',
        'weekly-health-snapshot',
      ],
      wearables: [],
    })
  })
}, WIZARD_TEST_TIMEOUT_MS)

test.sequential('setup wizard surfaces cancellation when the operator quits from the intro screen', async () => {
  await withMockProcessTty(async ({ flush, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      vault: './wizard-cancelled',
    })
    const rejection = assert.rejects(
      wizardResultPromise,
      /Murph setup was cancelled\./u,
    )

    await flush()
    await writeInput('q')

    await rejection
  })
}, WIZARD_TEST_TIMEOUT_MS)

test.sequential('setup wizard surfaces cancellation when the operator presses escape on the intro screen', async () => {
  await withMockProcessTty(async ({ flush, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      vault: './wizard-cancelled-escape',
    })
    const rejection = assert.rejects(
      wizardResultPromise,
      /Murph setup was cancelled\./u,
    )

    await flush()
    await writeInput('\u001B')

    await rejection
  })
}, WIZARD_TEST_TIMEOUT_MS)

test.sequential('setup wizard accepts wrapped selection navigation plus space-based public-link and confirm actions', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      channelStatuses: {},
      initialAssistantPreset: 'skip',
      initialChannels: [],
      initialScheduledUpdates: [],
      initialWearables: [],
      platform: 'linux',
      vault: './wizard-public-links-space',
      wearableStatuses: {
        whoop: {
          badge: 'needs env',
          detail: 'Missing WHOOP client credentials.',
          missingEnv: ['WHOOP_CLIENT_ID'],
          ready: false,
        },
      },
    })

    await flush()
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /How should Murph answer\?/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Chat channels/u)
    await writeInput('\u001B[A')
    await writeInput('\u001B[B')
    await writeInput('\u001B[B')
    await writeInput('\u001B[B')
    await waitForRenderedText(flush, readOutput, /› □ Telegram/u)
    await writeInput(' ')
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Health data/u)
    await writeInput('\u001B[A')
    await waitForRenderedText(flush, readOutput, /› □ WHOOP/u)
    await writeInput(' ')
    await writeInput('\r')
    await waitForRenderedText(flush, readOutput, /Public links/u)
    await writeInput(' ')
    await waitForRenderedText(flush, readOutput, /Review your setup/u)
    await writeInput('\u001B')
    await waitForRenderedText(flush, readOutput, /Public links/u)
    await writeInput(' ')
    await waitForRenderedText(flush, readOutput, /Review your setup/u)
    await writeInput(' ')

    assert.deepEqual(await wizardResultPromise, {
      assistantModelProvider: null,
      assistantOss: null,
      assistantPreset: 'skip',
      channels: ['telegram'],
      scheduledUpdates: [],
      wearables: ['whoop'],
    })
  })
}, WIZARD_TEST_TIMEOUT_MS)
