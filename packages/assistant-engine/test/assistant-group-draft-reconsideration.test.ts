import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  ASSISTANT_GROUP_DRAFT_RECONSIDERATION_GRACE_MS,
  buildAssistantGroupDraftReconsiderationInput,
  discardAssistantGroupDraftPrecedingResponses,
  isAssistantGroupDraftCandidate,
  shouldUseAssistantGroupDraftReconsideration,
  waitForAssistantGroupDraftReconsideration,
} from '../src/assistant/group-draft-reconsideration.ts'

const groupAudience = {
  actorId: null,
  bindingDelivery: {
    kind: 'thread' as const,
    target: 'thread-1',
  },
  channel: 'linq',
  deliveryPolicy: 'binding-target-only' as const,
  effectiveThreadIsDirect: false,
  explicitTarget: null,
  identityId: 'identity-1',
  replyToMessageId: null,
  threadId: 'thread-1',
  threadIsDirect: false,
}

const activeTurnInput = async () => ({ kind: 'no-new-input' as const })

afterEach(() => {
  vi.useRealTimers()
})

describe('group draft reconsideration eligibility', () => {
  test('selects only ordinary interactive Linq and Telegram group auto-replies', () => {
    for (const channel of ['linq', 'telegram']) {
      expect(shouldUseAssistantGroupDraftReconsideration({
        message: {
          activeTurnInput,
          deliverResponse: true,
          turnTrigger: 'automation-auto-reply',
        },
        plan: {
          conversationPolicy: {
            audience: {
              ...groupAudience,
              channel,
            },
            operatorAuthority: 'direct-operator',
          },
        },
      })).toBe(true)
    }
  })

  test('leaves direct, email, manual, non-delivery, and source-less turns unchanged', () => {
    const cases = [
      {
        message: {
          activeTurnInput,
          deliverResponse: true,
          turnTrigger: 'automation-auto-reply' as const,
        },
        audience: {
          ...groupAudience,
          effectiveThreadIsDirect: true,
          threadIsDirect: true,
        },
      },
      {
        message: {
          activeTurnInput,
          deliverResponse: true,
          turnTrigger: 'automation-auto-reply' as const,
        },
        audience: {
          ...groupAudience,
          channel: 'email',
        },
      },
      {
        message: {
          activeTurnInput,
          deliverResponse: true,
          turnTrigger: 'manual-ask' as const,
        },
        audience: groupAudience,
      },
      {
        message: {
          activeTurnInput,
          deliverResponse: false,
          turnTrigger: 'automation-auto-reply' as const,
        },
        audience: groupAudience,
      },
      {
        message: {
          activeTurnInput: undefined,
          deliverResponse: true,
          turnTrigger: 'automation-auto-reply' as const,
        },
        audience: groupAudience,
      },
    ]

    for (const item of cases) {
      expect(shouldUseAssistantGroupDraftReconsideration({
        message: item.message,
        plan: {
          conversationPolicy: {
            audience: item.audience,
            operatorAuthority: 'direct-operator',
          },
        },
      })).toBe(false)
    }
  })
})

describe('group draft candidate selection', () => {
  const textResult = {
    finalAction: undefined,
    precedingResponseSegments: [],
    reactions: [],
    response: 'Current draft',
    responseCard: null,
    responseMedia: [],
  }

  test('accepts ordinary text and removes earlier unsent text segments', () => {
    const result = {
      ...textResult,
      precedingResponseSegments: [
        {
          deliveryContextOrdinal: 0,
          response: 'Earlier draft',
        },
      ],
    }

    expect(isAssistantGroupDraftCandidate(result)).toBe(true)
    expect(discardAssistantGroupDraftPrecedingResponses(result)).toEqual({
      ...result,
      precedingResponseSegments: [],
    })
  })

  test.each([
    {
      ...textResult,
      finalAction: { kind: 'none' as const },
      response: '',
    },
    {
      ...textResult,
      response: '   ',
    },
    {
      ...textResult,
      responseCard: { kind: 'compact_table' },
    },
    {
      ...textResult,
      responseMedia: [{ kind: 'image' }],
    },
    {
      ...textResult,
      reactions: [{ reaction: 'heart' }],
    },
    {
      ...textResult,
      precedingResponseSegments: [
        {
          deliveryContextOrdinal: 0,
          media: [{ kind: 'image' }],
          response: 'Earlier media draft',
        },
      ],
    },
  ])('does not reinterpret non-text or effect-bearing output as a draft', (result) => {
    expect(isAssistantGroupDraftCandidate(result)).toBe(false)
    expect(discardAssistantGroupDraftPrecedingResponses(result)).toBe(result)
  })
})

test('reconsideration context preserves existing policy and quotes the held response as data', () => {
  const message = buildAssistantGroupDraftReconsiderationInput({
    draftText: 'First answer with "quotes"',
    message: {
      prompt: 'Late group input',
      turnContext: 'Existing trusted turn context.',
      vault: '/vaults/test',
    },
  })

  expect(message.prompt).toBe('Late group input')
  expect(message.turnContext).toContain('Existing trusted turn context.')
  expect(message.turnContext).toContain('was held and was not delivered')
  expect(message.turnContext).toContain('finish_without_reply')
  expect(message.turnContext).toContain('First answer with \\"quotes\\"')
  expect(message.turnContext).toContain('Do not repeat a completed tool call')
})

test('the draft grace is fixed, bounded, and abortable', async () => {
  vi.useFakeTimers()
  let completed = false
  const grace = waitForAssistantGroupDraftReconsideration({})
    .then(() => {
      completed = true
    })

  await vi.advanceTimersByTimeAsync(
    ASSISTANT_GROUP_DRAFT_RECONSIDERATION_GRACE_MS - 1,
  )
  expect(completed).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  await grace
  expect(completed).toBe(true)

  const abortController = new AbortController()
  const aborted = waitForAssistantGroupDraftReconsideration({
    signal: abortController.signal,
  })
  abortController.abort()
  await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
})
