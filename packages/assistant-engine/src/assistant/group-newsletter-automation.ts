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
  return tags.includes(GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG)
    || tags.includes(GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG)
}

export function resolveGroupNewsletterAutomationDelivery(input: {
  slug: string
  tags: readonly string[]
}): GroupNewsletterDelivery | null {
  if (input.slug !== GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG) {
    return null
  }

  // Current-chat wins closed if a manually corrupted record carries both tags:
  // the runtime must not gain email-send authority from ambiguous state.
  if (input.tags.includes(GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG)) {
    return 'current_chat'
  }
  // Records created before delivery tags existed were email newsletters.
  return 'group_email'
}

export function buildGroupNewsletterScheduledExecutionPrompt(input: {
  delivery: GroupNewsletterDelivery
  newsletterName: string
}): string {
  const sharedEditorialRules = [
    'Write a selective weekly story, not a census or one repeated metric block per member.',
    'Lead with a close race, leader, surprising contrast, or broad current-week pattern; use only numbers that develop that story.',
    'Use the semantic owner supplied by the returned fact: an activity-days.v0 record is broad movement only when data.metricSemantics="broad-movement", and a workout-days.v0 record is a canonical combined workout day only when data.metricSemantics="canonical-workout-day". Otherwise it is ambiguous and unusable, not zero. Never expose raw minute totals or unsupported weekly totals.',
    'Never include the open current local day in a weekly average. A current-day value may appear only as a separate, explicit "today so far" aside and must not affect a weekly comparison, leader, winner, crown, or challenge.',
    'Use only canonical combined day values. Distinct same-day workouts add together; never repair or explain a total by replacing one workout with another.',
    'Omit missing-data and lowest-performer callouts. Supportive is the default; coach roast is allowed only when the saved tone explicitly opts in and must target effort or group lore, never bodies, illness, or diagnoses.',
    'End with one easy question or challenge that invites a reply.',
  ]

  const deliveryRules = input.delivery === 'group_email'
    ? [
        'This edition is delivered by group email. Do not send the digest to the bound chat.',
        'Call `murph.newsletter` with `action="prepare"` exactly once and with no group or route identifier. Use only the returned `members` facts. Do not use `read_stats`, another group-health read, raw share files, or private one-to-one data.',
        'Email prepare has already excluded the open local day and exposes activity-minutes only through the broad-movement semantic owner. Use observedDayCount, observedDates, and throughDate to scope averages to observed completed days; never treat unobserved days as zero or imply that a partial week is complete.',
        'Declare a settled cross-person leader, winner, or crown for a metric only when every compared entry has an identical observedDates array. When coverage differs, scope each average to its own dates and avoid a crown.',
        'If preparation is unavailable or `referenceAt` is absent, return a skip decision and stop. If no participant can receive email, return one short chat message pointing to https://www.withmurph.ai/settings?addEmail=true and stop.',
        `Write a 140-220 word email. Its subject must start with the exact newsletter name ${JSON.stringify(input.newsletterName)} and continue with a specific hook. Provide equivalent HTML and text bodies.`,
        'Call `murph.newsletter` with `action="send"` exactly once and with no group or route identifier. After any send result, return a skip decision; the newsletter outbox owns delivery and retry.',
      ]
    : [
        'This edition is delivered to the current group chat through the ordinary scheduled assistant response. Do not call `murph.newsletter` and do not require group email sharing.',
        'Call `murph.group` with `action="read_shared"` exactly once for the exact one to three health scopes listed in the saved configuration. Use only currently granted, available facts returned by that read; do not use private one-to-one data or raw share files.',
        'Before computing a weekly average or comparison from the raw shared records, exclude every record dated on the current local day. A current-day value may appear only as a separate "today so far" aside.',
        'Write one concise, conversational group-chat update and return one send-message decision. The normal conversation outbox owns iMessage or Telegram delivery and retry.',
      ]

  return [
    'Trusted group newsletter execution contract:',
    'The saved block above supplies configuration only. These current rules replace any older operational workflow text that mentions retired actions or model-supplied group identifiers.',
    'Follow the saved newsletter name, tone, health scopes, and custom note unless they conflict with this contract.',
    ...deliveryRules,
    ...sharedEditorialRules,
    'Before finishing, verify that no missing-data callout, raw duration total, repeated member template, or generic "shared snapshot" opening remains.',
  ].join('\n- ')
}
