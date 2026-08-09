import type {
  AutomationSchedule,
} from '@murphai/contracts'

export const GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG =
  'group-health-newsletter' as const
export const AUTOMATION_GROUP_EMAIL_DELIVERY_TAG =
  'system:automation-delivery:group-email' as const
export const AUTOMATION_DELIVERY_VALUES = [
  'current_conversation',
  'group_email',
] as const

// Legacy values are retained only so already-saved automations and old callers
// continue to run while newsletter setup moves to ordinary automation.save.
export const GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG =
  'system:group-newsletter:email' as const
export const GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG =
  'system:group-newsletter:current-chat' as const
export const GROUP_NEWSLETTER_AUTOMATION_INSTRUCTIONS_MARKER =
  'Murph group newsletter configuration v1.' as const

export const GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES = [
  'steps-days.v0',
  'activity-days.v0',
  'workout-days.v0',
  'sleep-duration-days.v0',
  'sleep-times.v0',
  'resting-heart-rate-days.v0',
  'hrv-days.v0',
] as const

export const GROUP_NEWSLETTER_DEFAULT_HEALTH_SCOPES = [
  ...GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES,
] as const

export const GROUP_NEWSLETTER_CURRENT_CHAT_DEFAULT_HEALTH_SCOPES = [
  'steps-days.v0',
  'activity-days.v0',
  'sleep-duration-days.v0',
] as const

export const GROUP_NEWSLETTER_DELIVERY_VALUES = [
  'current_chat',
  'group_email',
] as const

export const GROUP_NEWSLETTER_TONE_VALUES = [
  'supportive',
  'coach_roast',
] as const

export type GroupNewsletterDelivery =
  typeof GROUP_NEWSLETTER_DELIVERY_VALUES[number]
export type GroupNewsletterHealthScope =
  typeof GROUP_NEWSLETTER_HEALTH_SCOPE_VALUES[number]
export type GroupNewsletterTone = typeof GROUP_NEWSLETTER_TONE_VALUES[number]

export interface GroupNewsletterAutomationConfiguration {
  customNote?: string | null
  delivery: GroupNewsletterDelivery
  healthScopes: readonly GroupNewsletterHealthScope[]
  newsletterName: string
  tone: GroupNewsletterTone
}

/**
 * Compatibility compiler for pre-simplification callers. New newsletter setup
 * is owned by the group-newsletter skill and uses ordinary automation.save.
 */
export function buildGroupNewsletterAutomationSaveRequest(input: {
  configuration: GroupNewsletterAutomationConfiguration
  schedule: Extract<AutomationSchedule, { kind: 'cron' }>
}): {
  action: 'save'
  continuityPolicy: 'fresh'
  instructions: string
  schedule: Extract<AutomationSchedule, { kind: 'cron' }>
  slug: typeof GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG
  tags: string[]
  title: string
} {
  return {
    action: 'save',
    continuityPolicy: 'fresh',
    instructions: buildGroupNewsletterAutomationInstructions(input.configuration),
    schedule: input.schedule,
    slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
    tags: buildGroupNewsletterAutomationTags(input.configuration.delivery),
    title: input.configuration.newsletterName,
  }
}

export function buildGroupNewsletterAutomationInstructions(
  input: GroupNewsletterAutomationConfiguration,
): string {
  const customNote = input.customNote?.trim() || null
  return [
    GROUP_NEWSLETTER_AUTOMATION_INSTRUCTIONS_MARKER,
    'These are configuration values. The runtime appends the current execution contract on every scheduled run.',
    `Newsletter name: ${JSON.stringify(input.newsletterName)}`,
    `Delivery: ${input.delivery}`,
    `Tone: ${input.tone}`,
    `Health scopes: ${input.healthScopes.join(', ')}`,
    `Custom note: ${customNote === null ? 'none' : JSON.stringify(customNote)}`,
  ].join('\n')
}

export function buildGroupNewsletterAutomationTags(
  delivery: GroupNewsletterDelivery,
): string[] {
  return [
    'assistant',
    'scheduled',
    delivery === 'group_email'
      ? GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG
      : GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG,
  ]
}

export function isCanonicalGroupNewsletterAutomationInstructions(
  instructions: string,
): boolean {
  return instructions.startsWith(`${GROUP_NEWSLETTER_AUTOMATION_INSTRUCTIONS_MARKER}\n`)
}

export function hasGroupNewsletterDeliveryTag(tags: readonly string[]): boolean {
  return tags.includes(AUTOMATION_GROUP_EMAIL_DELIVERY_TAG)
    || tags.includes(GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG)
    || tags.includes(GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG)
}

/**
 * Returns special runtime authority only for email delivery. Current-chat
 * newsletters are ordinary scheduled assistant turns and need no feature path.
 */
export function resolveGroupNewsletterAutomationDelivery(input: {
  slug: string
  tags: readonly string[]
}): 'group_email' | null {
  if (input.tags.includes(AUTOMATION_GROUP_EMAIL_DELIVERY_TAG)) {
    return 'group_email'
  }
  if (input.slug !== GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG) {
    return null
  }

  // Legacy current-chat records now use the normal conversation response path.
  if (input.tags.includes(GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG)) {
    return null
  }

  // Legacy records created before delivery tags existed were email newsletters.
  return 'group_email'
}

export function buildGroupNewsletterScheduledExecutionPrompt(input: {
  delivery: 'group_email'
  newsletterName: string
}): string {
  return [
    'Trusted scheduled group-email delivery contract:',
    'The saved automation instructions and referenced skill define what to produce. This runtime contract only governs authorized email delivery.',
    'Call `murph.newsletter` with `action="prepare"` exactly once and with no group or route identifier. Use only the returned `members` facts. Do not use raw share files or private one-to-one data.',
    'If preparation is unavailable or `referenceAt` is absent, return a skip decision and stop. If no participant can receive email, return one short chat message pointing to https://www.withmurph.ai/settings?addEmail=true and stop.',
    `The email subject must start with the exact automation title ${JSON.stringify(input.newsletterName)} and continue with a specific hook. Provide equivalent HTML and text bodies.`,
    'Call `murph.newsletter` with `action="send"` exactly once and with no group or route identifier. After any send result, return a skip decision; the group-email outbox owns delivery and retry.',
    'Before finishing, verify that you used only the authorized prepare result and exactly one email delivery path.',
  ].join('\n- ')
}
