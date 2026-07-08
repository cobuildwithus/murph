import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createAssistantOutboxIntent } from '@murphai/assistant-engine'
import {
  buildHostedExecutionMemberChannelsUpdatedWake,
} from '@murphai/hosted-execution'
import { buildHostedAssistantDeliveryEffect } from '@murphai/hosted-execution/side-effects'
import type { HostedAssistantDeliveryRecord } from '@murphai/hosted-execution/side-effects'

import type { HostedEmailSendRequest } from '../src/hosted-email.js'
import { parseHostedEmailSendRequest } from '../src/hosted-email.js'
import { drainHostedPreparedAssistantDeliveries } from '../src/hosted-runtime/callbacks.js'

describe('hosted runtime email subject support', () => {
  it('parses the optional hosted email subject field', () => {
    expect(
      parseHostedEmailSendRequest({
        message: 'Hello from Murph',
        subject: 'Daily check-in',
        target: 'user@example.com',
        targetKind: 'explicit',
      }),
    ).toEqual({
      html: null,
      idempotencyKey: null,
      message: 'Hello from Murph',
      replyToMessageId: null,
      subject: 'Daily check-in',
      target: 'user@example.com',
      targetKind: 'explicit',
    })
  })

  it('forwards a hosted delivery subject into the email send request', async () => {
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), 'murph-hosted-email-subject-'))
    const sentRequests: HostedEmailSendRequest[] = []

    try {
      // Regression: hosted intents carry a privacy-blinded binding identity
      // (hid_<hex>); it must never be forwarded into the email send request.
      const intent = await createAssistantOutboxIntent({
        channel: 'email',
        explicitTarget: 'user@example.com',
        identityId: 'hid_0123456789abcdef0123456789abcdef',
        message: 'Hello from Murph',
        sessionId: 'session_123',
        subject: 'Daily check-in',
        turnId: 'turn_123',
        vault: vaultRoot,
      })
      const outcomes = await drainHostedPreparedAssistantDeliveries({
        assistantDeliveryEffects: [
          buildHostedAssistantDeliveryEffect({
            dedupeKey: intent.dedupeKey,
            effectId: intent.intentId,
            payload: {
              actorId: null,
              answeredMailboxItemIds: [],
              bindingDeliveryKind: null,
              bindingDeliveryTarget: null,
              channel: 'email',
              deliverySourceKey: null,
              explicitTarget: 'user@example.com',
              idempotencyKey: 'idempotency_123',
              identityId: 'hid_0123456789abcdef0123456789abcdef',
              media: [],
              message: 'Hello from Murph',
              subject: 'Daily check-in',
              replyToMessageId: null,
              sessionId: 'session_123',
              threadId: null,
              threadIsDirect: null,
              transportIdempotent: false,
              turnId: 'turn_123',
            },
          }),
        ],
        wake: buildHostedExecutionMemberChannelsUpdatedWake({
          eventId: 'dispatch_123',
          memberChannels: {
            email: true,
            linq: false,
            telegram: false,
          },
          memberId: 'user_123',
          occurredAt: '2026-04-17T00:00:00.000Z',
        }),
        effectsPort: {
          async deletePreparedAssistantDelivery() {},
          async readAssistantDeliveryRecord() {
            return null
          },
          async readRawEmailMessage() {
            return null
          },
          async sendEmail(request) {
            sentRequests.push(request)
            return {
              target: 'hosted-thread-target',
            }
          },
          async writeAssistantDeliveryRecord(record: HostedAssistantDeliveryRecord) {
            return record
          },
        },
        vaultRoot,
      })

      expect(sentRequests).toHaveLength(1)
      expect(sentRequests[0]).toMatchObject({
        idempotencyKey: `assistant-outbox:${intent.intentId}`,
        message: 'Hello from Murph',
        replyToMessageId: null,
        subject: 'Daily check-in',
        target: 'user@example.com',
        targetKind: 'explicit',
      })
      expect(sentRequests[0]).not.toHaveProperty('identityId')
      expect(outcomes[0]?.deliveryStatus).toBe('sent')
    } finally {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      })
    }
  })
})
