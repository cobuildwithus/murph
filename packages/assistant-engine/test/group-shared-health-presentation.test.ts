import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_GROUP_SHARED_FRESHNESS_INSTRUCTION,
} from '../src/assistant/group-shared-freshness.js'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'

describe('group shared metric presentation prompt', () => {
  it('keeps labeled shared rows atomic without weakening sender authority', () => {
    const prompt = buildHostedGroupSharedPrompt()

    expect(prompt).toContain(
      'Treat each `read_shared` member row as one atomic presentation unit',
    )
    expect(prompt).toContain(
      '`displayName` labels only the projections in that same row',
    )
    expect(prompt).toContain(
      'use those row labels for participant-specific observations and cross-participant numeric comparisons',
    )
    expect(prompt).toContain('unless the group requested anonymization')
    expect(prompt).toContain(
      'Never rebuild a name-to-value mapping from row order, value matching, or conversation',
    )
    expect(prompt).toContain(
      'For explicit current visibility or explicitly present-time attribution of a consented shared metric',
    )
    expect(prompt).toContain(
      'If a needed label is absent or ambiguous, do not guess; state only that narrow row-label limitation',
    )
    expect(prompt).toContain(
      'When the relevant rows have usable, unambiguous labels, never ask people to confirm the mapping already supplied by the tool',
    )
    expect(prompt).toContain(
      'For explicitly present-time attribution such as "who has which values now?", answer only from the fresh exact-scope result',
    )
    expect(prompt).toContain(
      'use only an explicit prior name-to-value association visible in the conversation',
    )
    expect(prompt).toContain(
      'never use a different fresh snapshot to retroactively map those earlier figures',
    )
    expect(prompt).toContain(
      'label it clearly as current',
    )
    expect(prompt).toContain('This row association is presentation only')
    expect(prompt).toContain(
      'never authenticates a sender, selects another row, grants consent, or supplies authority',
    )
    expect(prompt).toContain(
      'existing group-scoped `participantId` and exact `currentTurnHandles` rules remain the only sender/authority boundary',
    )
    expect(prompt).toContain(
      "For attribution, an exact `Sender:` handle must appear in exactly one returned member's `currentTurnHandles`",
    )
    expect(prompt).toContain(
      "use that row's group-scoped `participantId`, never name, order, values",
    )
    expect(prompt).toContain(
      'Scheduled and detached reads have no current-turn handles',
    )
    expect(prompt).not.toMatch(
      /(?:displayName|display name)[^.!?]{0,120}(?:cannot|can't|must not|never)[^.!?]{0,80}(?:label|attribute)[^.!?]{0,80}(?:projection|value)/iu,
    )
    expect(prompt).not.toMatch(
      /(?:^|[.!?]\s+)(?:Ask|Have) (?:the )?(?:members?|participants?|people) [^.!?]{0,80}(?:confirm|reconfirm|verify) [^.!?]{0,80}(?:mapping|who had which)/imu,
    )
  })

  it('chooses one best-supported cross-source value by default', () => {
    const prompt = ASSISTANT_GROUP_SHARED_FRESHNESS_INSTRUCTION

    expect(prompt).toContain('preserve source-tagged records as separate evidence')
    expect(prompt).toContain('do not persist a canonical value')
    expect(prompt).toContain('alter, sum, average, or silently merge source records')
    expect(prompt).toContain('does not require listing every device')
    expect(prompt).toContain('present one best-supported value by default')
    expect(prompt).toContain(
      'for steps and total sleep, prefer the larger plausible value',
    )
    expect(prompt).toContain(
      'Mention alternate values or the selected source only when',
    )
    expect(prompt).not.toMatch(/\b(?:Apple Health|Garmin|Oura|WHOOP)\b/u)
  })

})

function buildHostedGroupSharedPrompt(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantHostedGroupToolSurface: 'shared_read',
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'group',
    currentLocalDate: '2026-08-27',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}
