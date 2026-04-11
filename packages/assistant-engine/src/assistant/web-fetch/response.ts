import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { createBrotliDecompress, createUnzip } from 'node:zlib'

import { normalizeNullableString } from '../shared.js'
import type { AssistantWebResponseBytes } from './config.js'

export interface AssistantWebResponseText {
  text: string
  truncated: boolean
  warnings: string[]
}

export async function readAssistantWebResponseBytes(input: {
  maxResponseBytes: number
  response: Response
}): Promise<AssistantWebResponseBytes> {
  const warnings: string[] = []
  const contentLength = parsePositiveInteger(
    input.response.headers.get('content-length'),
  )
  if (
    contentLength !== null &&
    contentLength > input.maxResponseBytes
  ) {
    warnings.push(
      `Response declared ${contentLength} bytes; reading only the first ${input.maxResponseBytes} bytes.`,
    )
  }

  if (!input.response.body) {
    return {
      bytes: new Uint8Array(),
      truncated: false,
      warnings,
    }
  }

  const reader = input.response.body.getReader()
  let totalBytes = 0
  const chunks: Uint8Array[] = []
  let truncated = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    if (!value || value.length === 0) {
      continue
    }

    const remainingBytes = input.maxResponseBytes - totalBytes
    if (remainingBytes <= 0) {
      truncated = true
      break
    }

    const chunk = value.length > remainingBytes
      ? value.subarray(0, remainingBytes)
      : value
    totalBytes += chunk.length
    chunks.push(chunk)

    if (value.length > remainingBytes) {
      truncated = true
      break
    }
  }

  if (truncated) {
    warnings.push(
      `Response body exceeded ${input.maxResponseBytes} bytes and was truncated.`,
    )
    try {
      await reader.cancel()
    } catch {
      // Ignore cancellation failures after truncation.
    }
  }

  return {
    bytes: concatAssistantWebResponseBytes(chunks, totalBytes),
    truncated,
    warnings,
  }
}

export async function readAssistantWebResponseText(input: {
  maxResponseBytes: number
  response: Response
}): Promise<AssistantWebResponseText> {
  const body = await readAssistantWebResponseBytes(input)
  const decoder = createAssistantWebResponseTextDecoder(
    input.response.headers.get('content-type'),
  )

  return {
    text: decoder.decoder.decode(body.bytes),
    truncated: body.truncated,
    warnings: [...body.warnings, ...decoder.warnings],
  }
}

export async function cancelAssistantWebResponseBody(response: Response): Promise<void> {
  if (!response.body) {
    return
  }

  try {
    await response.body.cancel()
  } catch {
    // Ignore response-body cancellation failures during cleanup.
  }
}

export function createAssistantWebNodeResponse(
  response: IncomingMessage,
): Response {
  const headers = createAssistantWebResponseHeaders(response)
  const status = response.statusCode ?? 500
  const statusText = normalizeNullableString(response.statusMessage)

  if (assistantWebResponseStatusHasNoBody(status)) {
    discardAssistantWebIncomingMessageBody(response, headers)
    return new Response(null, {
      status,
      headers,
      ...(statusText ? { statusText } : {}),
    })
  }

  const body = decodeAssistantWebResponseBody(response, headers)
  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
    status,
    headers,
    ...(statusText ? { statusText } : {}),
  })
}

function assistantWebResponseStatusHasNoBody(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

function discardAssistantWebIncomingMessageBody(
  response: IncomingMessage,
  headers: Headers,
): void {
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.delete('transfer-encoding')
  response.resume()
}

function createAssistantWebResponseHeaders(
  response: IncomingMessage,
): Headers {
  const headers = new Headers()

  for (const [name, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(name, entry)
      }
      continue
    }

    if (typeof value === 'string') {
      headers.append(name, value)
    }
  }

  return headers
}

function decodeAssistantWebResponseBody(
  response: IncomingMessage,
  headers: Headers,
): Readable {
  const contentEncoding = normalizeNullableString(headers.get('content-encoding'))?.toLowerCase()

  switch (contentEncoding) {
    case 'br':
      headers.delete('content-encoding')
      headers.delete('content-length')
      return response.pipe(createBrotliDecompress())
    case 'deflate':
    case 'gzip':
    case 'x-gzip':
      headers.delete('content-encoding')
      headers.delete('content-length')
      return response.pipe(createUnzip())
    default:
      return response
  }
}

function parsePositiveInteger(value: string | null): number | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return Math.trunc(parsed)
}

function createAssistantWebResponseTextDecoder(
  contentTypeHeader: string | null,
): {
  decoder: TextDecoder
  warnings: string[]
} {
  const charset = resolveAssistantWebResponseCharset(contentTypeHeader)
  if (!charset) {
    return {
      decoder: new TextDecoder(),
      warnings: [],
    }
  }

  try {
    return {
      decoder: new TextDecoder(charset),
      warnings: [],
    }
  } catch {
    return {
      decoder: new TextDecoder(),
      warnings: [
        `Response declared unsupported charset ${charset}; decoding as utf-8 instead.`,
      ],
    }
  }
}

function resolveAssistantWebResponseCharset(
  contentTypeHeader: string | null,
): string | null {
  const normalized = normalizeNullableString(contentTypeHeader)
  if (!normalized) {
    return null
  }

  const parameters = normalized
    .split(';')
    .slice(1)
    .map((parameter) => parameter.trim())
    .filter((parameter) => parameter.length > 0)

  for (const parameter of parameters) {
    const [key, ...valueParts] = parameter.split('=')
    if (key?.trim().toLowerCase() !== 'charset') {
      continue
    }

    const rawCharset = valueParts.join('=')
    const trimmedCharset = normalizeNullableString(rawCharset)
    if (!trimmedCharset) {
      return null
    }

    return stripAssistantWrappingQuotes(trimmedCharset).toLowerCase()
  }

  return null
}

function stripAssistantWrappingQuotes(input: string): string {
  if (
    input.length >= 2 &&
    ((input.startsWith('"') && input.endsWith('"')) ||
      (input.startsWith("'") && input.endsWith("'")))
  ) {
    return input.slice(1, -1)
  }

  return input
}

function concatAssistantWebResponseBytes(
  chunks: Uint8Array[],
  totalBytes: number,
): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array()
  }

  if (chunks.length === 1) {
    return chunks[0] ?? new Uint8Array()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }

  return bytes
}
