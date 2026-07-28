import type {
  AssistantSession,
  AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantUsageCredentialSource,
  AssistantUsageStripeMeterSource,
} from '@murphai/hosted-execution/assistant-usage'
import {
  createAssistantUsageReportingUserId as createHostedAssistantUsageReportingUserId,
  normalizeAssistantUsageStripeMeterSource,
} from '@murphai/hosted-execution/assistant-usage'

import type { AssistantMessageInput } from './service-contracts.js'

export const HOSTED_AI_USAGE_REPORTING_SECRET_ENV = 'HOSTED_AI_USAGE_REPORTING_SECRET'

export interface AssistantUsageAttribution {
  credentialSource: AssistantUsageCredentialSource
  environment: string
  featureKey: string
  gatewayTags: readonly string[]
  reportingUserId: string | null
  surface: string
  stripeMeterSource: AssistantUsageStripeMeterSource
  triggerKind: string
}

export function createAssistantUsageAttribution(input: {
  credentialSource: AssistantUsageCredentialSource
  environment?: string | null
  featureKey: string
  memberId: string
  reportingSecret?: string | null
  surface: string
  stripeMeterSource?: AssistantUsageStripeMeterSource | null
  triggerKind: string
}): AssistantUsageAttribution {
  const environment = normalizeUsageAttributionPart(input.environment) ?? 'development'
  const featureKey = normalizeUsageAttributionPart(input.featureKey) ?? 'assistant_reply'
  const surface = normalizeUsageAttributionPart(input.surface) ?? 'assistant'
  const triggerKind = normalizeUsageAttributionPart(input.triggerKind) ?? 'manual_ask'
  const credentialSource = input.credentialSource
  const reportingUserId = createAssistantUsageReportingUserId({
    memberId: input.memberId,
    reportingSecret: input.reportingSecret,
  })
  const gatewayTags = createAssistantUsageGatewayTags({
    credentialSource,
    environment,
    featureKey,
    surface,
    triggerKind,
  })

  return {
    credentialSource,
    environment,
    featureKey,
    gatewayTags,
    reportingUserId,
    surface,
    stripeMeterSource: normalizeAssistantUsageStripeMeterSource(input.stripeMeterSource),
    triggerKind,
  }
}

export function createAssistantUsageReportingUserId(input: {
  memberId: string
  reportingSecret?: string | null
}): string | null {
  return createHostedAssistantUsageReportingUserId(input)
}

export function resolveAssistantUsageFeatureKey(input: {
  deliverResponse?: boolean | null
  promptProfile:
    | 'assistant-ask-continuation'
    | 'conversation'
    | 'maintenance'
    | 'onboarding-goal-checkin'
    | 'system-notification'
  turnTrigger?: AssistantTurnTrigger | null
}): string {
  if (input.deliverResponse === false) {
    return 'assistant_internal_reply'
  }

  switch (input.turnTrigger ?? 'manual-ask') {
    case 'automation-auto-reply':
      return 'assistant_auto_reply'
    case 'automation-cron':
      return 'assistant_cron'
    case 'manual-deliver':
      return 'assistant_manual_delivery'
    case 'manual-ask':
    default:
      return 'assistant_reply'
  }
}

export function resolveAssistantUsageSurface(input: {
  messageInput: Pick<AssistantMessageInput, 'deliverySource'>
  session: AssistantSession
}): string {
  return normalizeUsageAttributionPart(
    input.messageInput.deliverySource?.kind ?? input.session.binding.channel ?? null,
  ) ?? 'assistant'
}

export function resolveAssistantUsageTriggerKind(
  trigger: AssistantTurnTrigger | null | undefined,
): string {
  return normalizeUsageAttributionPart(trigger ?? 'manual-ask') ?? 'manual_ask'
}

export function resolveAssistantUsageEnvironment(env: NodeJS.ProcessEnv): string {
  return normalizeUsageAttributionPart(
    env.VERCEL_ENV ?? env.NODE_ENV ?? env.ENVIRONMENT ?? null,
  ) ?? 'development'
}

export function resolveAssistantUsageReportingSecret(env: NodeJS.ProcessEnv): string | null {
  return normalizeOptionalString(env[HOSTED_AI_USAGE_REPORTING_SECRET_ENV])
}

export function normalizeAssistantUsageGatewayTags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalizedTags: string[] = []

  for (const tag of tags) {
    const normalized = normalizeUsageTag(tag)

    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    normalizedTags.push(normalized)
  }

  return normalizedTags
}

function createAssistantUsageGatewayTags(input: {
  credentialSource: AssistantUsageCredentialSource
  environment: string
  featureKey: string
  surface: string
  triggerKind: string
}): string[] {
  return normalizeAssistantUsageGatewayTags([
    `env:${input.environment}`,
    `feature:${input.featureKey}`,
    `surface:${input.surface}`,
    `trigger:${input.triggerKind}`,
    `credential:${input.credentialSource}`,
  ])
}

function normalizeUsageAttributionPart(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value)

  if (!normalized) {
    return null
  }

  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/g, '')
    .replace(/_+$/g, '')

  return slug.length > 0 ? slug : null
}

function normalizeUsageTag(value: string): string | null {
  const normalized = normalizeOptionalString(value)

  if (!normalized) {
    return null
  }

  const [rawKey, ...rawValueParts] = normalized.split(':')
  const key = normalizeUsageAttributionPart(rawKey)
  const tagValue = normalizeUsageAttributionPart(rawValueParts.join(':'))

  if (!key || !tagValue) {
    return null
  }

  return `${key}:${tagValue}`
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}
