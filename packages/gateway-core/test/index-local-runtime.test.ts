import { test, expect } from 'vitest'

import * as gatewayCore from '@murphai/gateway-core'
import type {
  GatewayLocalMessageSendRequest,
  GatewayLocalMessageSender,
  GatewayLocalProjectionSourceReader,
} from '@murphai/gateway-core'

const sampleSendRequest: GatewayLocalMessageSendRequest = {
  bindingDelivery: {
    kind: 'thread',
    target: 'thread-123',
  },
  message: 'hello from the barrel',
  sessionId: 'session-123',
  turnId: 'turn-123',
  vault: 'vault-123',
}

const sampleProjectionReader: GatewayLocalProjectionSourceReader = {
  async listOutboxSources() {
    return []
  },
  async listSessionSources() {
    return []
  },
}

const sampleMessageSender: GatewayLocalMessageSender = {
  async deliver(input) {
    return {
      delivery: null,
      deliveryErrorMessage: input.message.length > 0 ? null : 'message required',
      intentId: 'intent-123',
      kind: 'queued',
    }
  },
}

test('package root barrel exposes runtime exports while local-runtime stays type-only at runtime', async () => {
  expect(gatewayCore.gatewayConversationSchema).toBeDefined()
  expect(gatewayCore.createGatewayConversationSessionKey('route-key')).toBe(
    gatewayCore.createGatewayConversationSessionKey('route-key'),
  )
  expect(gatewayCore.createGatewayConversationSessionKey('route-key')).not.toBe(
    gatewayCore.createGatewayConversationSessionKey('other-route-key'),
  )

  expect('GatewayLocalMessageSendRequest' in gatewayCore).toBe(false)
  expect('GatewayLocalProjectionSourceReader' in gatewayCore).toBe(false)
  expect('GatewayLocalMessageSender' in gatewayCore).toBe(false)

  await expect(sampleProjectionReader.listOutboxSources(sampleSendRequest.vault)).resolves.toEqual([])
  await expect(sampleMessageSender.deliver(sampleSendRequest)).resolves.toEqual({
    delivery: null,
    deliveryErrorMessage: null,
    intentId: 'intent-123',
    kind: 'queued',
  })
})
