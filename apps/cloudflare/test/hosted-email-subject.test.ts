import { TextEncoder } from 'node:util'

import { describe, expect, it } from 'vitest'

import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'

import {
  HostedEmailSendValidationError,
  sendHostedEmailMessage,
} from '../src/hosted-email/transport.ts'

class MemoryBucket {
  private readonly objects = new Map<string, string>()

  async get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> {
    const value = this.objects.get(key)
    if (value === undefined) {
      return null
    }

    return {
      async arrayBuffer() {
        return new TextEncoder().encode(value).buffer
      },
    }
  }

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value)
  }
}

describe('hosted Cloudflare email subject handling', () => {
  const config = {
    defaultSubject: 'Murph update',
    domain: 'example.com',
    fromAddress: 'assistant@example.com',
    localPart: 'assistant',
    signingSecret: 'super-secret-signing-key',
  } as const

  const key = new TextEncoder().encode('12345678901234567890123456789012')

  it('uses an explicit subject for new outbound email sends', async () => {
    const sentMessages: Array<{ from: string; raw: string; to: string }> = []
    const bucket = new MemoryBucket()

    const delivered = await sendHostedEmailMessage({
      bucket,
      config,
      emailBinding: {
        async send(message) {
          sentMessages.push(message as { from: string; raw: string; to: string })
        },
      },
      key,
      keyId: 'key_123',
      request: {
        identityId: 'assistant@example.com',
        message: 'Hello from Murph',
        subject: 'Daily check-in',
        target: 'user@example.com',
        targetKind: 'explicit',
      },
      userId: 'user_123',
    })

    expect(sentMessages).toHaveLength(1)
    expect(sentMessages[0]).toMatchObject({
      from: 'assistant@example.com',
      to: 'user@example.com',
    })
    expect(parseHostedEmailThreadTarget(delivered.target)?.subject).toBe('Daily check-in')
  })

  it('rejects a subject override when replying to an existing thread', async () => {
    const bucket = new MemoryBucket()
    const binding = {
      async send() {},
    }

    const firstSend = await sendHostedEmailMessage({
      bucket,
      config,
      emailBinding: binding,
      key,
      keyId: 'key_123',
      request: {
        identityId: 'assistant@example.com',
        message: 'Hello from Murph',
        target: 'user@example.com',
        targetKind: 'explicit',
      },
      userId: 'user_123',
    })

    await expect(
      sendHostedEmailMessage({
        bucket,
        config,
        emailBinding: binding,
        key,
        keyId: 'key_123',
        request: {
          identityId: 'assistant@example.com',
          message: 'Reply from Murph',
          subject: 'Override subject',
          target: firstSend.target,
          targetKind: 'thread',
        },
        userId: 'user_123',
      }),
    ).rejects.toThrow(HostedEmailSendValidationError)
  })
})
