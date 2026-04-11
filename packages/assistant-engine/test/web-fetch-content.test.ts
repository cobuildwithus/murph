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
      finalUrl: new URL('https://example.com/start'),
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
        finalUrl: new URL('https://example.com/file.pdf'),
        maxChars: 500,
        maxResponseBytes: 8_192,
        response: new Response('ignored'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PDF_UNSUPPORTED',
    })
  })

  it('rejects x-pdf content through the shared PDF classifier', async () => {
    await expect(
      extractAssistantWebResponse({
        contentType: 'application/x-pdf',
        extractMode: 'markdown',
        finalUrl: new URL('https://example.com/file.pdf'),
        maxChars: 500,
        maxResponseBytes: 8_192,
        response: new Response('ignored'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PDF_UNSUPPORTED',
    })
  })

  it('rejects opaque application binaries instead of decoding them as text', async () => {
    await expect(
      extractAssistantWebResponse({
        contentType: 'application/wasm',
        extractMode: 'text',
        finalUrl: new URL('https://example.com/app.wasm'),
        maxChars: 1_024,
        maxResponseBytes: 1_024,
        response: new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d])),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_CONTENT_TYPE_UNSUPPORTED',
      message: 'web.fetch cannot extract readable text from application/wasm.',
    })
  })

  it('still allows known textual application payloads', async () => {
    const extracted = await extractAssistantWebResponse({
      contentType: 'application/javascript',
      extractMode: 'text',
      finalUrl: new URL('https://example.com/app.js'),
      maxChars: 1_024,
      maxResponseBytes: 1_024,
      response: new Response('const greeting = "murph";\n'),
    })

    expect(extracted.extractor).toBe('raw-text')
    expect(extracted.text).toContain('const greeting = "murph";')
    expect(extracted.truncated).toBe(false)
  })

  it('resolves relative markdown links against the fetched final url', async () => {
    const extracted = await extractAssistantWebResponse({
      contentType: 'text/html',
      extractMode: 'markdown',
      finalUrl: new URL('https://example.com/articles/start?ref=docs'),
      maxChars: 4_000,
      maxResponseBytes: 4_000,
      response: new Response(
        '<html><body><article><p><a href="/guides/install#quickstart">Install guide</a></p></article></body></html>',
      ),
    })

    expect(extracted.text).toContain(
      '[Install guide](https://example.com/guides/install)',
    )
    expect(extracted.text).not.toContain('#quickstart')
  })
})
