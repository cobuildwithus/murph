import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendTelegramMessage } from '../src/assistant-channel-runtime.js'
import type { TelegramTextSendAcceptance } from '../src/assistant/channels/types.js'

const env = { TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_API_BASE_URL: 'https://telegram.test' }
const input = { message: 'Synthetic reminder', target: '123' }
const sentAt = '2026-01-02T18:00:00.000Z'
const date = Date.parse(sentAt) / 1000
const accepted = (result: Record<string, unknown>) => Response.json({ ok: true, result })

afterEach(() => vi.useRealTimers())

describe('Telegram text acceptance telemetry', () => {
  it('observes provider time and local latency without retaining provider payloads or changing receipts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(sentAt))
    const observer = vi.fn()
    const fetchImplementation = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_250))
      return accepted({ date, message_id: 41, text: 'private payload', chat: { id: 123 } })
    })
    const pending = sendTelegramMessage(input, { env, fetchImplementation, onTextSendAccepted: observer })
    await vi.advanceTimersByTimeAsync(1_250)
    const receipt = await pending
    expect(receipt.providerMessageId).toBe('41')
    expect(receipt).not.toHaveProperty('providerSentAt')
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      providerSentAt: sentAt,
      providerMessageIdStatus: 'positive',
      requestStartedAt: sentAt,
      responseReceivedAt: '2026-01-02T18:00:01.250Z',
      requestDurationMs: 1_250,
    })
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })

  it.each([undefined, null, -1, 0, 1.5, '1767376800', Number.MAX_SAFE_INTEGER])(
    'keeps invalid or absent date %s unknown without rejecting acceptance', async (invalidDate) => {
      const observer = vi.fn()
      await expect(sendTelegramMessage(input, {
        env,
        fetchImplementation: async () => accepted({ date: invalidDate, message_id: 42 }),
        onTextSendAccepted: observer,
      })).resolves.toMatchObject({ providerMessageId: '42' })
      expect(observer).toHaveBeenCalledWith(expect.objectContaining({ providerSentAt: null }))
    },
  )

  it.each([['zero', 0], ['missing_or_invalid', undefined], ['missing_or_invalid', -1]] as const)(
    'distinguishes %s message identity without changing success handling', async (status, message_id) => {
      const observer = vi.fn()
      await sendTelegramMessage(input, {
        env, onTextSendAccepted: observer,
        fetchImplementation: async () => accepted({ date, message_id }),
      })
      expect(observer).toHaveBeenCalledWith(expect.objectContaining({ providerMessageIdStatus: status }))
    },
  )

  it.each(['throws', 'rejects', 'stalls'] as const)(
    'does not delay or retry an accepted send when the observer %s', async (mode) => {
      const fetchImplementation = vi.fn(async () => accepted({ date, message_id: 43 }))
      await expect(sendTelegramMessage(input, {
        env, fetchImplementation,
        onTextSendAccepted: () => {
          if (mode === 'throws') throw new Error('Synthetic logger failure')
          if (mode === 'rejects') return Promise.reject(new Error('Synthetic logger failure'))
          return new Promise<void>(() => {})
        },
      })).resolves.toMatchObject({ providerMessageId: '43' })
      expect(fetchImplementation).toHaveBeenCalledOnce()
    },
  )

  it('records each accepted chunk after a retry, excluding rejected attempts', async () => {
    vi.useFakeTimers()
    const events: TelegramTextSendAcceptance[] = []
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: false, error_code: 429, parameters: { retry_after: 0.001 } }, { status: 429 }))
      .mockResolvedValueOnce(accepted({ date, message_id: 44 }))
      .mockResolvedValueOnce(accepted({ date: date + 2, message_id: 45 }))
    const pending = sendTelegramMessage({ ...input, message: 'a'.repeat(4097) }, {
      env, fetchImplementation, onTextSendAccepted: (event) => { events.push(event) },
    })
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toMatchObject({ providerMessageIds: ['44', '45'] })
    expect(events.map((event) => event.providerSentAt)).toEqual([sentAt, '2026-01-02T18:00:02.000Z'])
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
  })

  it('does not report ambiguous transport failure as acceptance', async () => {
    const observer = vi.fn()
    const fetchImplementation = vi.fn(async () => { throw new Error('Synthetic timeout') })
    await expect(sendTelegramMessage(input, { env, fetchImplementation, onTextSendAccepted: observer }))
      .rejects.toMatchObject({ deliveryMayHaveSucceeded: true })
    expect(observer).not.toHaveBeenCalled()
    expect(fetchImplementation).toHaveBeenCalledOnce()
  })
})
