import { MURPH_PRODUCT_ORIGIN } from '@murphai/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildAssistantSystemPrompt,
  buildAssistantSystemPromptLayers,
  buildAssistantSystemPromptResult,
  resolveAssistantMurphProductBaseUrl,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const blockIds = (input: AssistantSystemPromptInput) =>
  buildAssistantSystemPromptLayers(input).blocks.map((block) => block.id)
const blockText = (input: AssistantSystemPromptInput, id: string) =>
  buildAssistantSystemPromptLayers(input).blocks.find((block) => block.id === id)?.text ?? null

describe('assistant execution prompt contract', () => {
  it('carries the late-result policy in one block on hosted ordinary turns only', () => {
    // Private chat states it inside the background-workers block; a group
    // room, which has no such block, carries the standalone policy.
    const carriers = (overrides: Partial<AssistantSystemPromptInput>) =>
      blockIds(createCommonCodexPromptInput({ ordinaryInboundTurn: true, ...overrides }))
        .filter((id) =>
          id === 'route.late-child-results' || id === 'route.non-blocking-delegation')

    expect(carriers({ hostedRuntime: true })).toEqual(['route.non-blocking-delegation'])
    expect(carriers({ hostedRuntime: true, turnTrigger: 'automation-auto-reply' }))
      .toEqual(['route.non-blocking-delegation'])
    expect(carriers({ conversationScope: 'group', hostedRuntime: true }))
      .toEqual(['route.late-child-results'])
    expect(carriers({ hostedRuntime: true, ordinaryInboundTurn: false })).toEqual([])
    expect(carriers({ hostedRuntime: false })).toEqual([])
    expect(carriers({ conversationScope: 'group', hostedRuntime: false })).toEqual([])
    expect(carriers({ conversationScope: 'unverified-external', hostedRuntime: true }))
      .toEqual([])
  })

  it.each(['humor', 'push', 'detail', 'unhinged'] as const)(
    'maps %s scores into five bands: 0, 1-3, 4-6, 7-9 and 10',
    (dial) => {
      // Scores in one band render the same guidance apart from the number itself.
      const bands = new Map<string, number[]>()
      for (let score = 0; score <= 10; score += 1) {
        const text = blockText(
          createCommonCodexPromptInput({ assistantPersonality: { [dial]: score } }),
          'thread.personality-dials',
        )
        expect(text).toContain(`${score}/10`)
        const band = text!.replaceAll(`${score}/10`, 'N/10')
        bands.set(band, [...(bands.get(band) ?? []), score])
      }

      expect([...bands.values()]).toEqual([[0], [1, 2, 3], [4, 5, 6], [7, 8, 9], [10]])
    },
  )

  it('names no private style tool, command or settings link when style settings are off', () => {
    const layers = buildAssistantSystemPromptLayers(
      createCommonCodexPromptInput({
        assistantStyleSettingsAvailable: false,
      }),
    )

    for (const privateStyleReference of [
      '/settings?voice=true',
      'vault-cli assistant style',
      'murph.assistant_style',
    ]) {
      expect(layers.stableRouteCapabilityPrompt).not.toContain(privateStyleReference)
    }
  })
})

describe('assistant hosted wearable connection guidance', () => {
  const providerList = 'Oura (`oura`) and WHOOP (`whoop`)'

  it('lists exactly the wearable providers the host can connect', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput({
      assistantAndroidAppAvailable: true,
      onboardingGuidance: true,
    }))

    expect(prompt).toContain(providerList)
    expect(prompt).toContain(MURPH_PRODUCT_ORIGIN)
  })

  it('lists no wearable providers when the host can connect none', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput({
      assistantHostedDeviceConnectProviders: [],
      hostedRuntime: true,
      onboardingGuidance: false,
    }))

    expect(prompt).not.toContain(providerList)
  })

  it('changes the proof-free link rule when the Android app is available', () => {
    const rule = (assistantAndroidAppAvailable: boolean) => blockText(
      createCommonCodexPromptInput({ assistantAndroidAppAvailable }),
      'core.tool-truthfulness.direct',
    )

    expect(rule(true)).toContain(MURPH_PRODUCT_ORIGIN)
    expect(rule(false)).toContain(MURPH_PRODUCT_ORIGIN)
    expect(rule(true)).not.toBe(rule(false))
  })
})

describe('assistant system prompt layers', () => {
  it('passes the injected CLI contract through byte-for-byte at the stable-route tail', () => {
    const cliContract = [
      'CLI-CONTRACT-SENTINEL-BEGIN',
      '  preserve leading spaces, punctuation: []{}<>',
      'preserve\ttabs and repeated  spaces',
      'CLI-CONTRACT-SENTINEL-END',
    ].join('\n')
    const layers = buildAssistantSystemPromptLayers(
      createCommonCodexPromptInput({ assistantCliContract: cliContract }),
    )

    expect(layers.stableRouteCapabilityPrompt.endsWith(cliContract)).toBe(true)
    expect(
      layers.stableRouteCapabilityPrompt.slice(-cliContract.length),
    ).toBe(cliContract)
    expect(layers.prompt.match(/CLI-CONTRACT-SENTINEL-BEGIN/g) ?? []).toHaveLength(1)
  })

  it('partitions thread-stable context away from per-turn Codex context', () => {
    const layers = buildAssistantSystemPromptLayers(createCommonCodexPromptInput({
      currentLocalDate: '2026-04-15',
      currentTimeZone: 'Asia/Kuala_Lumpur',
      murphProductBaseUrl: 'http://localhost:3000',
      onboardingGuidance: true,
      scheduledOccurrenceAt: '2026-04-15T13:00:00.000Z',
      turnTrigger: 'automation-cron',
    }))

    const stablePrefix = [
      layers.staticCacheableCorePrompt,
      layers.stableRouteCapabilityPrompt,
    ].join('\n\n')

    expect(layers.prompt.startsWith(stablePrefix)).toBe(true)
    expect(stablePrefix).not.toContain('Asia/Kuala_Lumpur')

    expect(layers.threadContextPrompt).toContain(
      'Asia/Kuala_Lumpur',
    )
    expect(layers.threadContextPrompt).toContain(
      'http://localhost:3000',
    )
    expect(layers.threadContextPrompt).not.toContain(
      'April 15, 2026',
    )

    expect(layers.dynamicTurnContextPrompt).toContain(
      'April 15, 2026',
    )
    expect(layers.dynamicTurnContextPrompt).toContain('Asia/Kuala_Lumpur')
    expect(layers.prompt.endsWith(layers.dynamicTurnContextPrompt)).toBe(true)
  })

  it.each(['direct', 'group'] as const)(
    'gives %s scheduled work a lean prompt made of attended blocks',
    (conversationScope) => {
      const input = createCommonNotificationPromptInput({
        assistantHostedAutomationAvailable: true,
        assistantPollsAvailable: true,
        conversationScope,
        hostedRuntime: true,
        onboardingGuidance: conversationScope === 'direct',
      })
      const scheduledLayers = buildAssistantSystemPromptLayers(input)
      const regularLayers = buildAssistantSystemPromptLayers({
        ...input,
        ordinaryInboundTurn: true,
        scheduledOccurrenceAt: null,
        turnTrigger: null,
      })
      const scheduledIds = scheduledLayers.blocks.map((block) => block.id)
      const regularIds = regularLayers.blocks.map((block) => block.id)
      const regularText = new Map(
        regularLayers.blocks.map((block) => [block.id, block.text]),
      )

      // Outside the turn layer, a scheduled turn only drops blocks: what it
      // keeps is the attended block, unchanged. The one addition is the
      // location rule for outdoor reminders, which only unattended private
      // turns carry.
      for (const block of scheduledLayers.blocks) {
        if (block.layer !== 'turn' && block.id !== 'route.private-reminder-location') {
          expect(regularText.get(block.id), block.id).toBe(block.text)
        }
      }
      expect(scheduledIds.includes('route.private-reminder-location')).toBe(
        conversationScope === 'direct',
      )
      expect(regularIds).not.toContain('route.private-reminder-location')
      // Every privacy, safety and authority boundary of the route is kept.
      for (const block of regularLayers.blocks) {
        if (block.boundary) {
          expect(scheduledIds).toContain(block.id)
        }
      }
      // Blocks about answering, capturing, offering and authoring are dropped.
      for (const id of [
        `route.turn-priority.${conversationScope}`,
        ...(conversationScope === 'direct'
          ? ['route.non-blocking-delegation'] as const
          : ['route.delegated-initiative', 'route.late-child-results'] as const),
        'route.low-usage',
        'route.capability-offers',
        'route.message-reactions',
        'route.product-updates',
        'route.automation',
      ] as const) {
        expect(regularIds).toContain(id)
        expect(scheduledIds).not.toContain(id)
      }
      expect(scheduledIds).not.toContain('thread.onboarding')
      // Scheduled runs post polls in group rooms, not in a private chat.
      expect(regularIds).toContain('route.native-polls')
      expect(scheduledIds.includes('route.native-polls')).toBe(
        conversationScope === 'group',
      )
      // What a run needs to read, reason and write for the channel stays.
      for (const id of [
        conversationScope === 'direct' ? 'core.how-you-help.direct' : 'core.product-principles',
        'route.tool-discovery',
        'route.skill-router',
        'route.execution-behavior',
        'route.cli-guidance',
        'thread.time-style',
        'thread.tone',
        'thread.reply-style',
        'turn.execution-context',
        'turn.scheduled-occurrence',
        'turn.delivery-decision-contract',
      ] as const) {
        expect(scheduledIds).toContain(id)
      }
      // The run's own context blocks never reach an attended turn.
      for (const id of ['turn.execution-context', 'turn.delivery-decision-contract'] as const) {
        expect(regularIds).not.toContain(id)
      }
      expect(scheduledLayers.threadContextPrompt).toContain('Asia/Kuala_Lumpur')
      expect(Buffer.byteLength(scheduledLayers.prompt, 'utf8')).toBeLessThan(
        Buffer.byteLength(regularLayers.prompt, 'utf8'),
      )
    },
  )

  it('renders current date context with natural user-facing date guidance', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput({
      currentLocalDate: '2026-04-03',
    }))
    const notificationPrompt =
      buildAssistantSystemPromptResult(
        createCommonNotificationPromptInput({
          currentLocalDate: '2026-04-03',
        }),
      ).prompt

    expect(prompt).toContain('April 3, 2026')
    expect(notificationPrompt).toContain(
      'April 3, 2026',
    )
  })

  it('keeps the common route core stable across per-turn context', () => {
    const a = buildAssistantSystemPromptLayers(createCommonCodexPromptInput({
      channel: 'telegram', currentInstant: '2027-02-14T07:17:05.678Z',
      currentLocalDate: '2027-02-13', currentTimeZone: 'America/Los_Angeles',
      conversationScope: 'direct', hostedRuntime: true,
      murphProductBaseUrl: 'http://localhost:3000',
    }))
    const b = buildAssistantSystemPromptLayers(createCommonCodexPromptInput({
      channel: 'sms', currentInstant: '2027-07-02T03:04:05.678Z',
      currentLocalDate: '2027-07-01', currentTimeZone: 'America/Los_Angeles',
      conversationScope: 'direct', hostedRuntime: true,
      murphProductBaseUrl: 'https://withmurph.ai',
    }))
    expect(a.staticCacheableCorePrompt).toBe(b.staticCacheableCorePrompt)
    expect(a.stableRouteCapabilityPrompt).toBe(b.stableRouteCapabilityPrompt)
    expect(a.staticCacheableCorePrompt.length).toBeGreaterThan(8_000)
    expect(a.stableRouteCapabilityPrompt).not.toContain('2027-02-14T07:17:05.678Z')
    expect(a.stableRouteCapabilityPrompt).not.toContain('http://localhost:3000')
    expect(a.dynamicTurnContextPrompt).toContain('2027-02-13 23:17:05 [UTC 2027-02-14T07:17:05.678Z]')
    expect(b.dynamicTurnContextPrompt).toContain('2027-07-01 20:04:05 [UTC 2027-07-02T03:04:05.678Z]')
    expect(a.threadContextPrompt).toContain('http://localhost:3000')
  })

  it('keeps onboarding activation out of the stable route core', () => {
    const open = buildAssistantSystemPromptLayers(createCommonCodexPromptInput({ onboardingGuidance: true }))
    const closed = buildAssistantSystemPromptLayers(createCommonCodexPromptInput({ onboardingGuidance: false }))
    expect(open.staticCacheableCorePrompt).toBe(closed.staticCacheableCorePrompt)
    expect(open.stableRouteCapabilityPrompt).toBe(closed.stableRouteCapabilityPrompt)
  })

  it('keeps scheduled route capabilities stable across occurrence context', () => {
    const a = buildAssistantSystemPromptLayers(createCommonNotificationPromptInput({
      channel: 'telegram', currentLocalDate: '2026-04-15', currentTimeZone: 'Asia/Kuala_Lumpur',
    }))
    const b = buildAssistantSystemPromptLayers(createCommonNotificationPromptInput({
      channel: 'sms', currentLocalDate: '2026-04-16', currentTimeZone: 'America/Los_Angeles',
    }))
    expect(a.staticCacheableCorePrompt).toBe(b.staticCacheableCorePrompt)
    expect(a.stableRouteCapabilityPrompt).toBe(b.stableRouteCapabilityPrompt)
    expect(a.stableRouteCapabilityPrompt).not.toContain('Asia/Kuala_Lumpur')
    expect(a.dynamicTurnContextPrompt).toContain('Asia/Kuala_Lumpur')
    expect(b.dynamicTurnContextPrompt).toContain('America/Los_Angeles')
  })
})

describe('assistant experiment onboarding guidance', () => {
  it('resolves the injected Murph product base URL from hosted public env', () => {
    expect(resolveAssistantMurphProductBaseUrl({
      HOSTED_WEB_BASE_URL: 'http://localhost:3000',
    })).toBe('http://localhost:3000')
    expect(resolveAssistantMurphProductBaseUrl({
      VERCEL_PROJECT_PRODUCTION_URL: 'withmurph.ai',
    })).toBe('https://withmurph.ai')
    expect(resolveAssistantMurphProductBaseUrl({
      HOSTED_ONBOARDING_PUBLIC_BASE_URL: 'https://join.example.test',
      HOSTED_WEB_BASE_URL: 'https://web.example.test',
    })).toBe('https://join.example.test')
  })

  it('falls back to the canonical production origin when no public env is configured', () => {
    expect(resolveAssistantMurphProductBaseUrl({})).toBe(MURPH_PRODUCT_ORIGIN)
    expect(resolveAssistantMurphProductBaseUrl({
      HOSTED_WEB_BASE_URL: 'not a url',
    })).toBe(MURPH_PRODUCT_ORIGIN)
  })
})

describe('assistant conversation scope', () => {
  it('keeps the personal CLI contract out of group prompts', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput({
      assistantCliContract: [
        'vault-cli device connect <provider> --format json',
        'vault-cli assistant style set humor 10 --format json',
      ].join('\n'),
      conversationScope: 'group',
      hostedRuntime: true,
    }))

    expect(prompt).not.toContain('vault-cli assistant style set')
    expect(prompt).not.toContain('vault-cli device connect <provider>')
  })

  it('fails closed for an unknown external audience: no CLI contract and no timezone', () => {
    const prompt = buildAssistantSystemPrompt(createCommonCodexPromptInput({
      assistantCliContract: 'PERSONAL_CLI_CONTRACT',
      conversationScope: 'unverified-external',
    }))

    expect(prompt).not.toContain('PERSONAL_CLI_CONTRACT')
    expect(prompt).not.toContain('Asia/Kuala_Lumpur')
  })
})

function createCommonCodexPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract for common Codex route.',
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    onboardingGuidance: true,
    turnTrigger: null,
    ...overrides,
  }
}

function createCommonNotificationPromptInput(
  overrides: Partial<AssistantSystemPromptInput> = {},
): AssistantSystemPromptInput {
  return {
    assistantCliContract: 'Stable CLI contract for scheduled turn.',
    assistantHostedDeviceConnectProviders: [
      { label: 'Oura', provider: 'oura' },
      { label: 'WHOOP', provider: 'whoop' },
    ],
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
    },
    currentLocalDate: '2026-04-15',
    currentTimeZone: 'Asia/Kuala_Lumpur',
    onboardingGuidance: false,
    scheduledOccurrenceAt: '2026-04-15T13:00:00.000Z',
    turnTrigger: 'automation-cron',
    ...overrides,
  }
}
