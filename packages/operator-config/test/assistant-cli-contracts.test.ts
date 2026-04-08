import { describe, expect, it } from 'vitest'

import {
  gatewayDeliveryTargetKindValues,
  gatewayReplyRouteKindValues,
} from '@murphai/gateway-core'

import {
  assistantBindingDeliveryKindValues,
  assistantChannelDeliveryTargetKindValues,
} from '../src/assistant-cli-contracts.ts'

describe('assistant CLI delivery contracts', () => {
  it('reuses gateway-owned delivery target kinds', () => {
    expect(assistantChannelDeliveryTargetKindValues).toEqual(gatewayDeliveryTargetKindValues)
  })

  it('reuses gateway-owned reply route kinds for bindings', () => {
    expect(assistantBindingDeliveryKindValues).toEqual(gatewayReplyRouteKindValues)
  })
})
