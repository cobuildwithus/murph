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
      label: 'Junction dashboard',
      url: 'https://app.junction.com/',
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

export type SetupPublicUrlStrategy = 'local' | 'hosted' | 'tunnel'
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
  const publicBaseUrl = resolveSetupWizardConfiguredPublicBaseUrl(
    input.publicBaseUrl,
  )
  const selectedWearables = sortSetupWizardWearables(input.wearables)
  const needsUrlReview = selectedWearables.length > 0
  const deviceSyncLocalBaseUrl =
    normalizeSetupWizardText(input.deviceSyncLocalBaseUrl) ??
    DEFAULT_SETUP_DEVICE_SYNC_LOCAL_BASE_URL

  if (!needsUrlReview) {
    return {
      enabled: false,
      providerDocs: [],
      recommendedStrategy: 'local',
      summary: '',
      targets: [],
      tunnelCommands: [],
    }
  }

  const targets = buildSetupWizardPublicUrlTargets({
    wearables: selectedWearables,
    deviceSyncLocalBaseUrl,
    publicBaseUrl,
  })
  const hasPublicWebhookTargets = hasSetupWizardPublicWebhookTargets(targets)

  return {
    enabled: true,
    providerDocs: buildSetupWizardProviderDocs(selectedWearables),
    recommendedStrategy: 'local',
    summary: describeSetupWizardPublicUrlSummary({
      targets,
    }),
    targets,
    tunnelCommands: hasPublicWebhookTargets && publicBaseUrl === null
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

  if (input.strategy === 'local') {
    return 'Register the shown localhost OAuth callback URLs. Only add a public HTTPS URL for optional provider webhooks.'
  }

  if (input.strategy === 'hosted') {
    return 'Use hosted `apps/web` only when you intentionally run the hosted receiver. For local setup, keep OAuth callbacks on localhost and use public HTTPS only for webhook targets.'
  }

  return 'Expose the local webhook routes through a tunnel. Keep OAuth callbacks on localhost, then paste the public HTTPS tunnel URL only for webhook targets.'
}

export function formatSetupPublicUrlStrategy(strategy: SetupPublicUrlStrategy): string {
  switch (strategy) {
    case 'local':
      return 'Local callbacks'
    case 'hosted':
      return 'Hosted web app'
    case 'tunnel':
      return 'Webhook tunnel'
  }
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

  if (input.review.targets.length > 0) {
    lines.push(
      'OAuth callbacks can use Murph’s localhost receiver for local setup. Only provider webhooks need a public HTTPS URL from a tunnel or hosted deployment.',
      '',
    )
  }

  if (input.review.tunnelCommands.length > 0) {
    lines.push(
      'Webhook tunnel path:',
      '  Use the tunnel URL only for provider webhook fields. Keep OAuth callback fields on localhost; do not use the tunnel for control routes.',
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
  targets: readonly SetupWizardPublicUrlTarget[]
}): string {
  if (hasSetupWizardPublicWebhookTargets(input.targets)) {
    return 'Device OAuth callbacks can stay on localhost. Only optional webhooks need a public HTTPS URL.'
  }

  if (input.targets.length > 0) {
    return 'Device OAuth callbacks can stay on localhost. No public tunnel is needed for this selection.'
  }

  return ''
}

function buildSetupWizardPublicUrlTargets(input: {
  wearables: readonly SetupWearable[]
  deviceSyncLocalBaseUrl: string
  publicBaseUrl: string | null
}): SetupWizardPublicUrlTarget[] {
  const targets: SetupWizardPublicUrlTarget[] = []

  if (input.wearables.includes('garmin')) {
    const localReceiverUrl = new URL(
      '/connect/junction/callback',
      input.deviceSyncLocalBaseUrl,
    ).toString()
    targets.push({
      detail:
        'Required. Register this Junction Link callback URL before you connect Garmin.',
      label: 'Junction callback',
      localReceiverUrl,
      providerUrl: localReceiverUrl,
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
        'Required. Register this localhost redirect URL in the WHOOP Developer Dashboard.',
      label: 'WHOOP callback',
      localReceiverUrl: callbackUrl,
      providerUrl: callbackUrl,
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
      providerUrl: buildSetupWizardPublicProviderUrl(
        webhookUrl,
        input.publicBaseUrl,
      ),
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
        'Required. Oura redirect URIs must match this localhost callback URL exactly.',
      label: 'Oura callback',
      localReceiverUrl: callbackUrl,
      providerUrl: callbackUrl,
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
      providerUrl: buildSetupWizardPublicProviderUrl(
        webhookUrl,
        input.publicBaseUrl,
      ),
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
        'Required for the OAuth redirect. In Strava, keep the callback domain set to localhost for local setup.',
      label: 'Strava callback',
      localReceiverUrl: callbackUrl,
      providerUrl: callbackUrl,
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
      providerUrl: buildSetupWizardPublicProviderUrl(
        webhookUrl,
        input.publicBaseUrl,
      ),
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

function hasSetupWizardPublicWebhookTargets(
  targets: readonly SetupWizardPublicUrlTarget[],
): boolean {
  return targets.some((target) => (
    target.providerUrl !== null && target.providerUrl !== target.localReceiverUrl
  ))
}

function resolveSetupWizardConfiguredPublicBaseUrl(
  value: string | null | undefined,
): string | null {
  const normalizedValue = normalizeSetupWizardText(value)
  if (normalizedValue === null) {
    return null
  }

  return isConfiguredPublicBaseUrl(normalizedValue) ? normalizedValue : null
}

function isConfiguredPublicBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:') {
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

function buildSetupWizardPublicProviderUrl(
  localReceiverUrl: string,
  publicBaseUrl: string | null,
): string {
  try {
    const parsed = new URL(localReceiverUrl)
    const suffixPath = parsed.pathname.startsWith('/')
      ? parsed.pathname
      : `/${parsed.pathname}`

    if (publicBaseUrl !== null) {
      const base = new URL(publicBaseUrl)
      const basePath = base.pathname.replace(/\/+$/u, '')
      base.pathname = `${basePath}${suffixPath}`
      base.search = parsed.search
      base.hash = ''
      return base.toString()
    }

    return `${SETUP_PUBLIC_URL_PLACEHOLDER_HOST}${suffixPath}${parsed.search}`
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
