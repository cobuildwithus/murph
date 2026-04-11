import { describe, expect, it } from 'vitest'

import { extractAssistantWebResponse, resolveAssistantWebMediaType, truncateAssistantWebText } from '../src/assistant/web-fetch/content.js'

describe('resolveAssistantWebMediaType', () => {
  it('normalizes media types with parameters', () => {
    expect(resolveAssistantWebMediaType(' Text/HTML ; charset=utf-8 ')).toBe('text/html')
    expect(resolveAssistantWebMediaType(null)).toBeNull()
  })
})

describe('truncateAssistantWebText', () => {
  it('trims the bounded result and reports truncation', () => {
    expect(truncateAssistantWebText('abcdef  ', 6)).toEqual({
      text: 'abcdef',
      truncated: true,
    })

    expect(truncateAssistantWebText('abc', 6)).toEqual({
      text: 'abc',
      truncated: false,
    })
  })
})

describe('extractAssistantWebResponse', () => {
  it('extracts html into readable markdown', async () => {
    const response = new Response(
      '<!doctype html><html><head><title>Example page</title></head><body><main><article><h1>Example page</h1><p>Hello <strong>world</strong>.</p><ul><li>First</li><li>Second</li></ul></article></main></body></html>',
      {
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      },
    )

    const result = await extractAssistantWebResponse({
      contentType: 'text/html',
      extractMode: 'markdown',
      maxChars: 500,
      maxResponseBytes: 8_192,
      response,
    })

    expect(['readability', 'raw-html']).toContain(result.extractor)
    expect(result.title).toBe('Example page')
    expect(result.text).toContain('world')
    expect(result.text).toContain('First')
    expect(result.truncated).toBe(false)
  })

  it('rejects pdf content before reading the body', async () => {
    await expect(
      extractAssistantWebResponse({
        contentType: 'application/pdf',
        extractMode: 'markdown',
        maxChars: 500,
        maxResponseBytes: 8_192,
        response: new Response('ignored'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PDF_UNSUPPORTED',
    })
  })
})
