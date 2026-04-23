import type {
  SetupChannel,
  SetupWearable,
} from '@murphai/operator-config/setup-cli-contracts'
import { sortSetupWizardWearables } from './setup-wizard-options.js'

const DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL = 'http://localhost:8788'
const SETUP_PUBLIC_URL_PLACEHOLDER_HOST = 'https://<your-public-host>'
const DEFAULT_SETUP_DEVICE_SYNC_TUNNEL_COMMANDS = [
  'ngrok http 8788',
  'cloudflared tunnel --url http://localhost:8788',
] as const

const SETUP_PROVIDER_DOCS = {
  garmin: [
    {
      label: 'Garmin setup docs',
      url: 'https://developer.garmin.com/gc-developer-program/overview/',
    },
  ],
  oura: [
    {
      label: 'Oura auth docs',
      url: 'https://cloud.ouraring.com/docs/authentication',
    },
  ],
  strava: [
    {
      label: 'Strava auth docs',
      url: 'https://developers.strava.com/docs/authentication',
    },
    {
      label: 'Strava webhook docs',
      url: 'https://developers.strava.com/docs/webhooks/',
    },
  ],
  whoop: [
    {
      label: 'WHOOP OAuth docs',
      url: 'https://developer.whoop.com/docs/developing/oauth/',
    },
    {
      label: 'WHOOP webhook docs',
      url: 'https://developer.whoop.com/docs/developing/webhooks/',
    },
  ],
} as const satisfies Record<
  SetupWearable,
  ReadonlyArray<{
    label: string
    url: string
  }>
>

export type SetupPublicUrlStrategy = 'hosted' | 'tunnel'
export type SetupWizardPublicUrlRequirement = 'required' | 'optional'

export interface SetupWizardPublicUrlDocLink {
  label: string
  url: string
}

export interface SetupWizardPublicUrlTarget {
  detail: string
  label: string
  localReceiverUrl: string
  providerUrl: string | null
  requirement: SetupWizardPublicUrlRequirement
}

export interface SetupWizardPublicUrlReview {
  enabled: boolean
  providerDocs: SetupWizardPublicUrlDocLink[]
  recommendedStrategy: SetupPublicUrlStrategy
  summary: string
  targets: SetupWizardPublicUrlTarget[]
  tunnelCommands: string[]
}

export function buildSetupWizardPublicUrlReview(input: {
  channels: readonly SetupChannel[]
  wearables: readonly SetupWearable[]
  publicBaseUrl?: string | null
  deviceSyncLocalBaseUrl?: string | null
}): SetupWizardPublicUrlReview {
  const publicBaseUrl = normalizeSetupWizardText(input.publicBaseUrl)
  const selectedWearables = sortSetupWizardWearables(input.wearables)
  const needsPublicStrategy = selectedWearables.length > 0
  const deviceSyncLocalBaseUrl =
    normalizeSetupWizardText(input.deviceSyncLocalBaseUrl) ??
    DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL

  if (!needsPublicStrategy || isConfiguredPublicBaseUrl(publicBaseUrl)) {
    return {
      enabled: false,
      providerDocs: [],
      recommendedStrategy: 'hosted',
      summary: '',
      targets: [],
      tunnelCommands: [],
    }
  }

  return {
    enabled: true,
    providerDocs: buildSetupWizardProviderDocs(selectedWearables),
    recommendedStrategy:
      selectedWearables.length > 0 ? 'hosted' : 'tunnel',
    summary: describeSetupWizardPublicUrlSummary({
      wearables: selectedWearables,
    }),
    targets: buildSetupWizardPublicUrlTargets({
      wearables: selectedWearables,
      deviceSyncLocalBaseUrl,
    }),
    tunnelCommands:
      selectedWearables.length > 0
        ? buildSetupWizardDeviceSyncTunnelCommands(deviceSyncLocalBaseUrl)
        : [],
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
    return 'Use hosted `apps/web` for Garmin/WHOOP/Oura/Strava so callbacks stay on one stable public base.'
  }

  return 'Expose the local callback routes through a tunnel. Keep Murph listening on localhost, then paste the public HTTPS tunnel URL into each provider.'
}

export function formatSetupPublicUrlStrategy(strategy: SetupPublicUrlStrategy): string {
  return strategy === 'hosted' ? 'Hosted web app' : 'Local tunnel'
}

export function buildSetupWizardPublicUrlHelpText(input: {
  review: SetupWizardPublicUrlReview
}): string[] {
  if (!input.review.enabled) {
    return []
  }

  const lines = [
    input.review.summary,
    '',
  ]

  if (hasSetupWizardWearablePublicUrlTargets(input.review.targets)) {
    lines.push(
      '`localhost` is only Murph’s local receiver. Do not paste a localhost URL into Garmin, WHOOP, Oura, or Strava. Use a public HTTPS URL from a tunnel or hosted deployment instead.',
      '',
    )
  }

  if (input.review.tunnelCommands.length > 0) {
    lines.push(
      'Local test path:',
      ...input.review.tunnelCommands.map((command) => `  ${command}`),
      '',
    )
  }

  for (const [index, target] of input.review.targets.entries()) {
    if (index > 0) {
      lines.push('')
    }
    lines.push(...formatSetupWizardPublicUrlTargetHelpLines(target))
  }

  if (input.review.providerDocs.length > 0) {
    lines.push(
      '',
      'Provider setup docs:',
      ...input.review.providerDocs.map((link) => `  ${link.label}: ${link.url}`),
    )
  }

  lines.push(
    '',
    'This step is informational only. Murph does not save a public URL choice yet.',
  )

  return lines
}

function describeSetupWizardPublicUrlSummary(input: {
  wearables: readonly SetupWearable[]
}): string {
  if (input.wearables.length > 0) {
    return 'Garmin/WHOOP/Oura/Strava need a public callback URL. Hosted `apps/web` is the easiest stable base.'
  }

  return ''
}

function buildSetupWizardPublicUrlTargets(input: {
  wearables: readonly SetupWearable[]
  deviceSyncLocalBaseUrl: string
}): SetupWizardPublicUrlTarget[] {
  const targets: SetupWizardPublicUrlTarget[] = []

  if (input.wearables.includes('garmin')) {
    const localReceiverUrl = new URL(
      '/oauth/garmin/callback',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Required. Register this public callback URL in your Garmin app setup before you connect Garmin.',
      label: 'Garmin callback',
      localReceiverUrl,
      providerUrl: buildSetupWizardPublicProviderUrl(localReceiverUrl),
      requirement: 'required',
    })
  }

  if (input.wearables.includes('whoop')) {
    const callbackUrl = new URL(
      '/oauth/whoop/callback',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Required. Register this public redirect URL in the WHOOP Developer Dashboard.',
      label: 'WHOOP callback',
      localReceiverUrl: callbackUrl,
      providerUrl: buildSetupWizardPublicProviderUrl(callbackUrl),
      requirement: 'required',
    })

    const webhookUrl = new URL(
      '/webhooks/whoop',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Optional. Add this public webhook URL only if you want realtime WHOOP updates.',
      label: 'WHOOP webhook',
      localReceiverUrl: webhookUrl,
      providerUrl: buildSetupWizardPublicProviderUrl(webhookUrl),
      requirement: 'optional',
    })
  }

  if (input.wearables.includes('oura')) {
    const callbackUrl = new URL(
      '/oauth/oura/callback',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Required. Oura redirect URIs must match this public callback URL exactly.',
      label: 'Oura callback',
      localReceiverUrl: callbackUrl,
      providerUrl: buildSetupWizardPublicProviderUrl(callbackUrl),
      requirement: 'required',
    })

    const webhookUrl = new URL(
      '/webhooks/oura',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Optional today. Oura can work without webhooks; use this public URL only if you enable Oura webhooks.',
      label: 'Oura webhook',
      localReceiverUrl: webhookUrl,
      providerUrl: buildSetupWizardPublicProviderUrl(webhookUrl),
      requirement: 'optional',
    })
  }

  if (input.wearables.includes('strava')) {
    const callbackUrl = new URL(
      '/oauth/strava/callback',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Required for the OAuth redirect. In Strava, keep this callback under your configured callback domain.',
      label: 'Strava callback',
      localReceiverUrl: callbackUrl,
      providerUrl: buildSetupWizardPublicProviderUrl(callbackUrl),
      requirement: 'required',
    })

    const webhookUrl = new URL(
      '/webhooks/strava',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Optional. Strava allows one app-global webhook subscription; use this public URL only if you enable Strava webhooks.',
      label: 'Strava webhook',
      localReceiverUrl: webhookUrl,
      providerUrl: buildSetupWizardPublicProviderUrl(webhookUrl),
      requirement: 'optional',
    })
  }

  return targets
}

function buildSetupWizardProviderDocs(
  wearables: readonly SetupWearable[],
): SetupWizardPublicUrlDocLink[] {
  const docs: SetupWizardPublicUrlDocLink[] = []
  const seen = new Set<string>()

  for (const wearable of wearables) {
    for (const link of SETUP_PROVIDER_DOCS[wearable]) {
      if (seen.has(link.url)) {
        continue
      }
      seen.add(link.url)
      docs.push({ ...link })
    }
  }

  return docs
}

function hasSetupWizardWearablePublicUrlTargets(
  targets: readonly SetupWizardPublicUrlTarget[],
): boolean {
  return targets.length > 0
}

function isConfiguredPublicBaseUrl(value: string | null): boolean {
  if (value === null) {
    return false
  }

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    return !isSetupWizardLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

function isSetupWizardLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase()
  return (
    normalizedHostname === 'localhost'
    || normalizedHostname === '127.0.0.1'
    || normalizedHostname === '::1'
    || normalizedHostname === '[::1]'
  )
}

function buildSetupWizardDeviceSyncTunnelCommands(
  deviceSyncLocalBaseUrl: string,
): string[] {
  try {
    const parsed = new URL(deviceSyncLocalBaseUrl)
    const ngrokPort = resolveSetupWizardTunnelPort(parsed)
    if (ngrokPort === null) {
      return [...DEFAULT_SETUP_DEVICE_SYNC_TUNNEL_COMMANDS]
    }

    return [
      `ngrok http ${ngrokPort}`,
      `cloudflared tunnel --url ${parsed.origin}`,
    ]
  } catch {
    return [...DEFAULT_SETUP_DEVICE_SYNC_TUNNEL_COMMANDS]
  }
}

function resolveSetupWizardTunnelPort(parsed: URL): string | null {
  if (parsed.port) {
    return parsed.port
  }

  switch (parsed.protocol) {
    case 'http:':
      return '80'
    case 'https:':
      return '443'
    default:
      return null
  }
}

function buildSetupWizardPublicProviderUrl(localReceiverUrl: string): string {
  try {
    const parsed = new URL(localReceiverUrl)
    const suffix = `${parsed.pathname}${parsed.search}`
    return `${SETUP_PUBLIC_URL_PLACEHOLDER_HOST}${suffix}`
  } catch {
    return `${SETUP_PUBLIC_URL_PLACEHOLDER_HOST}${localReceiverUrl}`
  }
}

function formatSetupWizardPublicUrlTargetHelpLines(
  target: SetupWizardPublicUrlTarget,
): string[] {
  return [
    `${target.label} (${target.requirement})`,
    `  Local receiver: ${target.localReceiverUrl}`,
    ...(target.providerUrl === null
      ? []
      : [`  Paste into provider: ${target.providerUrl}`]),
    `  ${target.detail}`,
  ]
}

export function normalizeSetupWizardText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}
