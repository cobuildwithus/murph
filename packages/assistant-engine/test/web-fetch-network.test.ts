import { describe, expect, it } from 'vitest'

import { normalizeAssistantWebRequestUrl } from '../src/assistant/web-fetch/config.js'
import { redactAssistantWebFetchUrl } from '../src/assistant/web-fetch/network.js'
import { readAssistantWebResponseBytes } from '../src/assistant/web-fetch/response.js'

describe('normalizeAssistantWebRequestUrl', () => {
  it('normalizes host casing, trailing dots, and drops URL fragments', () => {
    const url = normalizeAssistantWebRequestUrl('HTTPS://Example.com./path/to/page?q=1#section')

    expect(url.hostname).toBe('example.com')
    expect(url.hash).toBe('')
    expect(url.href).toBe('https://example.com/path/to/page?q=1')
  })
})

describe('redactAssistantWebFetchUrl', () => {
  it('removes query parameters and fragments from logged URLs', () => {
    expect(
      redactAssistantWebFetchUrl(new URL('https://example.com/path?q=1#frag')),
    ).toBe('https://example.com/path')
  })
})

describe('readAssistantWebResponseBytes', () => {
  it('bounds oversized responses and reports truncation warnings', async () => {
    const response = new Response('abcdefghij', {
      headers: {
        'content-length': '10',
      },
    })

    const result = await readAssistantWebResponseBytes({
      maxResponseBytes: 6,
      response,
    })

    expect(new TextDecoder().decode(result.bytes)).toBe('abcdef')
    expect(result.truncated).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Response declared 10 bytes; reading only the first 6 bytes.',
        'Response body exceeded 6 bytes and was truncated.',
      ]),
    )
  })
})
