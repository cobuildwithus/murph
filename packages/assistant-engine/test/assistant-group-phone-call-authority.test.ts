import { describe, expect, it } from 'vitest'

import {
  resolveAssistantGroupPhoneCallAuthority,
} from '../src/assistant/group-phone-call-authority.js'

describe('group phone-call authority', () => {
  it.each(['linq', 'telegram'] as const)(
    'uses the current accepted %s request without an assistant-authored preview',
    async (channel) => {
      await expect(resolveAssistantGroupPhoneCallAuthority({
        acceptedInputIds: [
          'ain_11111111111111111111111111111111',
          'ain_22222222222222222222222222222222',
        ],
        channel,
      })).resolves.toEqual({
        assistantInputId: 'ain_22222222222222222222222222222222',
      })
    },
  )

  it('accepts an explicit message ref only when it is still the current request', async () => {
    const acceptedInputIds = [
      'ain_11111111111111111111111111111111',
      'ain_22222222222222222222222222222222',
    ]

    await expect(resolveAssistantGroupPhoneCallAuthority({
      acceptedInputIds,
      channel: 'linq',
      requestInputId: 'ain_22222222222222222222222222222222',
    })).resolves.toEqual({
      assistantInputId: 'ain_22222222222222222222222222222222',
    })
    await expect(resolveAssistantGroupPhoneCallAuthority({
      acceptedInputIds,
      channel: 'linq',
      requestInputId: 'ain_11111111111111111111111111111111',
    })).resolves.toBeNull()
  })

  it.each([
    {
      acceptedInputIds: [] as string[],
      channel: 'linq',
      name: 'missing accepted input',
    },
    {
      acceptedInputIds: ['ain_22222222222222222222222222222222'],
      channel: 'email',
      name: 'unsupported group channel',
    },
  ])('fails closed for $name', async ({ acceptedInputIds, channel }) => {
    await expect(resolveAssistantGroupPhoneCallAuthority({
      acceptedInputIds,
      channel,
    })).resolves.toBeNull()
  })
})
