import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import {
  createAssistantWebNodeResponse,
  readAssistantWebResponseText,
} from '../src/assistant/web-fetch/response.js'

describe('assistant web response decoding', () => {
  it('decodes declared response charsets instead of assuming utf-8', async () => {
    const response = new Response(
      new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
      {
        headers: {
          'content-type': 'text/plain; charset="iso-8859-1"',
        },
      },
    )

    const decoded = await readAssistantWebResponseText({
      maxResponseBytes: 1_024,
      response,
    })

    expect(decoded.text).toBe('café')
    expect(decoded.warnings).toEqual([])
    expect(decoded.truncated).toBe(false)
  })

  it('falls back to utf-8 when a response declares an unsupported charset', async () => {
    const response = new Response('murph café', {
      headers: {
        'content-type': 'text/plain; charset=definitely-not-a-real-charset',
      },
    })

    const decoded = await readAssistantWebResponseText({
      maxResponseBytes: 1_024,
      response,
    })

    expect(decoded.text).toBe('murph café')
    expect(decoded.warnings).toEqual([
      'Response declared unsupported charset definitely-not-a-real-charset; decoding as utf-8 instead.',
    ])
  })

  it('builds bodyless fetch responses for upstream 204, 205, and 304 replies', async () => {
    for (const statusCode of [204, 205, 304]) {
      const incomingMessage = Object.assign(
        Readable.from([]),
        {
          headers: {
            'content-encoding': 'gzip',
            'content-length': '4',
            'transfer-encoding': 'chunked',
          },
          statusCode,
          statusMessage: 'No Content',
        },
      ) as IncomingMessage

      const response = createAssistantWebNodeResponse(incomingMessage)

      expect(response.status).toBe(statusCode)
      expect(response.body).toBeNull()
      expect(response.headers.get('content-encoding')).toBeNull()
      expect(response.headers.get('content-length')).toBeNull()
      expect(response.headers.get('transfer-encoding')).toBeNull()
    }
  })
})
