import { describe, expect, it } from 'vitest'

import { extractAssistantWebHtml } from '../src/assistant/web-fetch/html.js'

describe('assistant web html markdown rendering', () => {
  it('drops non-http links instead of emitting unsafe markdown hrefs', () => {
    const extracted = extractAssistantWebHtml({
      baseUrl: new URL('https://example.com/docs/start'),
      extractMode: 'markdown',
      html: '<html><body><article><p><a href="javascript:alert(1)">Launch</a></p></article></body></html>',
    })

    expect(extracted.text).toContain('Launch')
    expect(extracted.text).not.toContain('javascript:')
    expect(extracted.text).not.toContain('[Launch](')
  })
})
