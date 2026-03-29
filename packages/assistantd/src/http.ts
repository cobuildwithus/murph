import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { URL } from 'node:url'
import { isAssistantSessionNotFoundError } from 'murph'
import type { AssistantLocalService } from './service.js'

export interface CreateAssistantHttpServerInput {
  controlToken: string
  host: string
  port: number
  service: AssistantLocalService
}

export interface AssistantHttpServerHandle {
  address: {
    baseUrl: string
    host: string
    port: number
  }
  close(): Promise<void>
  server: Server
}

export async function startAssistantHttpServer(
  input: CreateAssistantHttpServerInput,
): Promise<AssistantHttpServerHandle> {
  const server = createServer(async (request, response) => {
    await handleAssistantRequest(request, response, input)
  })
  const address = await listenAssistantServer(server, input.host, input.port)

  return {
    address: {
      baseUrl: buildAssistantServerBaseUrl(address),
      host: address.address,
      port: address.port,
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
    server,
  }
}

async function handleAssistantRequest(
  request: IncomingMessage,
  response: ServerResponse,
  input: CreateAssistantHttpServerInput,
): Promise<void> {
  try {
    if (!isAuthorizedAssistantRequest(request, input.controlToken)) {
      sendJson(response, 401, { error: 'Unauthorized.' })
      return
    }

    const method = request.method?.toUpperCase() ?? 'GET'
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, await input.service.health())
      return
    }
    if (method === 'POST' && url.pathname === '/open-conversation') {
      sendJson(response, 200, await input.service.openConversation(await readJsonBody(request)))
      return
    }
    if (method === 'POST' && url.pathname === '/message') {
      sendJson(response, 200, await input.service.sendMessage(await readJsonBody(request)))
      return
    }
    if (method === 'POST' && url.pathname === '/session-options') {
      sendJson(response, 200, await input.service.updateSessionOptions(await readJsonBody(request)))
      return
    }
    if (method === 'GET' && url.pathname === '/status') {
      sendJson(response, 200, await input.service.getStatus())
      return
    }
    if (method === 'GET' && url.pathname === '/sessions') {
      sendJson(response, 200, await input.service.listSessions())
      return
    }
    if (method === 'GET' && url.pathname.startsWith('/sessions/')) {
      sendJson(
        response,
        200,
        await input.service.getSession(decodeURIComponent(url.pathname.replace(/^\/sessions\//u, ''))),
      )
      return
    }
    if (method === 'POST' && url.pathname === '/outbox/drain') {
      sendJson(response, 200, await input.service.drainOutbox(await readJsonBody(request)))
      return
    }
    if (method === 'POST' && url.pathname === '/automation/run-once') {
      sendJson(response, 200, await input.service.runAutomationOnce(await readJsonBody(request)))
      return
    }
    if (method === 'POST' && url.pathname === '/cron/process-due') {
      sendJson(response, 200, await input.service.processDueCron(await readJsonBody(request)))
      return
    }

    sendJson(response, 404, { error: 'Not found.' })
  } catch (error) {
    const statusCode =
      error instanceof SyntaxError
        ? 400
        : isAssistantSessionNotFoundError(error)
          ? 404
          : 500
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : 'Assistant daemon request failed.',
    })
  }
}

async function readJsonBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  return raw.length === 0 ? {} : JSON.parse(raw)
}

function isAuthorizedAssistantRequest(
  request: IncomingMessage,
  expectedToken: string,
): boolean {
  const header = request.headers.authorization
  if (typeof header !== 'string') {
    return false
  }
  const matched = header.match(/^bearer\s+(.+)$/iu)
  if (!matched?.[1]) {
    return false
  }

  const provided = Buffer.from(matched[1], 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function buildAssistantServerBaseUrl(address: AddressInfo): string {
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
  return `http://${host}:${address.port}`
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
}

async function listenAssistantServer(
  server: Server,
  host: string,
  port: number,
): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('assistantd did not expose a TCP listener address.')
  }
  return address
}
