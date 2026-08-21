import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'
import { createHostedEmailUserReplyAliasRoute } from '@murphai/hosted-execution/hosted-email'

import {
  HostedEmailSendValidationError,
  sendHostedEmailMessage,
} from '../src/hosted-email/transport.ts'

const webControlPlane = vi.hoisted(() => ({
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}))

vi.mock('../src/web-control-plane.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/web-control-plane.ts')>(
    '../src/web-control-plane.ts',
  )

  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse: webControlPlane.fetchHostedExecutionWebControlPlaneResponse,
  }
})

describe('hosted Cloudflare email subject handling', () => {
  const config = {
    defaultSubject: 'Murph update',
    domain: 'example.com',
    fromAddress: 'assistant@example.com',
    localPart: 'assistant',
    signingSecret: 'super-secret-signing-key',
  } as const

  const webCallbackSigning = {
    keyId: 'v1',
    privateKeyJwkJson: '{"kty":"EC","crv":"P-256","x":"x","y":"y","d":"d"}',
  }

  beforeEach(() => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockReset()
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(async () => {
      const replyAlias = await createHostedEmailUserReplyAliasRoute({
        domain: config.domain,
        localPart: config.localPart,
        signingSecret: config.signingSecret,
        userId: 'user_123',
      })
      return new Response(JSON.stringify({
        address: replyAlias.address,
        aliasKey: replyAlias.aliasKey,
        ok: true,
      }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses an explicit subject for new outbound email sends', async () => {
    const sentMessages: Array<{ from: string; raw: string; to: string }> = []

    const delivered = await sendHostedEmailMessage({
      config,
      emailBinding: {
        async send(message) {
          sentMessages.push(message as { from: string; raw: string; to: string })
        },
      },
      request: {
        message: 'Hello from Murph',
        subject: 'Daily check-in',
        target: 'user@example.com',
        targetKind: 'explicit',
      },
      userId: 'user_123',
      webCallbackSigning,
      webControlBaseUrl: 'https://web.example.test',
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toMatchObject({
      from: 'assistant@example.com',
      to: 'user@example.com',
    })
    expect(parseHostedEmailThreadTarget(delivered.target)?.subject).toBe('Daily check-in')
  })

  it('rejects a subject override when replying to an existing thread', async () => {
    const binding = {
      async send() {},
    }

    const firstSend = await sendHostedEmailMessage({
      config,
      emailBinding: binding,
      request: {
        message: 'Hello from Murph',
        target: 'user@example.com',
        targetKind: 'explicit',
      },
      userId: 'user_123',
      webCallbackSigning,
      webControlBaseUrl: 'https://web.example.test',
    })

    await expect(
      sendHostedEmailMessage({
        config,
        emailBinding: binding,
        request: {
          message: 'Reply from Murph',
          subject: 'Override subject',
          target: firstSend.target,
          targetKind: 'thread',
        },
        userId: 'user_123',
        webCallbackSigning,
        webControlBaseUrl: 'https://web.example.test',
      }),
    ).rejects.toThrow(HostedEmailSendValidationError)
  })
})
