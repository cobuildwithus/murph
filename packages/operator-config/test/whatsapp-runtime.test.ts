import assert from 'node:assert/strict'

import { describe, expect, it, vi } from 'vitest'

import {
  sendWhatsAppTextMessage,
} from '../src/whatsapp-runtime.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

describe('whatsapp runtime', () => {
  it('sends text messages through the WhatsApp Cloud API without returning credential material', async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(JSON.stringify({
      contacts: [{ wa_id: '15550100001' }],
      messages: [{ id: 'wamid.MESSAGE_1' }],
      messaging_product: 'whatsapp',
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 200,
    }))

    await expect(sendWhatsAppTextMessage({
      message: '  hello from Murph  ',
      replyToMessageId: 'wamid.REPLY_1',
      target: '+1 (555) 010-0001',
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: 'test-access-token',
        WHATSAPP_API_BASE_URL: 'https://graph.example.test/',
        WHATSAPP_GRAPH_VERSION: 'v25.0',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-1',
      },
      fetchImplementation: fetchMock,
    })).resolves.toEqual({
      providerMessageId: 'wamid.MESSAGE_1',
      providerThreadId: '15550100001',
      target: '15550100001',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      'https://graph.example.test/v25.0/phone-number-id-1/messages',
    )
    assert.equal(init?.method, 'POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15550100001',
      type: 'text',
      context: {
        message_id: 'wamid.REPLY_1',
      },
      text: {
        body: 'hello from Murph',
        preview_url: false,
      },
    })
  })

  it('rejects invalid recipients before calling the provider', async () => {
    const fetchMock = vi.fn()

    await expect(sendWhatsAppTextMessage({
      message: 'hello',
      target: 'not a phone number',
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: 'test-access-token',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-1',
      },
      fetchImplementation: fetchMock,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_WHATSAPP_TARGET_INVALID',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves explicit no-egress proof before WhatsApp provider entry', async () => {
    const preProviderError = Object.assign(
      new Error('WhatsApp provider entry was rejected'),
      {
        deliveryMayHaveSucceeded: false as const,
        retryable: true as const,
      },
    )
    const fetchMock = vi.fn(async () => {
      throw preProviderError
    })

    await expect(sendWhatsAppTextMessage({
      message: 'hello',
      target: '15550100001',
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: 'test-access-token',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-1',
      },
      fetchImplementation: fetchMock,
    })).rejects.toBe(preProviderError)

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('marks a lost WhatsApp transport response as terminally ambiguous', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('socket closed after WhatsApp request entry')
    })

    await expect(sendWhatsAppTextMessage({
      message: 'hello',
      target: '15550100001',
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: 'test-access-token',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-1',
      },
      fetchImplementation: fetchMock,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_WHATSAPP_REQUEST_FAILED',
      context: expect.objectContaining({
        retryable: false,
      }),
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps caller-aborted WhatsApp transport loss terminally ambiguous', async () => {
    const abortController = new AbortController()
    const fetchMock = vi.fn(async () => {
      abortController.abort(new Error('hosted invocation ended after provider entry'))
      throw new Error('network connection lost')
    })

    await expect(sendWhatsAppTextMessage({
      message: 'hello',
      target: '15550100001',
    }, {
      env: {
        WHATSAPP_ACCESS_TOKEN: 'test-access-token',
        WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-1',
      },
      fetchImplementation: fetchMock,
      signal: abortController.signal,
    })).rejects.toMatchObject({
      code: 'ASSISTANT_WHATSAPP_REQUEST_FAILED',
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps Cloud API failure context metadata-only', async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ) => new Response(JSON.stringify({
      error: {
        code: 190,
        error_subcode: 460,
        message: 'Invalid OAuth access token',
        type: 'OAuthException',
      },
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      status: 401,
    }))

    try {
      await sendWhatsAppTextMessage({
        message: 'hello',
        target: '15550100001',
      }, {
        env: {
          WHATSAPP_ACCESS_TOKEN: 'test-access-token',
          WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id-1',
        },
        fetchImplementation: fetchMock,
      })
      throw new Error('expected WhatsApp delivery to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultCliError)
      if (!(error instanceof VaultCliError)) {
        throw error
      }
      expect(error.code).toBe('ASSISTANT_WHATSAPP_REQUEST_FAILED')
      expect(error.context).toMatchObject({
        errorCode: 190,
        errorSubcode: 460,
        errorType: 'OAuthException',
        operation: 'send_text',
        provider: 'whatsapp',
        retryable: false,
        status: 401,
      })
      expect(JSON.stringify(error.context)).not.toContain('test-access-token')
      expect(JSON.stringify(error.context)).not.toContain('15550100001')
    }
  })
})
