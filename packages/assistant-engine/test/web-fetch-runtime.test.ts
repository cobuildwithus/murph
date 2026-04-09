import { Readable } from 'node:stream'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

type WebFetchModule = typeof import('../src/assistant/web-fetch.ts')
type LookupImplementation = typeof import('node:dns/promises').lookup
type MockLookupAddress = {
  address: string
  family: number
}
type LinkedomMimeType = 'text/html' | 'image/svg+xml' | 'text/xml'

type MockResponseDefinition = {
  body?: string | Uint8Array | Array<string | Uint8Array> | null
  headers?: Record<string, string | string[] | undefined>
  status: number
  statusText?: string
}

type MockRequestStep =
  | {
      error: Error
      type: 'error'
    }
  | {
      response: MockResponseDefinition
      type: 'response'
    }

type ReadabilityParseResult = {
  content?: string | null
  textContent?: string | null
  title?: string | null
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.doUnmock('node:http')
  vi.doUnmock('node:https')
  vi.doUnmock('node:dns/promises')
  vi.doUnmock('@mozilla/readability')
  vi.doUnmock('@murphai/operator-config/http-retry')
  vi.resetModules()
})

describe('assistant web-fetch runtime', () => {
  it('resolves enablement, clamps runtime env values, and normalizes helper outputs', async () => {
    const { module } = await loadWebFetchModule()

    expect(module.resolveAssistantWebFetchEnabled({})).toBe(false)
    expect(
      module.resolveAssistantWebFetchEnabled({
        MURPH_WEB_FETCH_ENABLED: ' On ',
      }),
    ).toBe(true)

    vi.stubGlobal('Headers', undefined)
    expect(
      module.resolveAssistantWebFetchEnabled({
        MURPH_WEB_FETCH_ENABLED: 'true',
      }),
    ).toBe(false)
    vi.unstubAllGlobals()

    expect(() => module.createAssistantWebFetchRuntimeContext({})).toThrowError(
      expect.objectContaining({
        code: 'WEB_FETCH_DISABLED',
      }),
    )

    expect(
      module.createAssistantWebFetchRuntimeContext({
        MURPH_WEB_FETCH_ENABLED: 'true',
        MURPH_WEB_FETCH_MAX_REDIRECTS: '999',
        MURPH_WEB_FETCH_MAX_RESPONSE_BYTES: '10',
        MURPH_WEB_FETCH_TIMEOUT_MS: '999999',
      }),
    ).toMatchObject({
      maxRedirects: 10,
      maxResponseBytes: 16_384,
      timeoutMs: 60_000,
    })

    expect(module.resolveAssistantWebMediaType(' Text/HTML ; charset=utf-8 ')).toBe('text/html')
    expect(module.resolveAssistantWebMediaType('   ')).toBeNull()
    expect(module.truncateAssistantWebText('abcdef', 4)).toEqual({
      text: 'abcd',
      truncated: true,
    })
    expect(module.redactAssistantWebFetchUrl(new URL('https://example.com/path?q=1#frag'))).toBe(
      'https://example.com/path',
    )
  })

  it('reads response bytes, warns on content-length mismatches, and truncates oversized streams', async () => {
    const { module } = await loadWebFetchModule()
    const encoder = new TextEncoder()
    const chunks = [encoder.encode('abc'), encoder.encode('def')]
    let chunkIndex = 0

    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[chunkIndex]
          chunkIndex += 1
          if (chunk) {
            controller.enqueue(chunk)
            return
          }
          controller.close()
        },
        cancel() {
          throw new Error('reader cancel should be ignored after truncation')
        },
      }),
      {
        headers: {
          'content-length': '6',
        },
      },
    )

    await expect(
      module.readAssistantWebResponseBytes({
        maxResponseBytes: 4,
        response,
      }),
    ).resolves.toEqual({
      bytes: encoder.encode('abcd'),
      truncated: true,
      warnings: [
        'Response declared 6 bytes; reading only the first 4 bytes.',
        'Response body exceeded 4 bytes and was truncated.',
      ],
    })

    await expect(
      module.readAssistantWebResponseBytes({
        maxResponseBytes: 4,
        response: new Response(null),
      }),
    ).resolves.toEqual({
      bytes: new Uint8Array(),
      truncated: false,
      warnings: [],
    })
  })

  it('rejects unsupported schemes, credentials, blocked hosts, and DNS failures', async () => {
    const { module } = await loadWebFetchModule()
    const signal = new AbortController().signal
    const runtime = {
      lookupImplementation: createLookupImplementation([
        { address: '8.8.8.8', family: 4 },
      ]),
      maxRedirects: 2,
      maxResponseBytes: 1_000,
      timeoutMs: 5_000,
    }

    await expect(
      module.fetchAssistantWebResponse({
        runtime,
        signal,
        toolName: 'web.fetch',
        url: new URL('ftp://example.com/file.txt'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_URL_UNSUPPORTED_SCHEME',
    })

    await expect(
      module.fetchAssistantWebResponse({
        runtime,
        signal,
        toolName: 'web.fetch',
        url: new URL('https://user:pass@example.com/secret'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_URL_CREDENTIALS_FORBIDDEN',
    })

    await expect(
      module.fetchAssistantWebResponse({
        runtime,
        signal,
        toolName: 'web.fetch',
        url: new URL('https://localhost/internal'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PRIVATE_HOST_BLOCKED',
    })

    const privateLookup = createLookupImplementation([
      { address: '10.0.0.1', family: 4 },
    ])
    await expect(
      module.fetchAssistantWebResponse({
        runtime: {
          ...runtime,
          lookupImplementation: privateLookup,
        },
        signal,
        toolName: 'web.fetch',
        url: new URL('https://example.com/private'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PRIVATE_HOST_BLOCKED',
    })

    const dnsFailure: typeof import('node:dns/promises').lookup = vi.fn(async () => {
      throw new Error('lookup exploded')
    })
    await expect(
      module.fetchAssistantWebResponse({
        runtime: {
          ...runtime,
          lookupImplementation: dnsFailure,
        },
        signal,
        toolName: 'web.fetch',
        url: new URL('https://example.com/unresolved'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_DNS_LOOKUP_FAILED',
    })
  })

  it('retries later vetted public addresses when an earlier address fails', async () => {
    const { httpsRequestMock, module } = await loadWebFetchModule({
      httpsSteps: [
        {
          error: new Error('connect ECONNREFUSED'),
          type: 'error',
        },
        {
          response: {
            body: 'ok',
            headers: {
              'content-type': 'text/plain',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })
    const lookupImplementation = createLookupImplementation([
      {
        address: 'edge-a.test',
        family: 0,
      },
      {
        address: 'edge-b.test',
        family: 0,
      },
    ])

    const result = await module.fetchAssistantWebResponse({
      runtime: {
        lookupImplementation,
        maxRedirects: 2,
        maxResponseBytes: 1_000,
        timeoutMs: 5_000,
      },
      signal: new AbortController().signal,
      toolName: 'web.fetch',
      url: new URL('https://example.com/article'),
    })

    expect(await result.response.text()).toBe('ok')
    expect(result.finalUrl.href).toBe('https://example.com/article')
    expect(result.warnings).toEqual([])
    expect(httpsRequestMock).toHaveBeenCalledTimes(2)
    expect(httpsRequestMock.mock.calls[0]?.[0]).toMatchObject({
      family: 0,
      headers: {
        accept: 'text/html, application/xhtml+xml, application/json, text/plain;q=0.9, */*;q=0.1',
        'accept-encoding': 'identity',
      },
      servername: 'example.com',
    })
    expect(httpsRequestMock.mock.calls[1]?.[0]).toMatchObject({
      family: 0,
      servername: 'example.com',
    })
  })

  it('deduplicates repeated DNS answers before retrying the remaining public addresses', async () => {
    const { httpsRequestMock, module } = await loadWebFetchModule({
      httpsSteps: [
        {
          error: new Error('connect ECONNREFUSED'),
          type: 'error',
        },
        {
          response: {
            body: 'ok',
            headers: {
              'content-type': 'text/plain',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })
    const lookupImplementation = createLookupImplementation([
      {
        address: 'edge-a.test',
        family: 0,
      },
      {
        address: 'edge-a.test',
        family: 0,
      },
      {
        address: 'edge-b.test',
        family: 0,
      },
    ])

    const result = await module.fetchAssistantWebResponse({
      runtime: {
        lookupImplementation,
        maxRedirects: 2,
        maxResponseBytes: 1_000,
        timeoutMs: 5_000,
      },
      signal: new AbortController().signal,
      toolName: 'web.fetch',
      url: new URL('https://example.com/deduped-addresses'),
    })

    expect(await result.response.text()).toBe('ok')
    expect(httpsRequestMock).toHaveBeenCalledTimes(2)
  })

  it('follows redirects and rejects invalid redirect responses or redirect loops', async () => {
    const firstLoad = await loadWebFetchModule({
      httpsSteps: [
        {
          response: {
            headers: {
              location: '/next?token=secret',
            },
            status: 302,
          },
          type: 'response',
        },
        {
          response: {
            body: 'redirected',
            headers: {
              'content-type': 'text/plain',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    const redirected = await firstLoad.module.fetchAssistantWebResponse({
      runtime: {
        lookupImplementation: createLookupImplementation([
          { address: 'edge.example.test', family: 0 },
        ]),
        maxRedirects: 1,
        maxResponseBytes: 1_000,
        timeoutMs: 5_000,
      },
      signal: new AbortController().signal,
      toolName: 'web.fetch',
      url: new URL('https://example.com/start#ignored'),
    })

    expect(await redirected.response.text()).toBe('redirected')
    expect(redirected.finalUrl.href).toBe('https://example.com/next?token=secret')
    expect(redirected.warnings).toEqual([
      'Followed redirect 1 to https://example.com/next.',
    ])

    const invalidLocationLoad = await loadWebFetchModule({
      httpsSteps: [
        {
          response: {
            status: 302,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      invalidLocationLoad.module.fetchAssistantWebResponse({
        runtime: {
          lookupImplementation: createLookupImplementation([
            { address: 'edge.example.test', family: 0 },
          ]),
          maxRedirects: 1,
          maxResponseBytes: 1_000,
          timeoutMs: 5_000,
        },
        signal: new AbortController().signal,
        toolName: 'web.fetch',
        url: new URL('https://example.com/start'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REDIRECT_INVALID',
    })

    const redirectLimitLoad = await loadWebFetchModule({
      httpsSteps: [
        {
          response: {
            headers: {
              location: '/next',
            },
            status: 302,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      redirectLimitLoad.module.fetchAssistantWebResponse({
        runtime: {
          lookupImplementation: createLookupImplementation([
            { address: 'edge.example.test', family: 0 },
          ]),
          maxRedirects: 0,
          maxResponseBytes: 1_000,
          timeoutMs: 5_000,
        },
        signal: new AbortController().signal,
        toolName: 'web.fetch',
        url: new URL('https://example.com/start'),
      }),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_REDIRECT_LIMIT',
    })
  })

  it('normalizes JSON responses, redacts URLs, and adds HTTP plus truncation warnings', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T01:02:03.456Z'))

    const { module } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        { address: 'edge.example.test', family: 0 },
      ]),
      httpsSteps: [
        {
          response: {
            body: 'not valid json',
            headers: {
              'content-type': 'application/problem+json; charset=utf-8',
            },
            status: 503,
            statusText: 'Service Unavailable',
          },
          type: 'response',
        },
      ],
    })

    await expect(
      module.fetchAssistantWeb(
        {
          maxChars: 4,
          url: ' https://example.com/path/to/page?token=secret#fragment ',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toEqual({
      contentType: 'application/problem+json',
      extractMode: 'markdown',
      extractor: 'json',
      fetchedAt: '2026-04-08T01:02:03.456Z',
      finalUrl: 'https://example.com/path/to/page',
      status: 503,
      text: 'not',
      title: null,
      truncated: true,
      url: 'https://example.com/path/to/page',
      warnings: [
        'Response declared JSON but could not be parsed cleanly; returning normalized text instead.',
        'Trimmed extracted content to 4 characters for model safety.',
        'Received HTTP 503 from the remote website.',
      ],
    })
  })

  it('extracts readability results and falls back to article text when markdown conversion is empty', async () => {
    const { module } = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        { address: 'edge.example.test', family: 0 },
      ]),
      httpsSteps: [
        {
          response: {
            body: '<!doctype html><html><head><title>Readable Title</title></head><body><article>ignored by mock</article></body></html>',
            headers: {
              'content-type': 'text/html; charset=utf-8',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
      readabilityParse: () => ({
        content: '',
        textContent: 'Readable article text',
        title: null,
      }),
    })

    await expect(
      module.fetchAssistantWeb(
        {
          extractMode: 'markdown',
          url: 'https://example.com/readable',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      extractor: 'readability',
      text: 'Readable article text',
      title: 'Readable Title',
      truncated: false,
      warnings: [
        'Readable article markdown conversion was empty; falling back to normalized article text.',
      ],
    })
  })

  it('falls back to raw html markdown cleanup and rejects pdf responses', async () => {
    const fallbackLoad = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        { address: 'edge.example.test', family: 0 },
      ]),
      httpsSteps: [
        {
          response: {
            body: [
              '<!doctype html><html><head><title>Fallback Title</title><style>.bad{display:none}</style></head><body>',
              '<main><h2>Heading</h2><p>Hello <strong>world</strong> and <em>friends</em> <a href="https://example.com/link">Link</a><br>Next line</p>',
              '<ul><li>One</li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>',
              '<blockquote>Quoted text</blockquote><pre>const x = 1;</pre><table><tr><td>Cell value</td></tr></table>',
              '<script>ignored()</script></main></body></html>',
            ],
            headers: {
              'content-type': 'text/html',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
      readabilityParse: () => null,
    })

    const fallbackResult = await fallbackLoad.module.fetchAssistantWeb(
      {
        extractMode: 'markdown',
        url: 'https://example.com/fallback',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    )

    expect(fallbackResult.extractor).toBe('raw-html')
    expect(fallbackResult.title).toBe('Fallback Title')
    expect(fallbackResult.text).toContain('## Heading')
    expect(fallbackResult.text).toContain('**world**')
    expect(fallbackResult.text).toContain('_friends_')
    expect(fallbackResult.text).toContain('[Link](https://example.com/link)')
    expect(fallbackResult.text).toContain('- One')
    expect(fallbackResult.text).toContain('1. First')
    expect(fallbackResult.text).toContain('> Quoted text')
    expect(fallbackResult.text).toContain('```')
    expect(fallbackResult.text).toContain('Cell value')
    expect(fallbackResult.warnings).toEqual([
      'Readable article extraction failed; falling back to a simpler HTML cleanup path.',
    ])

    const pdfLoad = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        { address: 'edge.example.test', family: 0 },
      ]),
      httpsSteps: [
        {
          response: {
            body: '%PDF-1.7',
            headers: {
              'content-type': 'application/pdf',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      pdfLoad.module.fetchAssistantWeb(
        {
          url: 'https://example.com/document.pdf',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_FETCH_PDF_UNSUPPORTED',
    })
  })

  it('decompresses gzip and brotli encoded responses before extraction', async () => {
    const gzipLoad = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        { address: 'edge.example.test', family: 0 },
      ]),
      httpsSteps: [
        {
          response: {
            body: gzipSync(Buffer.from('compressed gzip body', 'utf8')),
            headers: {
              'content-encoding': 'gzip',
              'content-type': 'text/plain',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      gzipLoad.module.fetchAssistantWeb(
        {
          url: 'https://example.com/gzip',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      text: 'compressed gzip body',
      url: 'https://example.com/gzip',
    })

    const brotliLoad = await loadWebFetchModule({
      lookupImplementation: createLookupImplementation([
        { address: 'edge.example.test', family: 0 },
      ]),
      httpsSteps: [
        {
          response: {
            body: brotliCompressSync(Buffer.from('compressed brotli body', 'utf8')),
            headers: {
              'content-encoding': 'br',
              'content-type': 'text/plain',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
    })

    await expect(
      brotliLoad.module.fetchAssistantWeb(
        {
          url: 'https://example.com/br',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      text: 'compressed brotli body',
      url: 'https://example.com/br',
    })
  })

  it('reads html document titles from title.textContent when the parser returns a title object', async () => {
    const { module } = await loadWebFetchModule({
      linkedomDocumentTransform(document) {
        Object.defineProperty(document, 'title', {
          configurable: true,
          value: {
            textContent: ' Object Title ',
          },
        })
        return document
      },
      lookupImplementation: createLookupImplementation([
        { address: 'edge.example.test', family: 0 },
      ]),
      httpsSteps: [
        {
          response: {
            body: '<!doctype html><html><head><title>Ignored</title></head><body><article>body</article></body></html>',
            headers: {
              'content-type': 'text/html; charset=utf-8',
            },
            status: 200,
          },
          type: 'response',
        },
      ],
      readabilityParse: () => ({
        content: '',
        textContent: 'object title fallback body',
        title: null,
      }),
    })

    await expect(
      module.fetchAssistantWeb(
        {
          extractMode: 'text',
          url: 'https://example.com/object-title',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).resolves.toMatchObject({
      text: 'object title fallback body',
      title: 'Object Title',
    })
  })
})

async function loadWebFetchModule(input?: {
  httpSteps?: MockRequestStep[]
  httpsSteps?: MockRequestStep[]
  linkedomDocumentTransform?: (document: unknown) => unknown
  lookupImplementation?: typeof import('node:dns/promises').lookup
  readabilityParse?: () => ReadabilityParseResult | null
  timeoutControllerFactory?: typeof import('@murphai/operator-config/http-retry').createTimeoutAbortController
}): Promise<{
  httpRequestMock: ReturnType<typeof vi.fn>
  httpsRequestMock: ReturnType<typeof vi.fn>
  module: WebFetchModule
}> {
  vi.resetModules()

  const httpRequestMock = createRequestMock(input?.httpSteps ?? [])
  const httpsRequestMock = createRequestMock(input?.httpsSteps ?? [])

  vi.doMock('node:http', () => ({
    request: httpRequestMock,
  }))
  vi.doMock('node:https', () => ({
    request: httpsRequestMock,
  }))

  if (input?.lookupImplementation) {
    vi.doMock('node:dns/promises', () => ({
      lookup: input.lookupImplementation,
    }))
  }

  if (input?.readabilityParse) {
    const readabilityParse = input.readabilityParse
    vi.doMock('@mozilla/readability', () => ({
      Readability: class {
        parse() {
          return readabilityParse()
        }
      },
    }))
  }

  if (input?.linkedomDocumentTransform) {
    vi.doMock('linkedom', async () => {
      const actual = await vi.importActual<typeof import('linkedom')>('linkedom')
      const transform = input.linkedomDocumentTransform
      return {
        ...actual,
        DOMParser: class {
          private readonly delegate = new actual.DOMParser()

          parseFromString(
            markupLanguage: string,
            mimeType: LinkedomMimeType,
            globals?: unknown,
          ) {
            const document = this.delegate.parseFromString(
              markupLanguage,
              mimeType,
              globals,
            )
            return transform?.(document) ?? document
          }
        },
      }
    })
  }

  if (input?.timeoutControllerFactory) {
    vi.doMock('@murphai/operator-config/http-retry', async () => {
      const actual = await vi.importActual<typeof import('@murphai/operator-config/http-retry')>(
        '@murphai/operator-config/http-retry',
      )
      return {
        ...actual,
        createTimeoutAbortController: input.timeoutControllerFactory,
      }
    })
  }

  return {
    httpRequestMock,
    httpsRequestMock,
    module: await import('../src/assistant/web-fetch.ts'),
  }
}

function createRequestMock(steps: MockRequestStep[]) {
  const queuedSteps = [...steps]

  return vi.fn((options: unknown, callback?: (response: import('node:http').IncomingMessage) => void) => {
    const step = queuedSteps.shift()
    if (!step) {
      throw new Error(`Unexpected request: ${JSON.stringify(options)}`)
    }

    const listeners = new Map<string, Array<(error: Error) => void>>()

    return {
      end() {
        queueMicrotask(() => {
          if (step.type === 'error') {
            for (const listener of listeners.get('error') ?? []) {
              listener(step.error)
            }
            return
          }

          callback?.(createIncomingMessage(step.response))
        })
      },
      once(eventName: string, listener: (error: Error) => void) {
        const existing = listeners.get(eventName) ?? []
        existing.push(listener)
        listeners.set(eventName, existing)
        return this
      },
    }
  })
}

function createIncomingMessage(
  response: MockResponseDefinition,
): import('node:http').IncomingMessage {
  return Object.assign(
    Readable.from(normalizeResponseChunks(response.body)),
    {
      headers: response.headers ?? {},
      statusCode: response.status,
      statusMessage: response.statusText ?? 'OK',
    },
  ) as import('node:http').IncomingMessage
}

function normalizeResponseChunks(
  body: MockResponseDefinition['body'],
): Uint8Array[] {
  if (body === null || body === undefined) {
    return []
  }

  const encoder = new TextEncoder()
  const chunks = Array.isArray(body) ? body : [body]
  return chunks.map((chunk) =>
    typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
  )
}

function createLookupImplementation(
  addresses: MockLookupAddress[],
): LookupImplementation {
  const fallback = addresses[0] ?? { address: '127.0.0.1', family: 4 }
  const lookupImplementation = (async (
    _hostname: string,
    options?: number | { all?: boolean },
  ) => {
    if (typeof options === 'number') {
      return fallback
    }
    if (options?.all) {
      return addresses
    }
    return fallback
  }) as LookupImplementation

  return lookupImplementation
}
