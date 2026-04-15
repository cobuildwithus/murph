import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const timeoutMocks = vi.hoisted(() => ({
  cleanups: [] as Array<ReturnType<typeof vi.fn>>,
  createTimeoutAbortController: vi.fn(),
  didTimeout: false,
}))

const webFetchConfigMocks = vi.hoisted(() => ({
  createAssistantWebFetchRuntimeContext: vi.fn(),
}))

const webFetchNetworkMocks = vi.hoisted(() => ({
  fetchAssistantWebResponse: vi.fn(),
}))

const webFetchResponseMocks = vi.hoisted(() => ({
  readAssistantWebResponseBytes: vi.fn(),
}))

const pdfJsMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
}))

vi.mock('@murphai/operator-config/http-retry', async () => {
  const actual = await vi.importActual<
    typeof import('@murphai/operator-config/http-retry')
  >('@murphai/operator-config/http-retry')

  return {
    ...actual,
    createTimeoutAbortController: timeoutMocks.createTimeoutAbortController,
  }
})

vi.mock('../src/assistant/web-fetch/config.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/assistant/web-fetch/config.js')
  >('../src/assistant/web-fetch/config.js')

  return {
    ...actual,
    createAssistantWebFetchRuntimeContext:
      webFetchConfigMocks.createAssistantWebFetchRuntimeContext,
  }
})

vi.mock('../src/assistant/web-fetch/network.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/assistant/web-fetch/network.js')
  >('../src/assistant/web-fetch/network.js')

  return {
    ...actual,
    fetchAssistantWebResponse: webFetchNetworkMocks.fetchAssistantWebResponse,
  }
})

vi.mock('../src/assistant/web-fetch/response.js', async () => {
  const actual = await vi.importActual<
    typeof import('../src/assistant/web-fetch/response.js')
  >('../src/assistant/web-fetch/response.js')

  return {
    ...actual,
    readAssistantWebResponseBytes:
      webFetchResponseMocks.readAssistantWebResponseBytes,
  }
})

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  VerbosityLevel: {
    ERRORS: 'errors',
  },
  getDocument: pdfJsMocks.getDocument,
}))

import { readAssistantWebPdf } from '../src/assistant/web-pdf-read.ts'

beforeEach(() => {
  timeoutMocks.cleanups = []
  timeoutMocks.didTimeout = false
  timeoutMocks.createTimeoutAbortController.mockReset().mockImplementation((signal) => {
    const controller = new AbortController()
    if (signal?.aborted) {
      controller.abort()
    } else {
      signal?.addEventListener('abort', () => controller.abort(), { once: true })
    }

    const cleanup = vi.fn()
    timeoutMocks.cleanups.push(cleanup)

    return {
      cleanup,
      signal: controller.signal,
      timedOut: () => timeoutMocks.didTimeout,
    }
  })

  webFetchConfigMocks.createAssistantWebFetchRuntimeContext.mockReset().mockReturnValue({
    lookupImplementation: vi.fn(),
    maxRedirects: 2,
    maxResponseBytes: 4_096,
    timeoutMs: 1_500,
  })
  webFetchNetworkMocks.fetchAssistantWebResponse.mockReset().mockResolvedValue(
    createFetchedResponse({
      contentType: 'application/pdf',
      finalUrl: 'https://example.com/document.pdf',
      status: 200,
    }),
  )
  webFetchResponseMocks.readAssistantWebResponseBytes.mockReset().mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    truncated: false,
    warnings: [],
  })
  pdfJsMocks.getDocument.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readAssistantWebPdf', () => {
  it('reads PDF text, clamps request bounds, and reports page, text, and HTTP warnings', async () => {
    webFetchNetworkMocks.fetchAssistantWebResponse.mockResolvedValueOnce(
      createFetchedResponse({
        contentType: 'application/x-pdf; charset=binary',
        finalUrl: 'https://docs.example.com/report.pdf?token=secret',
        status: 503,
        warnings: ['Followed one redirect.'],
      }),
    )
    webFetchResponseMocks.readAssistantWebResponseBytes.mockResolvedValueOnce({
      bytes: new Uint8Array([7, 8, 9]),
      truncated: false,
      warnings: ['Decoded a compressed response body.'],
    })

    const pdfDocumentDestroy = vi.fn().mockResolvedValue(undefined)
    const documentLoadingTaskDestroy = vi.fn().mockResolvedValue(undefined)
    const getPage = vi.fn(async () => ({
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { str: ' Hello ' },
          { str: 'world' },
          { str: ',' },
          { hasEOL: true, str: '   ' },
          { str: '(' },
          { str: 'beta' },
          { hasEOL: true, str: 'line' },
          { str: 'tail' },
          { notText: true },
        ],
      }),
    }))

    pdfJsMocks.getDocument.mockReturnValueOnce({
      destroy: documentLoadingTaskDestroy,
      promise: Promise.resolve({
        destroy: pdfDocumentDestroy,
        getPage,
        numPages: 2,
      }),
    })

    const response = await readAssistantWebPdf(
      {
        maxChars: 12.9,
        maxPages: 1.9,
        url: 'https://example.com/source.pdf#page=3',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    )

    expect(webFetchNetworkMocks.fetchAssistantWebResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        acceptHeader: expect.stringContaining('application/pdf'),
        toolName: 'web.pdf.read',
      }),
    )
    expect(
      String(webFetchNetworkMocks.fetchAssistantWebResponse.mock.calls[0]?.[0].url),
    ).toBe('https://example.com/source.pdf')
    expect(pdfJsMocks.getDocument).toHaveBeenCalledWith({
      data: new Uint8Array([7, 8, 9]),
      verbosity: 'errors',
    })
    expect(getPage).toHaveBeenCalledTimes(1)
    expect(response).toMatchObject({
      contentType: 'application/x-pdf',
      finalUrl: 'https://docs.example.com/report.pdf',
      pageCount: 2,
      status: 503,
      text: 'Hello world,',
      truncated: true,
      url: 'https://example.com/source.pdf',
    })
    expect(response.warnings).toEqual(
      expect.arrayContaining([
        'Followed one redirect.',
        'Decoded a compressed response body.',
        'Read only the first 1 pages out of 2 total pages.',
        'Trimmed extracted PDF text to 12 characters for model safety.',
        'Received HTTP 503 from the remote website.',
      ]),
    )
    expect(pdfDocumentDestroy).toHaveBeenCalled()
    expect(documentLoadingTaskDestroy).toHaveBeenCalled()
    expect(timeoutMocks.cleanups).toHaveLength(1)
    expect(timeoutMocks.cleanups[0]).toHaveBeenCalledTimes(1)
  })

  it('falls back to .pdf URLs, uses default bounds for non-finite inputs, and warns when no text is extractable', async () => {
    webFetchNetworkMocks.fetchAssistantWebResponse.mockResolvedValueOnce(
      createFetchedResponse({
        contentType: 'text/plain',
        finalUrl: 'https://cdn.example.com/archive.pdf?download=1',
        status: 200,
      }),
    )
    webFetchResponseMocks.readAssistantWebResponseBytes.mockResolvedValueOnce({
      bytes: new Uint8Array([5, 4, 3]),
      truncated: true,
      warnings: ['Response body exceeded 4096 bytes and was truncated.'],
    })

    const pdfDocumentDestroy = vi.fn().mockResolvedValue(undefined)
    const documentLoadingTaskDestroy = vi.fn().mockResolvedValue(undefined)
    const getPage = vi.fn(async () => ({
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: '  ' }],
      }),
    }))

    pdfJsMocks.getDocument.mockReturnValueOnce({
      destroy: documentLoadingTaskDestroy,
      promise: Promise.resolve({
        destroy: pdfDocumentDestroy,
        getPage,
        numPages: 9,
      }),
    })

    const response = await readAssistantWebPdf(
      {
        maxChars: Number.NaN,
        maxPages: Number.POSITIVE_INFINITY,
        url: 'https://example.com/empty.pdf',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    )

    expect(getPage).toHaveBeenCalledTimes(8)
    expect(response.text).toBe('')
    expect(response.pageCount).toBe(9)
    expect(response.truncated).toBe(true)
    expect(response.warnings).toEqual(
      expect.arrayContaining([
        'Remote response did not explicitly declare application/pdf; attempting PDF parsing because the final URL ends with .pdf.',
        'Response body exceeded 4096 bytes and was truncated.',
        'The PDF response hit the configured byte limit before parsing, so extracted text may be incomplete or malformed.',
        'Read only the first 8 pages out of 9 total pages.',
        'PDF parsing succeeded but no extractable text was found. The PDF may be image-only or scanned.',
      ]),
    )
    expect(pdfDocumentDestroy).toHaveBeenCalled()
    expect(documentLoadingTaskDestroy).toHaveBeenCalled()
  })

  it('rejects empty, invalid, and unsupported non-PDF requests', async () => {
    await expect(
      readAssistantWebPdf(
        {
          url: '   ',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_PDF_READ_URL_INVALID',
    })

    await expect(
      readAssistantWebPdf(
        {
          url: 'not-a-valid-url',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_PDF_READ_URL_INVALID',
    })

    webFetchNetworkMocks.fetchAssistantWebResponse.mockResolvedValueOnce(
      createFetchedResponse({
        contentType: 'text/html',
        finalUrl: 'https://example.com/index.html',
        status: 200,
      }),
    )

    await expect(
      readAssistantWebPdf(
        {
          url: 'https://example.com/index.html',
        },
        {
          MURPH_WEB_FETCH_ENABLED: 'true',
        },
      ),
    ).rejects.toMatchObject({
      code: 'WEB_PDF_READ_CONTENT_TYPE_UNSUPPORTED',
    })

    expect(webFetchResponseMocks.readAssistantWebResponseBytes).not.toHaveBeenCalled()
  })

  it('wraps PDF parse failures and appends the truncation note when bytes were clipped', async () => {
    webFetchResponseMocks.readAssistantWebResponseBytes.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      truncated: true,
      warnings: [],
    })

    const documentLoadingTaskDestroy = vi.fn().mockResolvedValue(undefined)
    pdfJsMocks.getDocument.mockReturnValueOnce({
      destroy: documentLoadingTaskDestroy,
      promise: Promise.reject(new Error('broken xref table')),
    })

    const error = await readAssistantWebPdf(
      {
        url: 'https://example.com/broken.pdf',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(VaultCliError)
    expect((error as VaultCliError).code).toBe('WEB_PDF_READ_PARSE_FAILED')
    expect((error as Error).message).toContain(
      'web.pdf.read could not extract text from https://example.com/document.pdf: broken xref table.',
    )
    expect((error as Error).message).toContain(
      'The PDF response was truncated by the configured byte limit before parsing.',
    )
    expect(documentLoadingTaskDestroy).toHaveBeenCalled()
  })

  it('rethrows immediately aborted requests before waiting on the PDF loading task', async () => {
    const requestAbortController = new AbortController()
    requestAbortController.abort()

    const pdfDocumentDestroy = vi.fn().mockResolvedValue(undefined)
    const documentLoadingTaskDestroy = vi.fn().mockResolvedValue(undefined)
    pdfJsMocks.getDocument.mockReturnValueOnce({
      destroy: documentLoadingTaskDestroy,
      promise: Promise.resolve({
        destroy: pdfDocumentDestroy,
        getPage: vi.fn(),
        numPages: 1,
      }),
    })

    const error = await readAssistantWebPdf(
      {
        signal: requestAbortController.signal,
        url: 'https://example.com/already-aborted.pdf',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(documentLoadingTaskDestroy).toHaveBeenCalled()
    expect(pdfDocumentDestroy).not.toHaveBeenCalled()
  })

  it('rethrows aborts after cancelling in-flight PDF operations', async () => {
    const requestAbortController = new AbortController()
    const pdfDocumentDestroy = vi.fn().mockResolvedValue(undefined)
    const documentLoadingTaskDestroy = vi.fn().mockResolvedValue(undefined)

    let resolveTextContent: ((value: { items: unknown[] }) => void) | undefined
    const textContentPromise = new Promise<{
      items: unknown[]
    }>((resolve) => {
      resolveTextContent = resolve
    })

    const getTextContent = vi.fn(() => textContentPromise)
    let resolveGetPage:
      | ((value: { getTextContent: () => Promise<{ items: unknown[] }> }) => void)
      | undefined
    const getPagePromise = new Promise<{
      getTextContent: () => Promise<{ items: unknown[] }>
    }>((resolve) => {
      resolveGetPage = resolve
    })

    const getPage = vi.fn(() => getPagePromise)
    pdfJsMocks.getDocument.mockReturnValueOnce({
      destroy: documentLoadingTaskDestroy,
      promise: Promise.resolve({
        destroy: pdfDocumentDestroy,
        getPage,
        numPages: 1,
      }),
    })

    const result = readAssistantWebPdf(
      {
        signal: requestAbortController.signal,
        url: 'https://example.com/slow.pdf',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    )

    await vi.waitFor(() => {
      expect(getPage).toHaveBeenCalledTimes(1)
    })
    resolveGetPage?.({
      getTextContent,
    })
    await vi.waitFor(() => {
      expect(getTextContent).toHaveBeenCalledTimes(1)
    })
    requestAbortController.abort()
    resolveTextContent?.({
      items: [{ str: 'ignored' }],
    })

    const error = await result.catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(pdfDocumentDestroy).toHaveBeenCalled()
    expect(documentLoadingTaskDestroy).toHaveBeenCalled()
  })

  it('rethrows aborts while waiting for the next PDF page handle', async () => {
    const requestAbortController = new AbortController()
    const pdfDocumentDestroy = vi.fn().mockResolvedValue(undefined)
    const documentLoadingTaskDestroy = vi.fn().mockResolvedValue(undefined)

    let resolveGetPage:
      | ((value: { getTextContent: () => Promise<{ items: unknown[] }> }) => void)
      | undefined
    const getPagePromise = new Promise<{
      getTextContent: () => Promise<{ items: unknown[] }>
    }>((resolve) => {
      resolveGetPage = resolve
    })

    const getPage = vi.fn(() => getPagePromise)
    pdfJsMocks.getDocument.mockReturnValueOnce({
      destroy: documentLoadingTaskDestroy,
      promise: Promise.resolve({
        destroy: pdfDocumentDestroy,
        getPage,
        numPages: 1,
      }),
    })

    const result = readAssistantWebPdf(
      {
        signal: requestAbortController.signal,
        url: 'https://example.com/pending-page.pdf',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    )

    await vi.waitFor(() => {
      expect(getPage).toHaveBeenCalledTimes(1)
    })
    requestAbortController.abort()
    resolveGetPage?.({
      getTextContent: async () => ({
        items: [{ str: 'ignored' }],
      }),
    })

    const error = await result.catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(pdfDocumentDestroy).toHaveBeenCalled()
    expect(documentLoadingTaskDestroy).toHaveBeenCalled()
  })

  it('translates timed out failures into a VaultCliError and still cleans up the timeout controller', async () => {
    timeoutMocks.didTimeout = true
    webFetchNetworkMocks.fetchAssistantWebResponse.mockRejectedValueOnce(
      new Error('socket hang up'),
    )

    const error = await readAssistantWebPdf(
      {
        url: 'https://example.com/timeout.pdf',
      },
      {
        MURPH_WEB_FETCH_ENABLED: 'true',
      },
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(VaultCliError)
    expect((error as VaultCliError).code).toBe('WEB_PDF_READ_TIMEOUT')
    expect((error as Error).message).toContain(
      'web.pdf.read timed out after 1500ms.',
    )
    expect(timeoutMocks.cleanups).toHaveLength(1)
    expect(timeoutMocks.cleanups[0]).toHaveBeenCalledTimes(1)
  })
})

function createFetchedResponse(input: {
  contentType: string | null
  finalUrl: string
  status: number
  warnings?: string[]
}) {
  const headers = new Headers()
  if (input.contentType) {
    headers.set('content-type', input.contentType)
  }

  return {
    finalUrl: new URL(input.finalUrl),
    response: new Response(new Uint8Array([1, 2, 3]), {
      headers,
      status: input.status,
    }),
    warnings: input.warnings ?? [],
  }
}
