import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { MURPH_PRODUCT_ORIGIN } from '@murphai/contracts'

import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import {
  buildAssistantSystemPromptLayers,
  type AssistantSystemPromptInput,
} from '../src/assistant/system-prompt.js'

const baseConversationInput: AssistantSystemPromptInput = {
  assistantCliContract: null,
  assistantContextSnapshotPrompt: 'Context snapshot block.',
  assistantDynamicContextPrompts: [
    'Connected wearable sync status for this turn:\n- WHOOP currently needs reconnect.',
  ],
  channel: 'local',
  cliAccess: {
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  },
  currentLocalDate: '2026-06-29',
  currentTimeZone: 'America/New_York',
  modelBehaviorProfile: 'gpt5-agentic',
  onboardingGuidance: false,
}

describe('assistant dynamic context prompt blocks', () => {
  it('uses hosted direct current time without treating group time as personal', () => {
    const hostedDirectLayers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      conversationScope: 'direct',
      hostedRuntime: true,
    })
    const hostedGroupLayers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      conversationScope: 'group',
      hostedRuntime: true,
    })

    expect(hostedDirectLayers.threadContextPrompt).toContain(
      "use the user's current local time to adapt suggestions about meals, sleep, caffeine, and exercise",
    )
    expect(hostedGroupLayers.threadContextPrompt).toContain(
      'The runtime member is a synthetic room container, not the human speaker',
    )
    expect(hostedGroupLayers.threadContextPrompt).not.toContain(
      'use the user\'s current local time',
    )
    expect(
      buildAssistantSystemPromptLayers({
        ...baseConversationInput,
        conversationScope: 'direct',
      }).threadContextPrompt,
    ).not.toContain('use the user\'s current local time')
  })

  it.each(['direct', 'group'] as const)(
    'adds the conversational low-usage rule for hosted %s chats',
    (conversationScope) => {
      const layers = buildAssistantSystemPromptLayers({
        ...baseConversationInput,
        conversationScope,
        hostedRuntime: true,
      })

      expect(layers.stableRouteCapabilityPrompt).toContain('Low hosted usage:')
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'complete the user\'s current request first',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'before answering an explicit hosted plan, AI-usage, billing, Family-member usage, or group-funding request',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'explicit-request or first-heads-up route as applicable',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'single final usage-segment contract only for an assistant-initiated heads-up',
      )
      expect(layers.stableRouteCapabilityPrompt).not.toContain(
        'with the `---` delimiter only when the channel reply-style guidance supports bubbles',
      )
      if (conversationScope === 'group') {
        expect(layers.stableRouteCapabilityPrompt).toContain(
          'append the usage segment as the final paragraph of the one group text bubble and never use the `---` delimiter',
        )
        expect(layers.stableRouteCapabilityPrompt).not.toContain(
          'assistant-initiated direct heads-up',
        )
      } else {
        expect(layers.stableRouteCapabilityPrompt).toContain(
          'use the `---` delimiter only when the active channel reply-style guidance expressly permits that delimiter',
        )
        expect(layers.stableRouteCapabilityPrompt).not.toContain(
          'assistant-initiated group heads-up',
        )
      }
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'Do not send a separate warning or repeat one already visible',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        '`murph.plan_usage` is read-only and changes neither billing, Family state, nor usage credit',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        "For a personal or Family owner-self add-usage request that passes the relevant skill's authorization gates, use only that skill's selector-bearing handoff; never add or substitute the generic Settings route",
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        `For any other explicit personal billing or unsupported Family administration, provide \`${MURPH_PRODUCT_ORIGIN}/settings#subscription\` only after \`status\` is \`active\` or \`exhausted\``,
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'never provide it for `group_not_supported` or `hosted_access_inactive`',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'For a target-specific personal plan change, use only signed `change_plan`',
      )
      expect(layers.stableRouteCapabilityPrompt).toContain(
        'never use an unquoted legacy subscription action',
      )
    },
  )

  it('keeps the explicit group-email usage-progress contract resident', () => {
    const layers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      channel: 'email',
      conversationScope: 'group',
      hostedRuntime: true,
    })

    expect(layers.stableRouteCapabilityPrompt).toContain(
      'Group email has no filesystem access. Do not try to read a usage skill.',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'call `murph.group action="read_usage"` exactly once',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'For an integer from 0 through 99, answer exactly',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'For 100, answer exactly',
    )
    expect(layers.stableRouteCapabilityPrompt).toContain(
      'authoritative included-usage progress figure for this room is unavailable right now',
    )
    expect(layers.stableRouteCapabilityPrompt).not.toContain(
      'Read `$MURPH_ASSISTANT_SKILLS_ROOT/hosted-low-usage/SKILL.md`',
    )
  })

  it('keeps selector-bearing add-usage routes exclusive in the assembled billing prompt stack', async () => {
    const layers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      conversationScope: 'direct',
      hostedRuntime: true,
    })
    const groupLayers = buildAssistantSystemPromptLayers({
      ...baseConversationInput,
      conversationScope: 'group',
      hostedRuntime: true,
    })
    const skillsRoot = resolveAssistantSkillsRoot()
    const [lowUsageSkill, familySkill] = await Promise.all([
      readFile(path.join(skillsRoot, 'hosted-low-usage', 'SKILL.md'), 'utf8'),
      readFile(path.join(skillsRoot, 'murph-family', 'SKILL.md'), 'utf8'),
    ])
    const assembledBillingPrompt = [
      layers.stableRouteCapabilityPrompt,
      lowUsageSkill,
      familySkill,
    ].join('\n')
    const assembledGroupFundingPrompt = [
      groupLayers.staticCacheableCorePrompt,
      groupLayers.stableRouteCapabilityPrompt,
      lowUsageSkill,
    ].join('\n')
    const genericSettingsRoute = `${MURPH_PRODUCT_ORIGIN}/settings#subscription`
    const personalAddUsageRoute =
      `${MURPH_PRODUCT_ORIGIN}/settings?addUsage=true#subscription`
    const familyOwnerSelfAddUsageRoute =
      `${MURPH_PRODUCT_ORIGIN}/settings?addUsage=family#family`

    expect(assembledBillingPrompt).toContain(
      "For a personal or Family owner-self add-usage request that passes the relevant skill's authorization gates, use only that skill's selector-bearing handoff; never add or substitute the generic Settings route",
    )
    expect(assembledBillingPrompt).not.toContain(
      'For explicit personal billing or unsupported Family administration',
    )
    expect(layers.stableRouteCapabilityPrompt).not.toContain(
      personalAddUsageRoute,
    )
    expect(layers.stableRouteCapabilityPrompt).not.toContain(
      familyOwnerSelfAddUsageRoute,
    )
    expect(lowUsageSkill).toContain(personalAddUsageRoute)
    expect(lowUsageSkill).toContain(familyOwnerSelfAddUsageRoute)
    expect(familySkill).toContain(familyOwnerSelfAddUsageRoute)
    expect(lowUsageSkill).not.toContain(genericSettingsRoute)
    expect(familySkill).not.toContain(genericSettingsRoute)
    expect(assembledBillingPrompt.split(genericSettingsRoute)).toHaveLength(2)
    expect(groupLayers.staticCacheableCorePrompt).toContain(
      'after someone directly asks to fund, sponsor, contribute, pay to add usage, or receive its funding link',
    )
    expect(groupLayers.staticCacheableCorePrompt).toContain(
      'after they ask generically how to get or add more usage, keep the room going, or accept an explanation of the group\'s usage options',
    )
    expect(assembledGroupFundingPrompt).not.toContain(
      'on a trusted low-usage turn or after the group asks',
    )
    expect(lowUsageSkill.replace(/\s+/gu, ' ')).toContain(
      'Never send it in the first assistant-initiated heads-up',
    )
  })

  it('injects runtime dynamic context before the context snapshot on conversation turns', () => {
    const layers = buildAssistantSystemPromptLayers(baseConversationInput)

    expect(layers.dynamicTurnContextPrompt).toContain(
      'Connected wearable sync status for this turn'
    )
    expect(layers.dynamicTurnContextPrompt.indexOf(
      'Connected wearable sync status for this turn'
    )).toBeLessThan(
      layers.dynamicTurnContextPrompt.indexOf('Context snapshot block.')
    )
  })

  it('injects runtime dynamic context into ordinary scheduled turns too', () => {
    const layers = buildAssistantSystemPromptLayers({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: 'Context snapshot block.',
      assistantDynamicContextPrompts: [
        'Connected wearable sync status for this turn:\n- WHOOP currently needs reconnect.',
      ],
      channel: 'local',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-06-29',
      currentTimeZone: 'America/New_York',
      modelBehaviorProfile: 'gpt5-agentic',
      onboardingGuidance: false,
      scheduledOccurrenceAt: '2026-06-29T13:00:00.000Z',
      turnTrigger: 'automation-cron',
    })

    expect(layers.dynamicTurnContextPrompt).toContain(
      'Connected wearable sync status for this turn'
    )
    expect(layers.dynamicTurnContextPrompt.indexOf(
      'Connected wearable sync status for this turn'
    )).toBeLessThan(
      layers.dynamicTurnContextPrompt.indexOf('Context snapshot block.')
    )
  })
})
