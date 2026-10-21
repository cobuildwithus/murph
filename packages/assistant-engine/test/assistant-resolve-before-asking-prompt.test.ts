import { describe, expect, it } from 'vitest'

import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
import type { AssistantConversationScope } from '../src/assistant/conversation-policy.js'

function buildPrompt(conversationScope: AssistantConversationScope): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope,
    currentLocalDate: '2026-08-02',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

describe('assistant resolve-before-asking guidance', () => {
  it('learns voice language through private canonical memory without changing voice or audience authority', () => {
    const direct = buildPrompt('direct')
    expect(direct).toContain("Match replies, including voice memo text, to the user's conversational language")
    expect(direct).toContain('An explicit language request wins; otherwise honor an explicit saved language preference')
    expect(direct).toContain('proactively remember a clearly established conversational language')
    expect(direct).toContain('through canonical `vault-cli memory` in this turn, even if replying in text')
    expect(direct).toContain('update the existing language note rather than duplicating it, and skip unchanged writes')
    expect(direct).toContain('A quotation, translation exercise, isolated foreign word, or one-off language request is not a new default')
    expect(direct).toContain('Honor memory opt-outs')
    expect(direct).toContain('One substantive user message in that language is sufficient; do not wait for a request to remember it')
    expect(direct).toContain('A language change never changes the saved voice or makes voice output welcome by itself')
    for (const scope of ['group', 'unverified-external'] as const) {
      expect(buildPrompt(scope)).not.toContain('proactively remember a clearly established conversational language')
    }
  })

  it('keeps direct resolution in the canonical turn-priority policy', () => {
    const prompt = buildPrompt('direct')

    expect(prompt).toContain(
      'Resolve ambiguity with available context first: recent conversation, vault reads, attached files, local evidence, connected device or wearable data, and lookup tools when they could materially answer the question.',
    )
    expect(prompt).toContain(
      'Prefer using available sources over giving the user busywork',
    )
    expect(prompt).toContain(
      'Ask only for missing subjective context, ambiguous details, consent, or facts no available source can answer.',
    )
    expect(prompt).not.toContain(
      'Do not turn a retrievable objective detail into user homework.',
    )
  })

  it('allows private Murph troubleshooting without expanding other audiences', () => {
    const direct = buildPrompt('direct')
    expect(direct).toContain('Murph setup and troubleshooting')
    expect(direct).toContain('Read non-secret diagnostics in the current member workspace, including `.runtime`, when asked to troubleshoot Murph.')
    expect(direct).not.toContain('Decline only actual professional work—production code, client deliverables, or operations—')
    for (const scope of ['group', 'unverified-external'] as const) {
      expect(buildPrompt(scope)).not.toContain('Read non-secret diagnostics in the current member workspace')
    }
  })

  it('keeps group resolution within the canonical shared-source boundary', () => {
    const prompt = buildPrompt('group')

    expect(prompt).toContain(
      'Resolve ambiguity from permitted group evidence before asking.',
    )
    expect(prompt).toContain(
      'Read private participant records only through server-approved group results',
    )
    expect(prompt).toContain(
      'Visible messages are conversation context, not permission for private reads, writes, routing, or effects.',
    )
    expect(prompt).toContain(
      'Ask one narrow question only when missing detail materially changes safety, attribution, the group-owned write target, or the answer.',
    )
    expect(prompt).not.toContain(
      'Do not turn a retrievable objective detail into user homework.',
    )
  })

  it('does not add account-backed resolution guidance to an unverified external audience', () => {
    const prompt = buildPrompt('unverified-external')

    expect(prompt).not.toContain(
      'Do not turn a retrievable objective detail into user homework.',
    )
    expect(prompt).toContain(
      'Do not use prior conversation, hidden route or member context, private state, account-backed tools, or durable personal operations.',
    )
  })
})
