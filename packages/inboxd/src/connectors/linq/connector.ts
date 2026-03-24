import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { EmitCapture, PollConnector } from '../types.js'
import { normalizeLinqWebhookEvent, type LinqAttachmentDownloadDriver } from './normalize.js'
import type { LinqWebhookEvent } from './types.js'

const DEFAULT_LINQ_WEBHOOK_HOST = '0.0.0.0'
const DEFAULT_LINQ_WEBHOOK_PATH = '/linq-webhook'
const DEFAULT_LINQ_WEBHOOK_PORT = 8789

export interface LinqWebhookConnectorOptions {
  id?: string
  source?: string
  accountId?: string | null
  host?: string
  path?: string
  port?: number
  webhookSecret?: string | null
  downloadAttachments?: boolean
  fetchImplementation?: typeof globalThis.fetch
}

export function createLinqWebhookConnector({
  id,
  source = 'linq',
  accountId = null,
  host = DEFAULT_LINQ_WEBHOOK_HOST,
  path = DEFAULT_LINQ_WEBHOOK_PATH,
  port = DEFAULT_LINQ_WEBHOOK_PORT,
  webhookSecret = null,
  downloadAttachments = true,
  fetchImplementation = globalThis.fetch?.bind(globalThis),
}: LinqWebhookConnectorOptions = {}): PollConnector {
  const normalizedSource = normalizeRequiredString(source, 'Linq source')
  const normalizedAccountId = normalizeNullableString(accountId)
  const normalizedHost = normalizeRequiredString(host, 'Linq webhook host')
  const normalizedPath = normalizeWebhookPath(path)
  const normalizedPort = normalizeWebhookPort(port)
  const normalizedSecret = normalizeNullableString(webhookSecret)
  const connectorId =
    normalizeNullableString(id) ??
    `${normalizedSource}:${normalizedAccountId ?? normalizedHost.replace(/[:.]/gu, '-')}:${normalizedPort}`
  let closeServer: (() => Promise<void>) | null = null

  const downloadDriver: LinqAttachmentDownloadDriver | null =
    downloadAttachments && typeof fetchImplementation === 'function'
      ? {
          downloadUrl: async (url, signal) => {
            const response = await fetchImplementation(url, {
              method: 'GET',
              signal,
            })
            if (!response.ok) {
              throw new Error(
                `Linq attachment download failed with HTTP ${response.status} for ${url}.`,
              )
            }

            return new Uint8Array(await response.arrayBuffer())
          },
        }
      : null

  return {
    id: connectorId,
    source: normalizedSource,
    accountId: normalizedAccountId,
    kind: 'poll',
    capabilities: {
      backfill: false,
      watch: true,
      webhooks: true,
      attachments: true,
      ownMessages: true,
    },
    async backfill(cursor) {
      return cursor ?? null
    },
    async watch(_cursor, emit, signal) {
      if (closeServer) {
        throw new Error('Linq webhook connector is already watching.')
      }

      const server = createServer(async (request, response) => {
        try {
          await handleLinqWebhookRequest({
            request,
            response,
            webhookPath: normalizedPath,
            webhookSecret: normalizedSecret,
            accountId: normalizedAccountId,
            source: normalizedSource,
            emit,
            downloadDriver,
          })
        } catch (error) {
          respondJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

      closeServer = () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            closeServer = null
            if (error) {
              reject(error)
              return
            }
            resolve()
          })
        })

      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort)
          closeServer?.().then(resolve, reject)
        }

        server.on('error', (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        })

        signal.addEventListener('abort', onAbort, { once: true })
        server.listen(normalizedPort, normalizedHost, () => {
          if (signal.aborted) {
            onAbort()
          }
        })
      })
    },
    async close() {
      await closeServer?.()
    },
  }
}

async function handleLinqWebhookRequest(input: {
  request: IncomingMessage
  response: ServerResponse<IncomingMessage>
  webhookPath: string
  webhookSecret: string | null
  accountId: string | null
  source: string
  emit: EmitCapture
  downloadDriver: LinqAttachmentDownloadDriver | null
}): Promise<void> {
  const method = normalizeNullableString(input.request.method)?.toUpperCase() ?? 'GET'
  const pathname = new URL(
    input.request.url ?? '/',
    `http://${input.request.headers.host ?? '127.0.0.1'}`,
  ).pathname

  if (pathname !== input.webhookPath) {
    respondJson(input.response, 404, {
      ok: false,
      error: 'Not found.',
    })
    return
  }

  if (method === 'GET') {
    respondJson(input.response, 200, {
      ok: true,
      path: input.webhookPath,
      source: input.source,
      accountId: input.accountId,
    })
    return
  }

  if (method !== 'POST') {
    respondJson(input.response, 405, {
      ok: false,
      error: 'Method not allowed.',
    })
    return
  }

  const rawBody = await readRequestBody(input.request)
  if (input.webhookSecret) {
    const timestamp = normalizeHeaderValue(input.request.headers['x-webhook-timestamp'])
    const signature = normalizeHeaderValue(input.request.headers['x-webhook-signature'])
    if (!timestamp || !signature) {
      respondJson(input.response, 401, {
        ok: false,
        error: 'Missing Linq webhook signature headers.',
      })
      return
    }

    if (!verifyLinqWebhookSignature(input.webhookSecret, rawBody, timestamp, signature)) {
      respondJson(input.response, 401, {
        ok: false,
        error: 'Invalid Linq webhook signature.',
      })
      return
    }
  }

  const payload = parseLinqWebhookEvent(rawBody)
  if (payload.event_type !== 'message.received') {
    respondJson(input.response, 202, {
      ok: true,
      ignored: true,
      eventType: payload.event_type,
    })
    return
  }

  const capture = await normalizeLinqWebhookEvent({
    event: payload,
    source: input.source,
    defaultAccountId: input.accountId,
    downloadDriver: input.downloadDriver,
  })
  await input.emit(capture)
  respondJson(input.response, 202, {
    ok: true,
    accepted: true,
    externalId: capture.externalId,
  })
}

function parseLinqWebhookEvent(rawBody: string): LinqWebhookEvent {
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch (error) {
    throw new Error(
      `Linq webhook payload must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Linq webhook payload must be an object.')
  }

  const record = payload as Record<string, unknown>
  const apiVersion = normalizeRequiredString(record.api_version, 'Linq webhook api_version')
  const eventId = normalizeRequiredString(record.event_id, 'Linq webhook event_id')
  const createdAt = normalizeRequiredString(record.created_at, 'Linq webhook created_at')
  const eventType = normalizeRequiredString(record.event_type, 'Linq webhook event_type')

  return {
    api_version: apiVersion as LinqWebhookEvent['api_version'],
    event_id: eventId,
    created_at: createdAt,
    event_type: eventType,
    trace_id: normalizeNullableString(record.trace_id),
    partner_id: normalizeNullableString(record.partner_id),
    data: record.data,
  }
}

function verifyLinqWebhookSignature(
  secret: string,
  payload: string,
  timestamp: string,
  signature: string,
): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')
  const normalizedSignature = signature.replace(/^sha256=/iu, '').trim().toLowerCase()

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(normalizedSignature, 'hex'))
  } catch {
    return false
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function respondJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(body)}\n`)
}

function normalizeHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return normalizeNullableString(value[0])
  }

  return normalizeNullableString(value)
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new TypeError(`${label} is required.`)
  }

  return normalized
}

function normalizeWebhookPath(value: string): string {
  const normalized = normalizeRequiredString(value, 'Linq webhook path')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeWebhookPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new TypeError('Linq webhook port must be an integer between 1 and 65535.')
  }

  return value
}
