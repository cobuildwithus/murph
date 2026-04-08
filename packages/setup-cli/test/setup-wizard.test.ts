import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildSetupWizardPublicUrlReview,
  createSetupWizardCompletionController as createSetupWizardController,
  getDefaultSetupWizardChannels,
  describeSetupWizardPublicUrlStrategyChoice,
  getDefaultSetupWizardScheduledUpdates,
  getDefaultSetupWizardWearables,
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
import { stripAnsi, withMockProcessTty } from './helpers.ts'

async function waitForWizardText(
  flush: () => Promise<void>,
  readOutput: () => string,
  pattern: RegExp,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const output = stripAnsi(readOutput())
    if (pattern.test(output)) {
      return output
    }

    await flush()
  }

  return stripAnsi(readOutput())
}

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
  assert.deepEqual(toggleSetupWizardChannel(['telegram'], 'imessage'), [
    'imessage',
    'telegram',
  ])
  assert.deepEqual(toggleSetupWizardChannel(['imessage', 'telegram'], 'imessage'), [
    'telegram',
  ])
  assert.deepEqual(toggleSetupWizardWearable(['whoop'], 'garmin'), [
    'garmin',
    'whoop',
  ])
  assert.deepEqual(toggleSetupWizardWearable(['garmin', 'oura'], 'garmin'), ['oura'])
})

test('setup wizard exported defaults and wrapper controller keep platform-specific decisions stable', async () => {
  assert.deepEqual(getDefaultSetupWizardChannels('darwin'), ['imessage'])
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

test.sequential('setup wizard uses endpoint-specific method copy and confirm review for named endpoints', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      initialAssistantPreset: 'openai-compatible',
      initialAssistantProviderPreset: 'custom',
      platform: 'linux',
      vault: './wizard-endpoint-provider',
    })

    await flush()
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /How should Murph answer\?/u)
    await writeInput('\r')

    const methodOutput = await waitForWizardText(
      flush,
      readOutput,
      /How should Murph connect to your endpoint\?/u,
    )
    assert.match(
      methodOutput,
      /Choose a manual endpoint or keep the Codex local-model flow\./u,
    )

    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Chat channels/u)
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Health data/u)
    await writeInput('\r')

    const confirmOutput = await waitForWizardText(flush, readOutput, /Review/u)
    assert.match(confirmOutput, /Review your setup/u)
    assert.match(confirmOutput, /Assistant: Custom endpoint · Compatible endpoint/u)

    await writeInput('\r')

    assert.deepEqual(await wizardResultPromise, {
      assistantApiKeyEnv: null,
      assistantBaseUrl: 'http://127.0.0.1:11434/v1',
      assistantOss: false,
      assistantPreset: 'openai-compatible',
      assistantProviderName: null,
      channels: [],
      scheduledUpdates: [
        'environment-health-watch',
        'weekly-health-snapshot',
      ],
      wearables: [],
    })
  })
})

test('setup wizard public URL guidance stays disabled when a public base URL is already set', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: ['linq'],
    wearables: ['oura'],
    publicBaseUrl: 'https://murph.example',
    deviceSyncLocalBaseUrl: ' http://127.0.0.1:8788 ',
    linqLocalWebhookUrl: ' http://127.0.0.1:8789/linq-webhook ',
  })

  assert.equal(review.enabled, false)
  assert.equal(review.recommendedStrategy, 'hosted')
  assert.deepEqual(review.targets, [])
  assert.equal(review.summary, '')
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'hosted',
    }),
    '',
  )
})

test('setup wizard public URL guidance recommends hosted web for wearables and keeps Linq local', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: ['linq'],
    wearables: ['garmin', 'oura'],
    deviceSyncLocalBaseUrl: ' http://127.0.0.1:8788 ',
    linqLocalWebhookUrl: ' http://127.0.0.1:8789/linq-webhook ',
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'hosted')
  assert.match(review.summary, /hosted `apps\/web`/u)
  assert.match(review.summary, /Linq still needs the local inbox webhook/u)
  assert.deepEqual(
    review.targets.map((target) => [target.label, target.url]),
    [
      ['Garmin callback', 'http://127.0.0.1:8788/oauth/garmin/callback'],
      ['Oura callback', 'http://127.0.0.1:8788/oauth/oura/callback'],
      ['Oura webhook', 'http://127.0.0.1:8788/webhooks/oura'],
      ['Linq webhook', 'http://127.0.0.1:8789/linq-webhook'],
    ],
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'hosted',
    }),
    'Use hosted `apps/web` for Garmin/WHOOP/Oura, but keep Linq on the local webhook path for now.',
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'tunnel',
    }),
    'Expose the local callback routes through a tunnel instead of setting up hosted `apps/web` first.',
  )
})

test('setup wizard public URL guidance recommends a tunnel for Linq-only setups', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: ['linq'],
    wearables: [],
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'tunnel')
  assert.match(review.summary, /local inbox webhook/u)
  assert.deepEqual(review.targets.map((target) => target.label), ['Linq webhook'])
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'hosted',
    }),
    'Use hosted `apps/web` for Garmin/WHOOP/Oura, but keep Linq on the local webhook path for now.',
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'tunnel',
    }),
    'Expose the local Linq webhook through a tunnel. Murph does not have a hosted Linq webhook yet.',
  )
})

test('setup wizard public URL guidance stays disabled when no public callbacks are needed', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: [],
  })

  assert.equal(review.enabled, false)
  assert.equal(review.recommendedStrategy, 'hosted')
  assert.deepEqual(review.targets, [])
  assert.equal(review.summary, '')
})

test('setup wizard public URL guidance trims local endpoints and lists WHOOP targets when wearables need a tunnel', () => {
  const review = buildSetupWizardPublicUrlReview({
    channels: [],
    wearables: ['whoop'],
    publicBaseUrl: '   ',
    deviceSyncLocalBaseUrl: ' http://127.0.0.1:9797/base/ ',
    linqLocalWebhookUrl: '   ',
  })

  assert.equal(review.enabled, true)
  assert.equal(review.recommendedStrategy, 'hosted')
  assert.match(review.summary, /public callback URL/u)
  assert.deepEqual(
    review.targets.map((target) => [target.label, target.url]),
    [
      ['WHOOP callback', 'http://127.0.0.1:9797/oauth/whoop/callback'],
      ['WHOOP webhook', 'http://127.0.0.1:9797/webhooks/whoop'],
    ],
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'hosted',
    }),
    'Use hosted `apps/web` for Garmin/WHOOP/Oura so callbacks stay on one stable public base.',
  )
  assert.equal(
    describeSetupWizardPublicUrlStrategyChoice({
      review,
      strategy: 'tunnel',
    }),
    'Expose the local callback routes through a tunnel instead of setting up hosted `apps/web` first.',
  )
})

test.sequential('setup wizard runs the public-link flow, preserves explicit opt-outs, and returns sorted selections', async () => {
  await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
    const wizardResultPromise = runSetupWizard({
      channelStatuses: {
        linq: {
          badge: 'needs env',
          detail: 'Missing webhook credentials.',
          missingEnv: ['LINQ_API_TOKEN', 'LINQ_WEBHOOK_SECRET'],
          ready: false,
        },
      },
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
    await waitForWizardText(flush, readOutput, /How should Murph answer\?/u)
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Auto updates/u)
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Chat channels/u)
    await writeInput('\u001B[B')
    await writeInput('\u001B[B')
    await writeInput(' ')
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Health data/u)
    await writeInput('\u001B[B')
    await writeInput('\u001B[B')
    await writeInput(' ')
    await writeInput('\r')
    const publicLinkOutput = await waitForWizardText(
      flush,
      readOutput,
      /Public links/u,
    )
    assert.match(publicLinkOutput, /Public links/u)
    assert.match(publicLinkOutput, /WHOOP webhook/u)
    assert.match(publicLinkOutput, /Linq webhook/u)
    assert.match(
      publicLinkOutput,
      /This step is informational only\. Murph does not save a public URL choice yet\./u,
    )

    await writeInput('\u001B')
    await waitForWizardText(flush, readOutput, /Health data/u)
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Public links/u)
    await writeInput('\r')
    await waitForWizardText(flush, readOutput, /Review your setup/u)
    await writeInput('\r')

    await assert.doesNotReject(wizardResultPromise)
    assert.deepEqual(await wizardResultPromise, {
      assistantApiKeyEnv: null,
      assistantBaseUrl: null,
      assistantOss: null,
      assistantPreset: 'skip',
      assistantProviderName: null,
      channels: ['linq'],
      scheduledUpdates: [],
      wearables: ['whoop'],
    })
  })
})

test.sequential('setup wizard keeps assistant API-key defaults and review guidance when no public-link step is needed', async () => {
  const previousOpenAiApiKey = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY

  try {
    await withMockProcessTty(async ({ flush, readOutput, writeInput }) => {
      const wizardResultPromise = runSetupWizard({
        initialAssistantApiKeyEnv: '  OPENAI_API_KEY  ',
        initialAssistantBaseUrl: ' https://api.openai.com/v1 ',
        initialAssistantPreset: 'openai-compatible',
        initialAssistantProviderName: ' OpenAI ',
        platform: 'linux',
        vault: './wizard-openai',
      })

      await flush()
      await writeInput('\r')
      await waitForWizardText(flush, readOutput, /How should Murph answer\?/u)
      await writeInput('\r')
      await waitForWizardText(flush, readOutput, /How should Murph connect to OpenAI\?/u)
      await writeInput('\r')
      await waitForWizardText(flush, readOutput, /Auto updates/u)
      await writeInput('\r')
      await waitForWizardText(flush, readOutput, /Chat channels/u)
      await writeInput('\r')
      await waitForWizardText(flush, readOutput, /Health data/u)
      await writeInput('\r')
      const confirmOutput = await waitForWizardText(
        flush,
        readOutput,
        /Needs keys first/u,
      )
      assert.match(confirmOutput, /How should Murph connect to OpenAI\?/u)
      assert.match(confirmOutput, /Needs keys first: Assistant \(OPENAI_API_KEY\)/u)
      assert.match(
        confirmOutput,
        /Murph will ask for any missing keys for this setup run/u,
      )
      assert.match(confirmOutput, /keep your update picks ready for/u)
      assert.match(
        confirmOutput,
        /later, and open anything that can connect right away\./u,
      )

      await writeInput('\u001B[D')
      await waitForWizardText(flush, readOutput, /Health data/u)
      await writeInput('\r')
      await waitForWizardText(flush, readOutput, /Review your setup/u)
      await writeInput('\r')

      assert.deepEqual(await wizardResultPromise, {
        assistantApiKeyEnv: 'OPENAI_API_KEY',
        assistantBaseUrl: 'https://api.openai.com/v1',
        assistantOss: false,
        assistantPreset: 'openai-compatible',
        assistantProviderName: 'OpenAI',
        channels: [],
        scheduledUpdates: [
          'environment-health-watch',
          'weekly-health-snapshot',
        ],
        wearables: [],
      })
    })
  } finally {
    if (previousOpenAiApiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiApiKey
    }
  }
})

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
})
