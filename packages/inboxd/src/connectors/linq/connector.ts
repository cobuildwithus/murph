import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { EmitCapture, PollConnector } from '../types.ts'
import { normalizeLinqWebhookEvent, type LinqAttachmentDownloadDriver } from './normalize.ts'
import {
  isLinqWebhookPayloadError,
  isLinqWebhookVerificationError,
  verifyAndParseLinqWebhookRequest,
} from './webhook.ts'

const DEFAULT_LINQ_WEBHOOK_HOST = '0.0.0.0'
const DEFAULT_LINQ_WEBHOOK_PATH = '/linq-webhook'
const DEFAULT_LINQ_WEBHOOK_PORT = 8789
const DEFAULT_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 250

export interface LinqWebhookConnectorOptions {
  id?: string
  source?: string
  accountId?: string | null
  host?: string
  path?: string
  port?: number
  webhookSecret: string
  downloadAttachments?: boolean
  attachmentDownloadTimeoutMs?: number | null
  fetchImplementation?: typeof globalThis.fetch
}

export function createLinqWebhookConnector({
  id,
  source = 'linq',
  accountId = null,
  host = DEFAULT_LINQ_WEBHOOK_HOST,
  path = DEFAULT_LINQ_WEBHOOK_PATH,
  port = DEFAULT_LINQ_WEBHOOK_PORT,
  webhookSecret,
  downloadAttachments = true,
  attachmentDownloadTimeoutMs = DEFAULT_LINQ_ATTACHMENT_DOWNLOAD_TIMEOUT_MS,
  fetchImplementation = globalThis.fetch?.bind(globalThis),
}: LinqWebhookConnectorOptions): PollConnector {
  const normalizedSource = normalizeRequiredString(source, 'Linq source')
  const normalizedAccountId = normalizeNullableString(accountId)
  const normalizedHost = normalizeRequiredString(host, 'Linq webhook host')
  const normalizedPath = normalizeWebhookPath(path)
  const normalizedPort = normalizeWebhookPort(port)
  const normalizedSecret = normalizeRequiredWebhookSecret(webhookSecret)
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
          attachmentDownloadTimeoutMs,
          signal,
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
  webhookSecret: string
  accountId: string | null
  source: string
  emit: EmitCapture
  downloadDriver: LinqAttachmentDownloadDriver | null
  attachmentDownloadTimeoutMs: number | null
  signal: AbortSignal
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
  let payload

  try {
    payload = verifyAndParseLinqWebhookRequest({
      headers: input.request.headers,
      rawBody,
      webhookSecret: input.webhookSecret,
    })
  } catch (error) {
    const normalizedMessage = error instanceof Error ? error.message : String(error)
    const statusCode = isLinqWebhookVerificationError(error)
      ? 401
      : isLinqWebhookPayloadError(error)
        ? 400
        : 500
    respondJson(input.response, statusCode, {
      ok: false,
      error: normalizedMessage,
    })
    return
  }
  if (payload.event_type !== 'message.received') {
    respondJson(input.response, 202, {
      ok: true,
      ignored: true,
      eventType: payload.event_type,
    })
    return
  }

  // Canonical message parsing and bounded best-effort attachment hydration still happen inline
  // before persistence. Failed or timed-out media downloads degrade to metadata-only attachments.
  let capture
  try {
    capture = await normalizeLinqWebhookEvent({
      event: payload,
      source: input.source,
      defaultAccountId: input.accountId,
      downloadDriver: input.downloadDriver,
      signal: input.signal,
      attachmentDownloadTimeoutMs: input.attachmentDownloadTimeoutMs,
    })
  } catch (error) {
    respondJson(input.response, error instanceof TypeError ? 400 : 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  await input.emit(capture)
  respondJson(input.response, 202, {
    ok: true,
    accepted: true,
    externalId: capture.externalId,
  })
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

function normalizeRequiredWebhookSecret(value: unknown): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new TypeError('Linq webhook secret is required.')
  }

  return normalized
}
