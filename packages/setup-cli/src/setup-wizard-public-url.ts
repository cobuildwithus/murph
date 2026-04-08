import type {
  SetupChannel,
  SetupWearable,
} from '@murphai/operator-config/setup-cli-contracts'
import { sortSetupWizardWearables } from './setup-wizard-options.js'

const DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL = 'http://localhost:8788'
const DEFAULT_SETUP_LINQ_WEBHOOK_URL = 'http://127.0.0.1:8789/linq-webhook'

export type SetupPublicUrlStrategy = 'hosted' | 'tunnel'

export interface SetupWizardPublicUrlTarget {
  detail: string
  label: string
  url: string
}

export interface SetupWizardPublicUrlReview {
  enabled: boolean
  recommendedStrategy: SetupPublicUrlStrategy
  summary: string
  targets: SetupWizardPublicUrlTarget[]
}

export function buildSetupWizardPublicUrlReview(input: {
  channels: readonly SetupChannel[]
  wearables: readonly SetupWearable[]
  publicBaseUrl?: string | null
  deviceSyncLocalBaseUrl?: string | null
  linqLocalWebhookUrl?: string | null
}): SetupWizardPublicUrlReview {
  const publicBaseUrl = normalizeSetupWizardText(input.publicBaseUrl)
  const hasLinq = input.channels.includes('linq')
  const selectedWearables = sortSetupWizardWearables(input.wearables)
  const needsPublicStrategy = hasLinq || selectedWearables.length > 0
  const deviceSyncLocalBaseUrl =
    normalizeSetupWizardText(input.deviceSyncLocalBaseUrl) ??
    DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL
  const linqLocalWebhookUrl =
    normalizeSetupWizardText(input.linqLocalWebhookUrl) ??
    DEFAULT_SETUP_LINQ_WEBHOOK_URL

  if (!needsPublicStrategy || publicBaseUrl) {
    return {
      enabled: false,
      recommendedStrategy: 'hosted',
      summary: '',
      targets: [],
    }
  }

  return {
    enabled: true,
    recommendedStrategy:
      selectedWearables.length > 0 ? 'hosted' : 'tunnel',
    summary: describeSetupWizardPublicUrlSummary({
      hasLinq,
      wearables: selectedWearables,
    }),
    targets: buildSetupWizardPublicUrlTargets({
      hasLinq,
      wearables: selectedWearables,
      deviceSyncLocalBaseUrl,
      linqLocalWebhookUrl,
    }),
  }
}

export function describeSetupWizardPublicUrlStrategyChoice(input: {
  review: SetupWizardPublicUrlReview
  strategy: SetupPublicUrlStrategy
}): string {
  if (!input.review.enabled) {
    return ''
  }

  if (input.strategy === 'hosted') {
    const hasLinq = input.review.targets.some((target) => target.label === 'Linq webhook')
    return hasLinq
      ? 'Use hosted `apps/web` for Garmin/WHOOP/Oura, but keep Linq on the local webhook path for now.'
      : 'Use hosted `apps/web` for Garmin/WHOOP/Oura so callbacks stay on one stable public base.'
  }

  const hasWearableTargets = input.review.targets.some((target) =>
    target.label.startsWith('Garmin') || target.label.startsWith('WHOOP') || target.label.startsWith('Oura'),
  )
  if (hasWearableTargets) {
    return 'Expose the local callback routes through a tunnel instead of setting up hosted `apps/web` first.'
  }

  return 'Expose the local Linq webhook through a tunnel. Murph does not have a hosted Linq webhook yet.'
}

export function formatSetupPublicUrlStrategy(strategy: SetupPublicUrlStrategy): string {
  return strategy === 'hosted' ? 'Hosted web app' : 'Local tunnel'
}

function describeSetupWizardPublicUrlSummary(input: {
  hasLinq: boolean
  wearables: readonly SetupWearable[]
}): string {
  if (input.wearables.length > 0 && input.hasLinq) {
    return 'Garmin/WHOOP/Oura are easiest through hosted `apps/web`, while Linq still needs the local inbox webhook today.'
  }

  if (input.wearables.length > 0) {
    return 'Garmin/WHOOP/Oura need a public callback URL. Hosted `apps/web` is the easiest stable base.'
  }

  return 'Linq still uses the local inbox webhook today, so a tunnel to your machine is the simplest public path.'
}

function buildSetupWizardPublicUrlTargets(input: {
  hasLinq: boolean
  wearables: readonly SetupWearable[]
  deviceSyncLocalBaseUrl: string
  linqLocalWebhookUrl: string
}): SetupWizardPublicUrlTarget[] {
  const targets: SetupWizardPublicUrlTarget[] = []

  if (input.wearables.includes('garmin')) {
    targets.push({
      label: 'Garmin callback',
      url: new URL('/oauth/garmin/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if Garmin finishes sign-in on your machine through a tunnel.',
    })
  }

  if (input.wearables.includes('whoop')) {
    targets.push({
      label: 'WHOOP callback',
      url: new URL('/oauth/whoop/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if WHOOP sends the callback directly to your machine through a tunnel.',
    })
    targets.push({
      label: 'WHOOP webhook',
      url: new URL('/webhooks/whoop', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if WHOOP sends webhooks straight to your machine through a tunnel.',
    })
  }

  if (input.wearables.includes('oura')) {
    targets.push({
      label: 'Oura callback',
      url: new URL('/oauth/oura/callback', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Use this if Oura finishes sign-in on your machine through a tunnel.',
    })
    targets.push({
      label: 'Oura webhook',
      url: new URL('/webhooks/oura', input.deviceSyncLocalBaseUrl).toString(),
      detail: 'Optional today. Oura can still work without this, but this is the local webhook URL if you enable it.',
    })
  }

  if (input.hasLinq) {
    targets.push({
      label: 'Linq webhook',
      url: input.linqLocalWebhookUrl,
      detail: 'Point your tunnel here. Hosted `apps/web` does not replace this Linq webhook yet.',
    })
  }

  return targets
}

export function normalizeSetupWizardText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
