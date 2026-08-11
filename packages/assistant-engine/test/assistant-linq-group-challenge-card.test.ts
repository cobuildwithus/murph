import { describe, expect, it, vi } from 'vitest'

import {
  buildLinqIMessageAppFallbackText,
  type AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import type { LinqFetch } from '@murphai/operator-config/linq-runtime'

import { sendLinqMessage } from '../src/assistant/channels/runtime.ts'

const CHALLENGE_CARD = {
  kind: 'challenge_standings',
  version: 1,
  format: 'individual',
  title: 'Weird Health Week',
  subtitle: 'Day 4 of 7',
  objective: { kind: 'ranking' },
  entries: [{
    label: 'Maya',
    points: 120,
    coverage: 'complete',
    detail: null,
  }],
  footer: null,
} satisfies AssistantResponseCard

describe('Linq group challenge standings delivery', () => {
  it.each(['thread', 'explicit'] as const)(
    'sends one native app card for a %s group target without a direct-recipient capability probe',
    async (targetKind) => {
      const requests: Array<{
        body: Record<string, unknown>
        method: string
        url: string
      }> = []
      const fetchImplementation: LinqFetch = vi.fn(async (url, init) => {
        if (typeof init.body !== 'string') {
          throw new TypeError('Expected a JSON request body.')
        }
        requests.push({
          body: JSON.parse(init.body) as Record<string, unknown>,
          method: init.method,
          url,
        })
        return new Response(JSON.stringify({
          message: { id: 'group-challenge-card-message' },
        }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      })

      const result = await sendLinqMessage({
        card: CHALLENGE_CARD,
        idempotencyKey: 'group-challenge-card-1',
        message: 'Standings are ready.',
        target: 'linq-group-chat-1',
        targetKind,
        threadIsDirect: false,
      }, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation,
      })

      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe(
        'https://linq.example.test/api/partner/v3/chats/linq-group-chat-1/messages',
      )
      expect(requests[0]?.url).not.toContain('/capability/check_imessage')
      expect(requests[0]?.body).toMatchObject({
        message: {
          idempotency_key: 'group-challenge-card-1',
          parts: [{
            type: 'imessage_app',
            fallback_text:
              'Challenge standings. Ask Murph for this card in text',
            layout: {
              caption: 'Weird Health Week — Day 4 of 7',
              subcaption: '1. Maya: 120 points',
            },
          }],
        },
      })
      expect(buildLinqIMessageAppFallbackText(CHALLENGE_CARD)).not.toMatch(
        /\d|today|day|time/iu,
      )
      expect(result.providerMessageId).toBe('group-challenge-card-message')
    },
  )
})
