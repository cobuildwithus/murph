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

  it('validates includeEarlySessionOnboarding as an optional boolean field', () => {
    expect(
      parseAssistantMessageRequestBody({
        includeEarlySessionOnboarding: true,
        prompt: 'Send a quick update',
      }),
    ).toMatchObject({
      includeEarlySessionOnboarding: true,
      prompt: 'Send a quick update',
    })

    expect(() =>
      parseAssistantMessageRequestBody({
        includeEarlySessionOnboarding: 'yes',
        prompt: 'Send a quick update',
      }),
    ).toThrow(
      'Assistant message request field includeEarlySessionOnboarding must be a boolean when present.',
    )
  })
})
