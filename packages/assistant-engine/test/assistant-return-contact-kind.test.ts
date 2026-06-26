import { describe, expect, it } from 'vitest'

import {
  resolveAssistantHostedReturnContactKind,
} from '../src/assistant/return-contact-kind.ts'

describe('assistant return contact kind', () => {
  it.each([
    ['linq', 'text'],
    [' telegram ', 'telegram'],
    ['EMAIL', 'email'],
    ['whatsapp', null],
    [null, null],
    [undefined, null],
  ] as const)('maps %s to %s', (channel, expected) => {
    expect(resolveAssistantHostedReturnContactKind(channel)).toBe(expected)
  })
})
