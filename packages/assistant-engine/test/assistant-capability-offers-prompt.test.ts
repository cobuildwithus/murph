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
