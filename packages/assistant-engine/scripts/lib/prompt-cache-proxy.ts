import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'

import { CacheReplayDiagnostics, object, type CacheReplayPolicy, type PreparedCacheRequest } from './prompt-cache-diagnostics.js'

const MAX_BYTES = 16 * 1024 * 1024

/** Isolated local experiment: fixed upstream, random capability, no raw logging. */
export async function startCacheReplayProxy(input: {
  apiKey: string
  diagnostics: CacheReplayDiagnostics
  policy: () => CacheReplayPolicy
  upstream?: string
}) {
  const upstream = input.upstream ?? 'https://api.openai.com/v1/responses'
  const token = randomBytes(32).toString('hex')
  const sockets = new Set<WebSocket>()
  const aborts = new Set<AbortController>()
  let closing = false
  const authorized = (request: IncomingMessage) =>
    !closing && request.url === '/v1/responses'
      && request.headers.authorization === `Bearer ${token}`

  const server = createServer(async (request, response) => {
    if (!authorized(request) || request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    const abort = new AbortController()
    let prepared: PreparedCacheRequest | undefined
    aborts.add(abort)
    response.on('close', () => abort.abort())
    try {
      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_BYTES) {
          response.writeHead(413).end()
          return
        }
        chunks.push(buffer)
      }
      prepared = input.diagnostics.prepare(JSON.parse(Buffer.concat(chunks).toString()), 'http', input.policy())
      const result = await fetch(upstream, {
        method: 'POST',
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(prepared.body),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180_000)]),
      })
      response.writeHead(result.status, { 'content-type': result.headers.get('content-type') ?? 'application/json' })
      if (!result.ok) prepared.complete({ status: 'failed' })
      if (!result.body) { response.end(); return }
      const decoder = new TextDecoder()
      let pending = ''
      const streaming = result.headers.get('content-type')?.includes('text/event-stream')
      for await (const chunk of result.body) {
        pending += decoder.decode(chunk, { stream: true })
        if (streaming) {
          let end: number
          while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end).trimEnd()
            pending = pending.slice(end + 1)
            if (line.startsWith('data: ')) {
              observe(line.slice(6), prepared.complete)
            }
          }
        }
        if (Buffer.byteLength(pending) > MAX_BYTES) throw new Error('cache_replay_response_too_large')
        if (!response.write(chunk)) await once(response, 'drain', { signal: abort.signal })
      }
      if (!streaming && result.ok) prepared.complete(JSON.parse(pending + decoder.decode()))
      response.end()
    } catch {
      prepared?.complete({ status: 'failed' })
      if (!response.headersSent) response.writeHead(502)
      response.end()
    } finally {
      aborts.delete(abort)
    }
  })
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES })
  server.on('upgrade', (request, socket, head) => {
    if (!authorized(request)) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return }
    wsServer.handleUpgrade(request, socket, head, (client) => {
      const remote = new WebSocket(upstream.replace(/^http/, 'ws'), {
        headers: { authorization: `Bearer ${input.apiKey}` },
        handshakeTimeout: 30_000,
        maxPayload: MAX_BYTES,
        perMessageDeflate: false,
      })
      sockets.add(client)
      sockets.add(remote)
      let complete: ((response: unknown) => void) | null = null
      let queued: string | null = null
      const stop = () => {
        complete?.({ status: 'failed' })
        complete = null
        for (const ws of [client, remote]) {
          sockets.delete(ws)
          ws.terminate()
        }
      }
      client.on('error', stop)
      remote.on('error', stop)
      client.on('close', stop)
      remote.on('close', stop)
      remote.on('open', () => { if (queued) { remote.send(queued); queued = null } })
      client.on('message', (data, binary) => {
        try {
          if (binary) { stop(); return }
          const message = object(JSON.parse(data.toString()))
          let body = data.toString()
          if (message.type === 'response.create') {
            if (complete) { stop(); return }
            const prepared = input.diagnostics.prepare(message, 'websocket', input.policy())
            body = JSON.stringify(prepared.body)
            complete = prepared.complete
          }
          if (remote.readyState === WebSocket.OPEN) {
            client.pause()
            remote.send(body, (error) => { if (error) stop(); else client.resume() })
          } else if (remote.readyState === WebSocket.CONNECTING && queued === null) {
            queued = body
          } else stop()
        } catch { stop() }
      })
      remote.on('message', (data, binary) => {
        if (!binary) observe(data.toString(), (response) => { complete?.(response); complete = null })
        remote.pause()
        client.send(data, { binary }, (error) => { if (error) stop(); else remote.resume() })
      })
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('cache_replay_listen_failed')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    token,
    async close() {
      closing = true
      for (const abort of aborts) abort.abort()
      for (const ws of sockets) ws.terminate()
      wsServer.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function observe(text: string, complete: (response: unknown) => void) {
  try {
    const event = object(JSON.parse(text))
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(String(event.type))) complete(event.response)
    if (event.type === 'error') complete({ status: 'failed' })
  } catch { /* Optional observation must not corrupt a forwarded provider frame. */ }
}
