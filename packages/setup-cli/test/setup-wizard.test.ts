import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  buildSetupWizardPublicUrlReview,
  describeSetupWizardPublicUrlStrategyChoice,
  getDefaultSetupWizardScheduledUpdates,
  resolveSetupWizardInitialScheduledUpdates,
  toggleSetupWizardChannel,
  toggleSetupWizardScheduledUpdate,
  toggleSetupWizardWearable,
} from '../src/setup-wizard.js'
import {
  createSetupWizardCompletionController,
  wrapSetupWizardIndex,
} from '../src/setup-wizard-core.js'

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
