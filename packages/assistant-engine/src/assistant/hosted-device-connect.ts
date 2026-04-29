import type {
  AssistantExecutionContext,
  AssistantHostedDeviceConnectLink,
  AssistantHostedDeviceConnectProvider,
} from './execution-context.js'
import { normalizeNullableString } from './shared.js'

type HostedDeviceConnectMessagingReturnTarget = 'imessage' | 'telegram'

export type AssistantHostedDeviceConnectResolution =
  | {
      kind: 'not_applicable'
    }
  | {
      kind: 'handled'
      providerActionCount: number
      response: string
    }

interface HostedDeviceConnectCandidate {
  provider: AssistantHostedDeviceConnectProvider
}

interface KnownWearableProviderTarget {
  label: string
  provider: string
}

const CONNECT_INTENT_PATTERN =
  /\b(connect|link|setup|set(?:\s|-)+up|authorize|authorise|pair)\b/iu
const NEGATED_CONNECT_PATTERN =
  /\b(don't|do\s+not|dont|not|without|skip|avoid)\b.{0,32}\b(connect|link|setup|set(?:\s|-)+up|authorize|authorise|pair)\b/iu
const POST_PROVIDER_CONNECT_INTENT_PATTERN =
  /\b(connection|link|authorization|authorisation|oauth)\b/iu
const CONNECT_TARGET_BLOCKER_PATTERN =
  /\b(experiment|protocol|routine|plan|using|instead\s+of|rather\s+than|not|without|except|skip|avoid)\b/iu
const OWNERSHIP_MENTION_PATTERN =
  /\b(i|we)\s+(use|wear|have|own)\b|\bmy\b/iu

const KNOWN_WEARABLE_PROVIDER_ALIASES: ReadonlyArray<{
  aliases: readonly string[]
  label: string
  provider: string
}> = Object.freeze([
  { aliases: ['whoop'], label: 'WHOOP', provider: 'whoop' },
  { aliases: ['oura', 'oura ring'], label: 'Oura', provider: 'oura' },
  { aliases: ['garmin'], label: 'Garmin', provider: 'garmin' },
  { aliases: ['strava'], label: 'Strava', provider: 'strava' },
  { aliases: ['fitbit'], label: 'Fitbit', provider: 'fitbit' },
  { aliases: ['apple watch', 'apple health'], label: 'Apple Health', provider: 'apple-health' },
  { aliases: ['google fit'], label: 'Google Fit', provider: 'google-fit' },
  { aliases: ['polar'], label: 'Polar', provider: 'polar' },
  { aliases: ['suunto'], label: 'Suunto', provider: 'suunto' },
  { aliases: ['withings'], label: 'Withings', provider: 'withings' },
])

export async function maybeHandleAssistantHostedDeviceConnect(input: {
  channel?: string | null
  executionContext: AssistantExecutionContext | null
  onboardingGuidanceInjected?: boolean
  prompt: string
}): Promise<AssistantHostedDeviceConnectResolution> {
  const hosted = input.executionContext?.hosted ?? null
  const issueDeviceConnectLink = hosted?.issueDeviceConnectLink
  if (typeof issueDeviceConnectLink !== 'function') {
    return { kind: 'not_applicable' }
  }

  const providers = hosted?.deviceConnectProviders ?? []
  if (providers.length === 0) {
    return { kind: 'not_applicable' }
  }

  const prompt = input.prompt.trim()
  if (!prompt || NEGATED_CONNECT_PATTERN.test(prompt)) {
    return { kind: 'not_applicable' }
  }

  const unsupportedTarget = resolveUnsupportedHostedDeviceConnectTarget({
    prompt,
    providers,
  })
  if (unsupportedTarget) {
    return buildUnsupportedHostedDeviceConnectResponse({
      providers,
      target: unsupportedTarget,
    })
  }

  const candidate = resolveHostedDeviceConnectCandidate({
    onboardingGuidanceInjected: input.onboardingGuidanceInjected === true,
    prompt,
    providers,
  })
  if (!candidate) {
    return resolveUnsupportedHostedDeviceConnectResponse({
      prompt,
      providers,
    })
  }

  const messagingReturnTarget = resolveHostedDeviceConnectMessagingReturnTarget(
    input.channel,
  )
  try {
    const link = await issueDeviceConnectLink({
      ...(messagingReturnTarget ? { messagingReturnTarget } : {}),
      provider: candidate.provider.provider,
    })
    return {
      kind: 'handled',
      providerActionCount: 1,
      response: buildHostedDeviceConnectLinkResponse(link),
    }
  } catch {
    return {
      kind: 'handled',
      providerActionCount: 1,
      response: `I couldn't create the ${candidate.provider.label} connection link right now. Please try again shortly.`,
    }
  }
}

function resolveHostedDeviceConnectCandidate(input: {
  onboardingGuidanceInjected: boolean
  prompt: string
  providers: readonly AssistantHostedDeviceConnectProvider[]
}): HostedDeviceConnectCandidate | null {
  const provider = input.providers.find((candidate) =>
    providerHasDirectConnectTarget(candidate, input.prompt),
  )
  if (provider) {
    return {
      provider,
    }
  }

  if (
    input.onboardingGuidanceInjected &&
    input.providers.some((candidate) =>
      providerMatchesPrompt(candidate, input.prompt),
    ) &&
    (OWNERSHIP_MENTION_PATTERN.test(input.prompt) ||
      isCompactProviderMentionPrompt(input.prompt))
  ) {
    const onboardingProvider = input.providers.find((candidate) =>
      providerMatchesPrompt(candidate, input.prompt),
    )
    if (!onboardingProvider) {
      return null
    }

    return {
      provider: onboardingProvider,
    }
  }

  return null
}

function isCompactProviderMentionPrompt(prompt: string): boolean {
  const words = prompt
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)

  return words.length <= 4
}

function resolveUnsupportedHostedDeviceConnectResponse(input: {
  prompt: string
  providers: readonly AssistantHostedDeviceConnectProvider[]
}): AssistantHostedDeviceConnectResolution {
  const target = resolveUnsupportedHostedDeviceConnectTarget(input)
  if (!target) {
    return { kind: 'not_applicable' }
  }

  return buildUnsupportedHostedDeviceConnectResponse({
    providers: input.providers,
    target,
  })
}

function buildUnsupportedHostedDeviceConnectResponse(input: {
  providers: readonly AssistantHostedDeviceConnectProvider[]
  target: KnownWearableProviderTarget
}): AssistantHostedDeviceConnectResolution {
  const configuredProviderLabels = input.providers
    .map((provider) => provider.label)
    .filter((label) => label.trim().length > 0)
  const providerList =
    configuredProviderLabels.length > 0
      ? formatProviderLabelList(configuredProviderLabels)
      : 'the configured wearable providers'

  return {
    kind: 'handled',
    providerActionCount: 0,
    response: `${input.target.label} connection links are not configured in this route right now. I can create links for ${providerList}.`,
  }
}

function resolveUnsupportedHostedDeviceConnectTarget(input: {
  prompt: string
  providers: readonly AssistantHostedDeviceConnectProvider[]
}): KnownWearableProviderTarget | null {
  const configuredProviders = new Set(
    input.providers.map((provider) => provider.provider),
  )
  const targets = findKnownWearableDirectConnectTargets(input.prompt)

  return targets.find((target) => !configuredProviders.has(target.provider)) ?? null
}

function findKnownWearableDirectConnectTargets(
  prompt: string,
): KnownWearableProviderTarget[] {
  const targets: Array<KnownWearableProviderTarget & { start: number }> = []
  const seen = new Set<string>()

  for (const candidate of KNOWN_WEARABLE_PROVIDER_ALIASES) {
    for (const alias of candidate.aliases) {
      for (const match of findPhraseMatches(prompt, alias)) {
        if (!phraseHasDirectConnectIntent(prompt, match)) {
          continue
        }

        const key = `${candidate.provider}:${match.start}`
        if (seen.has(key)) {
          continue
        }

        seen.add(key)
        targets.push({
          label: candidate.label,
          provider: candidate.provider,
          start: match.start,
        })
      }
    }
  }

  return targets
    .sort((left, right) => left.start - right.start)
    .map(({ label, provider }) => ({ label, provider }))
}

function providerHasDirectConnectTarget(
  provider: AssistantHostedDeviceConnectProvider,
  prompt: string,
): boolean {
  return providerAliases(provider).some((alias) =>
    findPhraseMatches(prompt, alias).some((match) =>
      phraseHasDirectConnectIntent(prompt, match),
    ),
  )
}

function providerMatchesPrompt(
  provider: AssistantHostedDeviceConnectProvider,
  prompt: string,
): boolean {
  return providerAliases(provider).some((alias) => containsPhrase(prompt, alias))
}

function providerAliases(
  provider: AssistantHostedDeviceConnectProvider,
): string[] {
  return [
    provider.provider,
    provider.label,
    provider.label.replace(/\s+/gu, ''),
  ]
}

function containsPhrase(text: string, phrase: string): boolean {
  return findPhraseMatches(text, phrase).length > 0
}

function findPhraseMatches(
  text: string,
  phrase: string,
): Array<{ end: number; start: number }> {
  const normalized = normalizeNullableString(phrase)
  if (!normalized) {
    return []
  }

  const matches: Array<{ end: number; start: number }> = []
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}])(${escapeRegExp(normalized)})([^\\p{L}\\p{N}]|$)`,
    'giu',
  )

  for (const match of text.matchAll(pattern)) {
    const prefix = match[1] ?? ''
    const value = match[2] ?? ''
    const start = match.index + prefix.length
    matches.push({
      end: start + value.length,
      start,
    })
  }

  return matches
}

function phraseHasDirectConnectIntent(
  prompt: string,
  match: { end: number; start: number },
): boolean {
  return (
    hasDirectConnectIntentBeforePhrase(prompt.slice(0, match.start)) ||
    hasDirectConnectIntentAfterPhrase(prompt.slice(match.end))
  )
}

function hasDirectConnectIntentBeforePhrase(leftText: string): boolean {
  const windowText = leftText.slice(-80)
  const matches = [...windowText.matchAll(
    new RegExp(CONNECT_INTENT_PATTERN.source, 'giu'),
  )]
  const intent = matches.at(-1)
  if (!intent) {
    return false
  }

  const between = windowText.slice(intent.index + intent[0].length)
  const beforeIntent = windowText.slice(0, intent.index)
  if (
    /^connect$/iu.test(intent[0]) &&
    /^\s+to\s*$/iu.test(between) &&
    mentionsKnownWearableProvider(beforeIntent)
  ) {
    return false
  }

  if (CONNECT_TARGET_BLOCKER_PATTERN.test(between)) {
    return false
  }

  return countWords(between) <= 4
}

function hasDirectConnectIntentAfterPhrase(rightText: string): boolean {
  const windowText = rightText.slice(0, 48)
  const match = POST_PROVIDER_CONNECT_INTENT_PATTERN.exec(windowText)
  if (!match) {
    return false
  }

  const between = windowText.slice(0, match.index)
  return !CONNECT_TARGET_BLOCKER_PATTERN.test(between) && countWords(between) <= 4
}

function countWords(value: string): number {
  return value
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length
}

function mentionsKnownWearableProvider(value: string): boolean {
  return KNOWN_WEARABLE_PROVIDER_ALIASES.some((candidate) =>
    candidate.aliases.some((alias) => containsPhrase(value, alias)),
  )
}

function buildHostedDeviceConnectLinkResponse(
  link: AssistantHostedDeviceConnectLink,
): string {
  return [
    `Here is your ${link.providerLabel} connection link:`,
    link.authorizationUrl,
    '',
    'Open it to authorize the connection.',
  ].join('\n')
}

function resolveHostedDeviceConnectMessagingReturnTarget(
  channel: string | null | undefined,
): HostedDeviceConnectMessagingReturnTarget | null {
  switch (normalizeNullableString(channel)) {
    case 'linq':
    case 'imessage':
      return 'imessage'
    case 'telegram':
      return 'telegram'
    default:
      return null
  }
}

function formatProviderLabelList(labels: readonly string[]): string {
  const unique = [...new Set(labels)]
  if (unique.length <= 1) {
    return unique[0] ?? 'none'
  }

  if (unique.length === 2) {
    return `${unique[0]} and ${unique[1]}`
  }

  return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
