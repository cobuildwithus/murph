import { describe, expect, it } from 'vitest'

import {
  sendLinqIMessageAppCard,
  type LinqFetch,
} from '../src/linq-runtime.js'
import {
  buildLinqIMessageAppLayout,
  type WearableTrendResponseCardV1,
} from '../src/assistant-response-cards.js'

const CARD: WearableTrendResponseCardV1 = {
  kind: 'wearable_trend',
  version: 1,
  localDates: [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30',
  ],
  metrics: [{
    metricKey: 'resting-heart-rate',
    values: [58, 57, 59, 60, 58, 56, 57],
    trend: 'lower',
  }],
}

describe('Linq wearable trend app cards', () => {
  it('sends a static app layout without an interactive native URL', async () => {
    const requests: Array<{ body: unknown; url: string }> = []
    const fetchImplementation: LinqFetch = async (url, init) => {
      requests.push({
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        url,
      })
      return {
        arrayBuffer: async () => new ArrayBuffer(0),
        json: async () => ({ message: { id: 'msg_health_1' } }),
        ok: true,
        status: 200,
        text: async () => '',
      }
    }

    await sendLinqIMessageAppCard({
      card: CARD,
      chatId: 'chat_health_1',
      idempotencyKey: 'wearable-trend-1',
    }, {
      env: { LINQ_API_TOKEN: 'test-token' },
      fetchImplementation,
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toContain('/chats/chat_health_1/messages')
    const part = (
      requests[0]?.body as {
        message: { parts: Array<Record<string, unknown>> }
      }
    ).message.parts[0]
    expect(part).toEqual({
      app: {
        bundle_id: 'ai.withmurph.app.messages',
        name: 'Murph',
        team_id: 'G9DJH2XUMK',
      },
      fallback_text: 'Your health trend.',
      interactive: false,
      layout: buildLinqIMessageAppLayout(CARD),
      type: 'imessage_app',
    })
    expect(part).not.toHaveProperty('url')
  })
})
