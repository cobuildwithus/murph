import { describe, expect, it } from 'vitest'

import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'

import {
  createAssistantBinding,
  getAssistantBindingContextLines,
  getAssistantBindingIsolationConflicts,
  getAssistantDisplayTarget,
  mergeAssistantBinding,
  resolveAssistantBindingDelivery,
  resolveAssistantConversationKey,
} from '../src/assistant/bindings.ts'

describe('assistant bindings', () => {
  it('resolves conversation keys from normalized thread and actor scopes', () => {
    expect(
      resolveAssistantConversationKey({
        actorId: ' actor/direct ',
        channel: ' telegram ',
        identityId: ' identity+value ',
      }),
    ).toBe(
      'channel:telegram|identity:identity%2Bvalue|actor:actor%2Fdirect',
    )

    expect(
      resolveAssistantConversationKey({
        actorId: ' actor-1 ',
        channel: ' email ',
        identityId: ' inbox@example.com ',
        threadId: ' thread/with spaces ',
        threadIsDirect: false,
      }),
    ).toBe(
      'channel:email|identity:inbox%40example.com|thread:thread%2Fwith%20spaces',
    )

    expect(
      resolveAssistantConversationKey({
        actorId: 'actor-2',
        channel: 'telegram',
        threadIsDirect: false,
      }),
    ).toBeNull()

    expect(
      resolveAssistantConversationKey({
        actorId: 'actor-3',
      }),
    ).toBeNull()
  })

  it('reports only real isolation conflicts and distinguishes replace from clear', () => {
    const binding = createAssistantBinding({
      actorId: 'actor-1',
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
      threadIsDirect: true,
    })

    expect(
      getAssistantBindingIsolationConflicts(binding, {
        actorId: ' actor-1 ',
        channel: '  telegram  ',
      }),
    ).toEqual([])

    expect(
      getAssistantBindingIsolationConflicts(binding, {
        actorId: 'actor-2',
        channel: 'linq',
        identityId: '   ',
        threadIsDirect: false,
      }),
    ).toEqual([
      {
        current: 'telegram',
        field: 'channel',
        next: 'linq',
        reason: 'replace',
      },
      {
        current: 'identity-1',
        field: 'identityId',
        next: null,
        reason: 'clear',
      },
      {
        current: 'actor-1',
        field: 'actorId',
        next: 'actor-2',
        reason: 'replace',
      },
      {
        current: true,
        field: 'threadIsDirect',
        next: false,
        reason: 'replace',
      },
    ])
  })

  it('creates bindings with normalized fields and channel-specific inferred delivery', () => {
    expect(
      createAssistantBinding({
        actorId: ' participant-1 ',
        channel: ' telegram ',
        identityId: '  ',
        threadIsDirect: true,
      }),
    ).toEqual({
      actorId: 'participant-1',
      channel: 'telegram',
      conversationKey: 'channel:telegram|actor:participant-1',
      delivery: {
        kind: 'participant',
        target: 'participant-1',
      },
      identityId: null,
      threadId: null,
      threadIsDirect: true,
    })

    expect(
      createAssistantBinding({
        actorId: 'participant-2',
        channel: 'linq',
        threadIsDirect: true,
      }).delivery,
    ).toBeNull()

    expect(
      createAssistantBinding({
        actorId: 'participant-3',
        channel: 'unknown',
        threadIsDirect: true,
      }).delivery,
    ).toEqual({
      kind: 'participant',
      target: 'participant-3',
    })

    expect(
      createAssistantBinding({
        actorId: 'participant-4',
        channel: 'telegram',
        deliveryKind: 'thread',
        deliveryTarget: ' explicit-thread ',
        threadId: 'thread-ignored',
      }).delivery,
    ).toEqual({
      kind: 'thread',
      target: 'explicit-thread',
    })
  })

  it('retargets inferred thread and participant delivery when merge patches move the bound ids', () => {
    const threadBinding = createAssistantBinding({
      actorId: 'actor-1',
      channel: 'linq',
      threadId: 'thread-1',
      threadIsDirect: false,
    })

    expect(
      mergeAssistantBinding(threadBinding, {
        threadId: ' thread-2 ',
      }),
    ).toEqual({
      actorId: 'actor-1',
      channel: 'linq',
      conversationKey: 'channel:linq|thread:thread-2',
      delivery: {
        kind: 'thread',
        target: 'thread-2',
      },
      identityId: null,
      threadId: 'thread-2',
      threadIsDirect: false,
    })

    expect(
      mergeAssistantBinding(threadBinding, {
        threadId: '   ',
      }).delivery,
    ).toBeNull()

    const participantBinding = createAssistantBinding({
      actorId: 'actor-2',
      channel: 'telegram',
      threadIsDirect: true,
    })

    expect(
      mergeAssistantBinding(participantBinding, {
        actorId: ' actor-3 ',
      }),
    ).toEqual({
      actorId: 'actor-3',
      channel: 'telegram',
      conversationKey: 'channel:telegram|actor:actor-3',
      delivery: {
        kind: 'participant',
        target: 'actor-3',
      },
      identityId: null,
      threadId: null,
      threadIsDirect: true,
    })

    expect(
      mergeAssistantBinding(participantBinding, {
        actorId: null,
      }).delivery,
    ).toBeNull()
  })

  it('keeps explicitly patched delivery targets instead of auto-retargeting merge output', () => {
    const binding = createAssistantBinding({
      actorId: 'actor-1',
      channel: 'telegram',
      threadIsDirect: true,
    })

    expect(
      mergeAssistantBinding(binding, {
        actorId: 'actor-2',
        deliveryKind: 'thread',
        deliveryTarget: ' manual-thread ',
      }),
    ).toEqual({
      actorId: 'actor-2',
      channel: 'telegram',
      conversationKey: 'channel:telegram|actor:actor-2',
      delivery: {
        kind: 'thread',
        target: 'manual-thread',
      },
      identityId: null,
      threadId: null,
      threadIsDirect: true,
    })
  })

  it('resolves delivery through the binding seam for fallback and thread-first channels', () => {
    expect(
      resolveAssistantBindingDelivery({
        actorId: 'actor-1',
        channel: 'telegram',
      }),
    ).toEqual({
      kind: 'participant',
      target: 'actor-1',
    })

    expect(
      resolveAssistantBindingDelivery({
        actorId: 'actor-2',
        channel: 'linq',
      }),
    ).toBeNull()

    expect(
      resolveAssistantBindingDelivery({
        actorId: 'actor-3',
        channel: 'unknown',
        threadId: 'thread-3',
        threadIsDirect: false,
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-3',
    })
  })

  it('renders binding context lines and surfaces the display target from session delivery', () => {
    const binding = createAssistantBinding({
      actorId: 'actor-1',
      channel: 'email',
      deliveryKind: 'thread',
      deliveryTarget: 'thread-99',
      identityId: 'sender@example.com',
      threadId: 'thread-source',
      threadIsDirect: false,
    })

    expect(getAssistantBindingContextLines(binding)).toEqual([
      'channel: email',
      'identity: sender@example.com',
      'actor: actor-1',
      'thread: thread-source',
      'thread is direct: false',
      'delivery: thread -> thread-99',
    ])

    const session = {
      binding,
    } satisfies Pick<AssistantSession, 'binding'>

    expect(getAssistantDisplayTarget(session)).toBe('thread-99')
    expect(
      getAssistantDisplayTarget({
        binding: createAssistantBinding({
          channel: 'linq',
        }),
      }),
    ).toBeNull()
  })
})
