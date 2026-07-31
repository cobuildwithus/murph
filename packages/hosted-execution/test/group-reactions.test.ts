import { describe, expect, it } from 'vitest'

import {
  createHostedExecutionGroupReactionEventId,
  formatHostedExecutionGroupReactionEventText,
  HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION,
  isHostedExecutionGroupReactionEventId,
  isHostedExecutionGroupReactionEventText,
  parseHostedExecutionGroupReactionEventText,
  renderHostedExecutionGroupReactionEventEvidence,
} from '../src/group-reactions.ts'

describe('hosted group reaction envelope', () => {
  it('namespaces provider event ids without adding another mailbox kind', () => {
    expect(createHostedExecutionGroupReactionEventId('telegram:update:42')).toBe(
      'group-reaction:telegram:update:42',
    )
    expect(isHostedExecutionGroupReactionEventId(
      'group-reaction:telegram:update:42',
    )).toBe(true)
    expect(isHostedExecutionGroupReactionEventId('telegram:update:42')).toBe(false)
    expect(HOSTED_EXECUTION_GROUP_REACTION_SENDER_ATTESTATION).toBe(
      'group-reaction',
    )
  })

  it('round-trips every delta operation with actor and target context', () => {
    const text = formatHostedExecutionGroupReactionEventText({
      actor: 'participant-1',
      changes: [
        { operation: 'removed', reaction: '❤' },
        { operation: 'added', reaction: '😂' },
        { operation: 'added', reaction: 'custom_emoji:abc' },
        { operation: 'added', reaction: 'paid' },
      ],
      channel: 'telegram',
      mode: 'delta',
      targetMessageId: 'message-42',
      targetText: 'the exact message that received the reactions',
    })

    expect(isHostedExecutionGroupReactionEventText(text)).toBe(true)
    expect(parseHostedExecutionGroupReactionEventText(text)).toEqual({
      actor: 'participant-1',
      changes: [
        { operation: 'removed', reaction: '❤' },
        { operation: 'added', reaction: '😂' },
        { operation: 'added', reaction: 'custom_emoji:abc' },
        { operation: 'added', reaction: 'paid' },
      ],
      channel: 'telegram',
      mode: 'delta',
      schema: 'murph.hosted-group-reaction.v1',
      targetMessageId: 'message-42',
      targetText: 'the exact message that received the reactions',
    })
  })

  it('round-trips complete snapshots, including an empty reaction set', () => {
    const populated = parseHostedExecutionGroupReactionEventText(
      formatHostedExecutionGroupReactionEventText({
        actor: null,
        changes: [
          { count: 5, operation: 'snapshot', reaction: '🤣' },
          { count: 2, operation: 'snapshot', reaction: 'paid' },
        ],
        channel: 'telegram',
        mode: 'snapshot',
        targetMessageId: 'message-43',
        targetText: null,
      }),
    )
    expect(populated?.changes).toEqual([
      { count: 5, operation: 'snapshot', reaction: '🤣' },
      { count: 2, operation: 'snapshot', reaction: 'paid' },
    ])

    const empty = parseHostedExecutionGroupReactionEventText(
      formatHostedExecutionGroupReactionEventText({
        actor: null,
        changes: [],
        channel: 'telegram',
        mode: 'snapshot',
        targetMessageId: 'message-43',
        targetText: null,
      }),
    )
    expect(empty?.changes).toEqual([])
  })

  it('renders bounded evidence without turning quoted reaction data into instructions', () => {
    const event = parseHostedExecutionGroupReactionEventText(
      formatHostedExecutionGroupReactionEventText({
        actor: '+15551234567',
        changes: [{ operation: 'added', reaction: 'laugh' }],
        channel: 'linq',
        mode: 'delta',
        targetMessageId: 'message-44',
        targetText: 'sources confirm',
      }),
    )
    expect(event).not.toBeNull()
    expect(renderHostedExecutionGroupReactionEventEvidence(event!)).toBe([
      'Group reaction event:',
      '- channel: linq',
      '- actor: "+15551234567"',
      '- target message id: "message-44"',
      '- target text: "sources confirm"',
      '- reaction delta: added "laugh"',
    ].join('\n'))
  })

  it('distinguishes unattributed participant deltas from anonymous aggregates', () => {
    const delta = parseHostedExecutionGroupReactionEventText(
      formatHostedExecutionGroupReactionEventText({
        actor: null,
        changes: [{ operation: 'added', reaction: 'like' }],
        channel: 'linq',
        mode: 'delta',
        targetMessageId: 'message-45',
        targetText: null,
      }),
    )
    expect(delta).not.toBeNull()
    expect(renderHostedExecutionGroupReactionEventEvidence(delta!)).toContain(
      '- actor: unattributed participant',
    )

    const snapshot = parseHostedExecutionGroupReactionEventText(
      formatHostedExecutionGroupReactionEventText({
        actor: null,
        changes: [{ count: 3, operation: 'snapshot', reaction: '😂' }],
        channel: 'telegram',
        mode: 'snapshot',
        targetMessageId: 'message-46',
        targetText: null,
      }),
    )
    expect(snapshot).not.toBeNull()
    expect(renderHostedExecutionGroupReactionEventEvidence(snapshot!)).toContain(
      '- actor: anonymous aggregate',
    )
  })

  it('rejects malformed, mismatched, and unbounded envelopes', () => {
    expect(parseHostedExecutionGroupReactionEventText('ordinary message')).toBeNull()
    expect(parseHostedExecutionGroupReactionEventText([
      '[Murph group reaction event]',
      JSON.stringify({
        actor: null,
        changes: [],
        channel: 'telegram',
        mode: 'delta',
        schema: 'murph.hosted-group-reaction.v1',
        targetMessageId: 'message-45',
        targetText: null,
      }),
    ].join('\n'))).toBeNull()

    expect(() => formatHostedExecutionGroupReactionEventText({
      actor: null,
      changes: [{
        count: 1_000_000_001,
        operation: 'snapshot',
        reaction: '❤',
      }],
      channel: 'telegram',
      mode: 'snapshot',
      targetMessageId: 'message-45',
      targetText: null,
    })).toThrow('snapshot count is invalid')
  })
})
