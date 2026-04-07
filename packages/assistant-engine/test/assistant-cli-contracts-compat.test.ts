import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  assistantBindingDeliveryKindValues,
  assistantBindingDeliverySchema,
  assistantChannelDeliveryTargetKindValues,
} from '../src/assistant-cli-contracts.ts'
import {
  assistantBindingDeliveryKindValues as operatorAssistantBindingDeliveryKindValues,
  assistantBindingDeliverySchema as operatorAssistantBindingDeliverySchema,
  assistantChannelDeliveryTargetKindValues as operatorAssistantChannelDeliveryTargetKindValues,
} from '@murphai/operator-config/assistant-cli-contracts'

test('assistant-engine compatibility contracts stay aligned with the operator-config owner', () => {
  assert.deepEqual(
    assistantChannelDeliveryTargetKindValues,
    operatorAssistantChannelDeliveryTargetKindValues,
  )
  assert.deepEqual(
    assistantBindingDeliveryKindValues,
    operatorAssistantBindingDeliveryKindValues,
  )

  const delivery = {
    kind: 'thread',
    target: 'thread-123',
  } as const

  assert.deepEqual(
    assistantBindingDeliverySchema.parse(delivery),
    operatorAssistantBindingDeliverySchema.parse(delivery),
  )
})
