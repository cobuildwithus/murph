import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_GROUP_SHARED_FRESHNESS_INSTRUCTION,
} from '../src/assistant/group-shared-freshness.js'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'

describe('group shared metric presentation prompt', () => {
  it('separates same-row name presentation from sender effects', () => {
    const prompt = buildHostedGroupSharedPrompt()

    expect(prompt).toContain(
      'pair projections only with the `displayName` in the same `read_shared` member row',
    )
    expect(prompt).toContain('unless anonymization was requested')
    expect(prompt).toContain('Never map a name across rows by order, values, or conversation')
    expect(prompt).toContain(
      'For explicit current visibility or explicitly present-time attribution of a consented shared metric',
    )
    expect(prompt).toContain(
      'If a needed name is missing, duplicated, or otherwise ambiguous, state that narrow limitation',
    )
    expect(prompt).toContain(
      'use the tool-supplied names without reconfirming them',
    )
    expect(prompt).toContain(
      'A fresh read may label every dated record returned in its rows',
    )
    expect(prompt).toContain(
      'must not retroactively label separate unlabeled figures quoted earlier in the conversation',
    )
    expect(prompt).toContain(
      'A `displayName` returned in a participant or shared-data row labels that row only',
    )
    expect(prompt).toContain(
      'Never use a name to select a different message, row, participant, route, or tool target',
    )
    expect(prompt).toContain(
      'For a participant-scoped effect, pass the request-bearing message\'s exact server-issued message_ref',
    )
    expect(prompt).toContain(
      'the host reloads it and derives the sender',
    )
    expect(prompt).toContain(
      'To associate the current speaker with one returned row',
    )
    expect(prompt).toContain(
      'require its exact `Sender:` handle in exactly one row\'s `currentTurnHandles`',
    )
    expect(prompt).toContain('Use `participantId` only as the group-scoped selector')
    expect(prompt).not.toContain('Never infer identity')
    expect(prompt).not.toContain('Participant labels are hypotheses')
    expect(prompt).not.toContain('(display only)')
    expect(prompt.split(
      'Never use a name to select a different message, row, participant, route, or tool target',
    )).toHaveLength(2)
    expect(prompt).not.toMatch(
      /(?:displayName|display name)[^.!?]{0,120}(?:cannot|can't|must not|never)[^.!?]{0,80}(?:label|attribute)[^.!?]{0,80}(?:projection|value)/iu,
    )
    expect(prompt).not.toMatch(
      /(?:^|[.!?]\s+)(?:Ask|Have) (?:the )?(?:members?|participants?|people) [^.!?]{0,80}(?:confirm|reconfirm|verify) [^.!?]{0,80}(?:mapping|who had which)/imu,
    )
  })

  it('mentions only the admitted hosted group tool surface', () => {
    const none = buildHostedGroupSharedPrompt('none')
    const sharedRead = buildHostedGroupSharedPrompt('shared_read')
    const families = buildHostedGroupSharedPrompt('families')

    expect(none).not.toContain('Hosted groups:')
    expect(none).not.toContain('action="read_shared"')
    expect(none).not.toContain('call exact-scope `read_shared` exactly once')

    expect(sharedRead).toContain('`murph.group action="read_shared"`')
    expect(sharedRead).not.toContain('`murph.group_data')
    expect(sharedRead).not.toContain('`murph.group_membership')
    expect(sharedRead).not.toContain('`murph.group_email')
    expect(sharedRead).not.toContain('`action="read_chat_participants"`')
    expect(sharedRead).not.toContain('`action="share_contact_card"`')

    expect(families).toContain('`murph.group_data action="read_shared"`')
    expect(families).toContain('`murph.group_membership action="read_current"`')
    expect(families).toContain('`murph.group_email action="send_email"`')
    expect(families).toContain('`action="read_chat_participants"`')
    expect(families).toContain('`action="share_contact_card"`')
  })

  it('limits group Apple Health recovery to consented same-row evidence', () => {
    const prompt = buildHostedGroupSharedPrompt()
    const noSharedPrompt = buildHostedGroupSharedPrompt('none')
    const diagnosticRule =
      'For a requested missing or stale shared wearable diagnosis'

    expect(prompt.split(diagnosticRule)).toHaveLength(2)
    expect(noSharedPrompt).not.toContain(diagnosticRule)
    expect(prompt).toContain(
      'include its exact metric scope and `device-sync-status.v0` in that read',
    )
    expect(prompt).toContain('The metric alone never identifies Apple Health')
    expect(prompt).toContain(
      'same member row has an unambiguous `displayName`',
    )
    expect(prompt).toContain(
      'exactly one connected source whose public `label` is `Apple Health`',
    )
    expect(prompt).toContain(
      'ask that named person whether Murph is open on their iPhone',
    )
    expect(prompt).toContain('opening Murph lets the Apple Health import run')
    expect(prompt).toContain(
      'without claiming it caused the missing metric',
    )
    expect(prompt).toContain(
      'Never expose provider or account state beyond that consented projection, borrow a name or source across rows',
    )
    expect(prompt).toContain(
      "say opening Apple's Health app refreshes Murph, promise immediate sync",
    )
    expect(prompt).toContain('Keep setup and connection actions private')
    expect(prompt).toContain(
      'If the evidence is absent or ambiguous, keep the cause unknown',
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
    const crossSourceRule = prompt
      .split('\n- ')
      .find((rule) => rule.startsWith('For cross-source presentation'))
    expect(crossSourceRule).toBeDefined()
    expect(crossSourceRule ?? '').not.toMatch(
      /\b(?:Apple Health|Garmin|Oura|WHOOP)\b/u,
    )
  })

})

function buildHostedGroupSharedPrompt(
  assistantHostedGroupToolSurface:
    | 'families'
    | 'shared_read'
    | 'none' = 'shared_read',
): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantHostedGroupToolSurface,
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
