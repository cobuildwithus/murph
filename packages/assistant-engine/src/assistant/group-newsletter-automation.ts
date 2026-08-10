import type {
  AutomationSchedule,
} from '@murphai/contracts'

export const GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG =
  'group-health-newsletter' as const
export const GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG =
  'system:group-newsletter:email' as const
export const GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG =
  'system:group-newsletter:current-chat' as const
export const GROUP_NEWSLETTER_AUTOMATION_INSTRUCTIONS_MARKER =
  'Murph group newsletter configuration v1.' as const
export const GROUP_NEWSLETTER_ORDINARY_EXECUTION_MARKER =
  'Execution mode: ordinary group automation with skill-owned behavior.' as const

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
export type GroupNewsletterRuntimeDelivery =
  | 'group_email'
  | 'legacy_current_chat'

export interface GroupNewsletterAutomationConfiguration {
  customNote?: string | null
  delivery: GroupNewsletterDelivery
  healthScopes: readonly GroupNewsletterHealthScope[]
  newsletterName: string
  tone: GroupNewsletterTone
}

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
    GROUP_NEWSLETTER_ORDINARY_EXECUTION_MARKER,
    'Read the group-newsletter skill before every execution. The saved values below define the requested edition.',
    'Current-chat delivery uses the ordinary scheduled group-read and conversation-outbox path. Group-email delivery receives a separate trusted one-shot email contract from the runtime.',
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

export function isOrdinaryGroupNewsletterAutomationInstructions(
  instructions: string,
): boolean {
  return instructions.startsWith([
    GROUP_NEWSLETTER_AUTOMATION_INSTRUCTIONS_MARKER,
    GROUP_NEWSLETTER_ORDINARY_EXECUTION_MARKER,
    '',
  ].join('\n'))
}

export function hasGroupNewsletterDeliveryTag(tags: readonly string[]): boolean {
  return tags.includes(GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG)
    || tags.includes(GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG)
}

export function resolveGroupNewsletterAutomationDelivery(input: {
  instructions?: string
  slug: string
  tags: readonly string[]
}): GroupNewsletterRuntimeDelivery | null {
  if (input.slug !== GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG) {
    return null
  }

  // Current-chat wins closed if a manually corrupted record carries both tags:
  // the runtime must not gain email-send authority from ambiguous state.
  if (input.tags.includes(GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG)) {
    return isOrdinaryGroupNewsletterAutomationInstructions(
      input.instructions ?? '',
    )
      ? null
      : 'legacy_current_chat'
  }

  // Records created before delivery tags existed were email newsletters.
  return 'group_email'
}

export function buildGroupNewsletterScheduledExecutionPrompt(input: {
  delivery: GroupNewsletterRuntimeDelivery
  newsletterName: string
}): string {
  const deliveryRules = input.delivery === 'group_email'
    ? [
        'This occurrence is delivered by consented group email. Do not send the edition to the bound chat.',
        'The saved automation instructions and group-newsletter skill define the editorial behavior. This trusted contract governs only the authorized email effect.',
        'Call `murph.newsletter` with `action="prepare"` exactly once and with no group or route identifier. Use only the returned `members` facts and `referenceAt`. Do not use another group-health read, raw share files, or private one-to-one data.',
        'If preparation is unavailable or `referenceAt` is absent, return a skip decision and stop. If no participant can receive email, return one short chat message pointing to https://www.withmurph.ai/settings?addEmail=true and stop.',
        `The subject must start with the exact automation title ${JSON.stringify(input.newsletterName)} and continue with a specific hook. Provide equivalent HTML and text bodies.`,
        'Call `murph.newsletter` with `action="send"` exactly once and with no group or route identifier. After any send result, return a skip decision; the existing outbox owns delivery and retry.',
      ]
    : [
        'This is a compatibility contract for a current-chat newsletter saved before skill-owned ordinary execution was introduced.',
        'Read the group-newsletter skill, then call `murph.group` with `action="read_shared"` exactly once for the exact one to three health scopes in the saved configuration.',
        'Use only currently granted, available facts returned by that read. Return one concise send-message decision through the ordinary conversation outbox. Do not call `murph.newsletter` or require email sharing.',
      ]

  return [
    'Trusted group newsletter execution contract:',
    ...deliveryRules,
    'Before finishing, verify that you used one authorized data path and exactly one delivery path.',
  ].join('\n- ')
}
