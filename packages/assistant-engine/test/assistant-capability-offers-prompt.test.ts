import { hostedPhoneCallStartResponseSchema } from '@murphai/hosted-execution'
import { describe, expect, it } from 'vitest'

import {
  buildAssistantNotificationDecisionSystemPromptLayers,
  buildAssistantSystemPromptLayers,
  type AssistantNotificationDecisionSystemPromptInput,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const CAPABILITY_OFFERS_HEADER = 'Capability offers:'
const PHONE_CALLS_HEADER = 'Phone calls:'
const HOSTED_GROUPS_HEADER = 'Hosted groups:'

describe('assistant capability-offers prompt contract', () => {
  it('keeps capability-offers and phone-call sections in the stable route layer only', () => {
    const layers = buildAssistantSystemPromptLayers(createCommonCodexPromptInput())

    expect(layers.stableRouteCapabilityPrompt).toContain(CAPABILITY_OFFERS_HEADER)
    expect(layers.stableRouteCapabilityPrompt).toContain(PHONE_CALLS_HEADER)

    for (const promptLayer of [
      layers.dynamicTurnContextPrompt,
      layers.threadContextPrompt,
      layers.staticCacheableCorePrompt,
    ]) {
      expect(promptLayer).not.toContain(CAPABILITY_OFFERS_HEADER)
      expect(promptLayer).not.toContain(PHONE_CALLS_HEADER)
    }
  })

  it('does not expose external-capable sections to maintenance turns', () => {
    const layers = buildAssistantNotificationDecisionSystemPromptLayers(
      createNotificationDecisionPromptInput({ maintenanceTurn: true }),
    )

    expect(layers.stableRouteCapabilityPrompt).toBe('')

    for (const externalSurface of [
      CAPABILITY_OFFERS_HEADER,
      PHONE_CALLS_HEADER,
      'Computer-use tools:',
      'Connected-app tools:',
      '`murph.create_phone_call`',
      '`murph.computer_',
      '`murph.connected_apps_',
      '`murph.newsletter`',
    ]) {
      expect(layers.prompt).not.toContain(externalSurface)
    }
  })

  it('keeps capability offers scoped to health-relevant tasks', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('health and dental care')
    expect(section).toContain('contact lenses, supplements, OTC products')
    expect(section).toContain('insurance/provider portals')
    expect(section).toContain('General shopping, procurement, work errands')
    expect(section).not.toMatch(/\bordering or reordering,\b/u)
  })

  it('names task takeover and setup as distinct offer kinds', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('task takeover means Murph does a bounded thing now')
    expect(section).toContain('setup means Murph stands up something ongoing')
  })

  it('keeps setup consent separate from activation consent', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain(
      'a clear "yes" authorizes only the setup conversation, not activation',
    )
    expect(section).toContain('other people, shared health data, email delivery')
    expect(section).toContain('recurring messages, account OAuth')
    expect(section).toContain('durable private media, or the user\'s money')
    expect(section).toContain(
      'who is involved, what data is shared, where messages go, cadence',
    )
    expect(section).toContain('how to stop, and any cost or irreversible step')
  })

  it('makes newsletter setup offerable without permitting immediate sends', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain(
      'weekly group health newsletter is offerable only as setup',
    )
    expect(section).toContain('Never offer to send an edition immediately')
    expect(section).toContain('setup notice and opt-out window elapse')
    expect(section).toContain('one shared email thread only')
  })

  it('distinguishes solo group join-link setup from in-chat join offers', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('in a 1:1 conversation')
    expect(section).toContain('mint a join link the user can share')
    expect(section).toContain('inside a group chat')
    expect(section).toContain('react-to-join offer message')
    expect(section).toContain('Do not imply Murph can create the group chat itself')
  })

  it('keeps internal primitives out of proactive offers', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('Never proactively offer internal plumbing as features')
    expect(section).toContain('progress updates, response-media attachment')
    expect(section).toContain('broad mailbox/calendar/document scans')
    expect(section).toContain('spending money, direct purchase/payment execution')
    expect(section).toContain('health-relevant ordering offers are bounded prep')
    expect(section).toContain('body/diagnosis leaderboards')
  })

  it('names newsletter mechanics inside hosted-group guidance', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      HOSTED_GROUPS_HEADER,
    )

    expect(section).toContain('`murph.newsletter`')
    expect(section).toContain('`action="read_stats"`')
    expect(section).toContain('`action="send"`')
    expect(section).toContain('never returns raw email addresses')
    expect(section).toContain('never send the first edition immediately')
    expect(section).toContain('normal `vault-cli automation` surface')
  })

  it('keeps the turn-priority cap and decline restraint load-bearing', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('turn priority item 9')
    expect(section).toContain('do not re-offer after a decline')
  })

  it('keeps phone-call start-status wording aligned with the hosted schema', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      PHONE_CALLS_HEADER,
    )
    const promptStatuses = extractStartStatusLiterals(section)

    expect(promptStatuses).toEqual(['starting', 'calling', 'failed'])
    for (const status of promptStatuses) {
      expect(
        hostedPhoneCallStartResponseSchema.safeParse({
          phoneCallId: 'phone-call-test',
          status,
        }).success,
      ).toBe(true)
    }
  })
})

function getPromptSection(prompt: string, heading: string): string {
  const sectionStart = prompt.indexOf(heading)
  if (sectionStart < 0) {
    throw new Error(`Prompt section not found: ${heading}`)
  }

  const rest = prompt.slice(sectionStart)
  const nextSectionStart = rest.indexOf('\n\n')
  return nextSectionStart < 0 ? rest : rest.slice(0, nextSectionStart)
}

function extractStartStatusLiterals(section: string): string[] {
  const statusList = section.match(/start status \((?<statuses>[^)]*)\)/u)
    ?.groups?.statuses
  if (!statusList) {
    throw new Error('Phone-call prompt does not name start statuses')
  }

  return Array.from(
    statusList.matchAll(/`(?<status>[^`]+)`/gu),
    (match) => match.groups?.status ?? '',
  )
}

function createCommonCodexPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract for common Codex route.',
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    assistantKnowledgeToolsAvailable: true,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    onboardingGuidance: true,
    modelBehaviorProfile: 'gpt5-agentic',
    turnTrigger: null,
    assistantContextSnapshotPrompt: null,
    ...overrides,
  }
}

function createNotificationDecisionPromptInput(
  overrides: Partial<AssistantNotificationDecisionSystemPromptInput> = {},
): AssistantNotificationDecisionSystemPromptInput {
  return {
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    channel: 'telegram',
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    ...overrides,
  }
}
