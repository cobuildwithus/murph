import {
  buildAssistantAskContinuationSystemPromptResult,
  buildAssistantMaintenanceSystemPromptResult,
  buildAssistantOperatorMessagePromptResult,
  buildAssistantSystemNotificationPromptResult,
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
  type AssistantSystemPromptLayers,
} from '../../src/assistant/system-prompt.js'

/**
 * Named prompt routes for the structural prompt tests. Each one is a fixed
 * input, never a sentence, so the tests survive any rewording.
 */
export const PROMPT_ROUTE_CLI_CONTRACT = 'Murph CLI Contract:\nfixture contract body'

export const HOSTED_ROUTE_BASE: AssistantSystemPromptInput = {
  assistantCliContract: null,
  assistantDynamicContextPrompts: [],
  assistantHostedAutomationAvailable: true,
  assistantHostedDeviceConnectProviders: [
    { provider: 'garmin', label: 'Garmin' },
    { provider: 'oura', label: 'Oura' },
    { provider: 'whoop', label: 'WHOOP' },
  ],
  assistantHostedLabsAvailable: true,
  assistantPollsAvailable: true,
  assistantProgressUpdatesAvailable: true,
  channel: 'linq',
  cliAccess: { rawCommand: 'vault-cli' },
  currentLocalDate: '2026-11-10',
  currentTimeZone: 'America/New_York',
  hostedRuntime: true,
  onboardingGuidance: false,
  ordinaryInboundTurn: true,
}

export const PROMPT_ROUTE_INPUTS = {
  'direct-linq': {
    ...HOSTED_ROUTE_BASE,
    assistantCliContract: PROMPT_ROUTE_CLI_CONTRACT,
    conversationScope: 'direct',
  },
  'direct-linq-onboarding': {
    ...HOSTED_ROUTE_BASE,
    assistantCliContract: PROMPT_ROUTE_CLI_CONTRACT,
    conversationScope: 'direct',
    onboardingGuidance: true,
  },
  'direct-scheduled': {
    ...HOSTED_ROUTE_BASE,
    assistantCliContract: PROMPT_ROUTE_CLI_CONTRACT,
    conversationScope: 'direct',
    ordinaryInboundTurn: false,
    scheduledOccurrenceAt: '2026-11-10T13:00:00.000Z',
    turnTrigger: 'automation-cron',
  },
  'direct-local': {
    assistantCliContract: PROMPT_ROUTE_CLI_CONTRACT,
    channel: null,
    cliAccess: { rawCommand: 'vault-cli' },
    conversationScope: 'direct',
    currentLocalDate: '2026-11-10',
    currentTimeZone: 'America/New_York',
    hostedRuntime: false,
    onboardingGuidance: false,
  },
  'group-linq': {
    ...HOSTED_ROUTE_BASE,
    assistantStyleSettingsAvailable: true,
    conversationScope: 'group',
  },
  'group-telegram': {
    ...HOSTED_ROUTE_BASE,
    channel: 'telegram',
    conversationScope: 'group',
  },
  'group-email': {
    ...HOSTED_ROUTE_BASE,
    channel: 'email',
    conversationScope: 'group',
  },
  'unverified-external': {
    ...HOSTED_ROUTE_BASE,
    conversationScope: 'unverified-external',
  },
} as const satisfies Record<string, AssistantSystemPromptInput>

export type PromptRouteName =
  | keyof typeof PROMPT_ROUTE_INPUTS
  | 'maintenance-member-memory'
  | 'maintenance-group-room-model'
  | 'output-only-continuation'
  | 'system-notification'
  | 'operator-message'

export function renderPromptRoutes(): Record<PromptRouteName, AssistantSystemPromptLayers> {
  const maintenance = (profile: 'member-memory' | 'group-room-model') =>
    buildAssistantMaintenanceSystemPromptResult({
      currentLocalDate: '2026-11-10',
      currentTimeZone: 'America/New_York',
      profile,
    }).layers
  return {
    ...Object.fromEntries(
      Object.entries(PROMPT_ROUTE_INPUTS).map(([name, input]) => [
        name,
        buildAssistantSystemPromptLayers(input),
      ]),
    ) as Record<keyof typeof PROMPT_ROUTE_INPUTS, AssistantSystemPromptLayers>,
    'maintenance-member-memory': maintenance('member-memory'),
    'maintenance-group-room-model': maintenance('group-room-model'),
    'output-only-continuation': buildAssistantAskContinuationSystemPromptResult().layers,
    'system-notification': buildAssistantSystemNotificationPromptResult({ channel: 'linq' }).layers,
    'operator-message': buildAssistantOperatorMessagePromptResult({ channel: 'linq' }).layers,
  }
}

/**
 * A wide sweep of prompt inputs: every scope and channel, hosted and local,
 * with every optional capability on, off and defaulted. Invariants that must
 * hold for any input run over this, not only over the named routes.
 */
export function sweepPromptInputs(): AssistantSystemPromptInput[] {
  const scopes = ['direct', 'group', 'unverified-external'] as const
  const channels = ['linq', 'telegram', 'email', 'sms', null]
  const capabilitySets: Partial<AssistantSystemPromptInput>[] = [
    {
      assistantAndroidAppAvailable: true,
      assistantCliContract: PROMPT_ROUTE_CLI_CONTRACT,
      assistantDynamicContextPrompts: ['Sweep dynamic context.'],
      assistantHostedAutomationAvailable: true,
      assistantHostedDeviceConnectProviders: HOSTED_ROUTE_BASE.assistantHostedDeviceConnectProviders,
      assistantHostedLabsAvailable: true,
      assistantPersona: 'classic',
      assistantPersonality: { humor: 7, push: 7, detail: 7, unhinged: 7 },
      assistantPollsAvailable: true,
      assistantProgressUpdatesAvailable: true,
      assistantStyleSettingsAvailable: true,
      assistantTone: 'casual',
      currentInstant: '2026-11-10T15:00:00.000Z',
      murphProductBaseUrl: 'https://murph.example.test',
      onboardingGuidance: true,
      ordinaryInboundTurn: true,
    },
    {
      assistantAndroidAppAvailable: false,
      assistantHostedAutomationAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantHostedLabsAvailable: false,
      assistantPollsAvailable: false,
      assistantProgressUpdatesAvailable: false,
      assistantStyleSettingsAvailable: false,
      ordinaryInboundTurn: false,
    },
    {},
  ]
  const extras: Partial<AssistantSystemPromptInput>[] = [
    {},
    { canonicalTimeZoneAvailable: false, currentInstant: '2026-11-10T15:00:00.000Z' },
    { scheduledOccurrenceAt: '2026-11-10T13:00:00.000Z', turnTrigger: 'automation-cron' },
    { assistantHostedGroupToolSurface: 'shared_read' },
    { assistantHostedGroupToolSurface: 'none' },
  ]
  const inputs: AssistantSystemPromptInput[] = []
  for (const conversationScope of scopes) {
    for (const channel of channels) {
      for (const hostedRuntime of [true, false]) {
        for (const capabilities of capabilitySets) {
          for (const extra of extras) {
            inputs.push({
              assistantCliContract: null,
              channel,
              cliAccess: { rawCommand: 'vault-cli' },
              conversationScope,
              currentLocalDate: '2026-11-10',
              currentTimeZone: 'America/New_York',
              hostedRuntime,
              onboardingGuidance: false,
              ...capabilities,
              ...extra,
            })
          }
        }
      }
    }
  }
  return inputs
}
