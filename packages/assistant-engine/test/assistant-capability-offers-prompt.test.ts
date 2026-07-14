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

  it('keeps offers adjacent, available, and outcome-focused', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('Complete the request first')
    expect(section).toContain("turn priority's single next-step offer")
    expect(section).toContain('not an additional item')
    expect(section).toContain('available now')
    expect(section).toContain('materially advances the same health goal')
    expect(section).toContain('No menus')
    expect(section).toContain('re-offers after a decline')
    expect(section).toContain('real-world outcome, not tool names or internal plumbing')
  })

  it('surfaces latent fit before applying owning eligibility gates', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('Undiscovered capabilities are effectively absent')
    expect(section).toContain('repeated manual health reporting')
    expect(section).toContain('recurring friction or forgetting')
    expect(section).toContain('a named data source')
    expect(section).toContain('longitudinal visual tracking')
    expect(section).toContain('group accountability/update context')
    expect(section).toContain('owning availability and eligibility gates')
  })

  it('keeps consent bounded and setup separate from activation', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('only the exact bounded offer')
    expect(section).toContain('setup conversation only, not activation')
    expect(section).toContain('Recurrence, OAuth, shared health data, other people')
    expect(section).toContain('money, and irreversible actions')
    expect(section).toContain('concrete final scope and confirmation')
    expect(section).toContain('subject to the owning action\'s consent')
  })

  it('suppresses harmful or misplaced offers while retaining narrow group gates', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('urgent, emotionally sensitive, flare, or low-capacity')
    expect(section).toContain('suppress unrelated offers')
    expect(section).toContain('broad account scans')
    expect(section).toContain('enrollment of other people')
    expect(section).toContain('spending, prescription changes')
    expect(section).toContain('body/diagnosis leaderboards')
    expect(section).toContain('Group challenges are group-chat only')
    expect(section).toContain(
      'weekly group newsletter is setup-only, never immediate',
    )
  })

  it('names newsletter mechanics inside hosted-group guidance', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      HOSTED_GROUPS_HEADER,
    )

    expect(section).toContain('`murph.newsletter`')
    expect(section).toContain('`prepare` returns authorized current-week facts')
    expect(section).toContain('compose only from `result.members`')
    expect(section).not.toContain('`vault-cli group weekly')
    expect(section).toContain('`send` rechecks authorization')
    expect(section).toContain('never returns raw email addresses')
    expect(section).toContain('never send the first edition immediately')
    expect(section).toContain('normal `vault-cli automation` surface')
  })

  it('delegates capability mechanics and stays compact', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      CAPABILITY_OFFERS_HEADER,
    )

    expect(section).toContain('Capability mechanics live in the owning')
    expect(section).toContain('do not promise implementation beyond it')
    expect(Buffer.byteLength(section, 'utf8')).toBeLessThanOrEqual(1_600)
  })

  it('keeps phone-call start-status wording aligned with the hosted schema', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      PHONE_CALLS_HEADER,
    )
    const promptStatuses = extractStartStatusLiterals(section)

    expect(promptStatuses).toEqual(['starting', 'calling', 'failed'])
    expect(section).toContain('provider accepted or placed it')
    expect(section).toContain('including one already ended')
    expect(section).toContain('attempt was unsuccessful')
    expect(section).toContain('not that no provider attempt occurred')
    for (const status of promptStatuses) {
      expect(
        hostedPhoneCallStartResponseSchema.safeParse({
          phoneCallId: 'phone-call-test',
          status,
        }).success,
      ).toBe(true)
    }
  })

  it('routes appointment calls through a complete preflight while preserving natural caller identity', () => {
    const section = getPromptSection(
      buildAssistantSystemPromptLayers(createCommonCodexPromptInput())
        .stableRouteCapabilityPrompt,
      PHONE_CALLS_HEADER,
    )

    expect(section).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md')
    expect(section).toContain('satisfy its ready-to-act gate')
    expect(section).toContain('context, memory, and the official site')
    expect(section).toContain('identity alone is incomplete')
    expect(section).toContain('Resolve missing brief fields')
    expect(section).toContain(
      'Information-only or test calls must stay non-mutating, remain separate, and never count as readiness',
    )
    expect(section).toContain('Set `callerName` to the user-approved first name')
    expect(section).toContain('Put approved, needed facts in `shareableFacts`')
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
