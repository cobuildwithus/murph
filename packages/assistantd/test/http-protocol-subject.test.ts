import { describe, expect, it } from 'vitest'

import { parseAssistantMessageRequestBody } from '../src/http-protocol.js'

describe('assistantd message request subject support', () => {
  it('accepts an optional deliverySubject on assistant message requests', () => {
    expect(
      parseAssistantMessageRequestBody({
        deliverySubject: 'Daily check-in',
        prompt: 'Send a quick update',
      }),
    ).toMatchObject({
      deliverySubject: 'Daily check-in',
      prompt: 'Send a quick update',
    })
  })
})
