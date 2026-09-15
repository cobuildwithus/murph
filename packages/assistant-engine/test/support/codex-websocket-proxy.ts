import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'

/** Local fault injection at the provider wire; the real binary owns recovery. */
export async function startCodexWebSocketProxy(httpBaseUrl: string, responseStartTimeoutMs?: number) {
  let mode: 'healthy' | 'silent' | 'acknowledged-silent' | 'close' = 'healthy'
  let httpRequests = 0
  let websocketRequests = 0
  let connections = 0
  let stalledAt: number | null = null
  let fallbackAt: number | null = null
  let clientPings = 0
  let providerPongs = 0
  const requestTurnCorrelations: number[] = []
  let closing = false
  const upstreamAbort = new AbortController()
  const proxyErrors: unknown[] = []
  const sockets = new Set<WebSocket>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end()
      return
    }
    try {
      httpRequests += 1
      fallbackAt = Date.now()
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const upstream = await fetch(`${httpBaseUrl}/responses`, {
        method: 'POST', body, signal: upstreamAbort.signal, headers: { 'content-type': 'application/json' },
      })
      response.writeHead(upstream.status, { 'content-type': 'text/event-stream' })
      if (!upstream.body) throw new Error('Missing scripted HTTP response stream')
      for await (const chunk of upstream.body) response.write(chunk)
      response.end()
    } catch (error) {
      if (!closing) proxyErrors.push(error)
      response.destroy()
    }
  })
  const websocketServer = new WebSocketServer({ server })
  websocketServer.on('connection', (socket) => {
    connections += 1
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('ping', () => { clientPings += 1 })
    socket.on('pong', () => { providerPongs += 1 })
    socket.on('error', () => {})
    socket.on('message', async (data) => {
      try {
        const request = JSON.parse(data.toString())
        if (request.generate === false) {
          socket.send(JSON.stringify({ type: 'response.completed', response: {
            id: 'resp_prewarm', status: 'completed', output: [],
          } }))
          return
        }
        websocketRequests += 1
        const turnId = request.client_metadata?.turn_id
        if (typeof turnId === 'string') {
          requestTurnCorrelations.push(Number.parseInt(createHash('sha256').update(turnId).digest('hex').slice(0, 12), 16))
        }
        // Recovery design prototype, confined to this local test proxy. The first
        // upstream data frame cancels the timer; this does not prove model progress.
        let responseDeadline: ReturnType<typeof setTimeout> | undefined
        if (responseStartTimeoutMs !== undefined) {
          responseDeadline = setTimeout(() => {
            timers.delete(responseDeadline!)
            socket.close(1011, 'synthetic response start deadline')
          }, responseStartTimeoutMs)
          timers.add(responseDeadline)
        }
        const sendProviderFrame = (frame: string) => {
          if (responseDeadline) {
            clearTimeout(responseDeadline)
            timers.delete(responseDeadline)
            responseDeadline = undefined
          }
          if (socket.readyState === WebSocket.OPEN) socket.send(frame)
        }
        if (mode !== 'healthy') {
          stalledAt = Date.now()
          if (mode === 'acknowledged-silent') {
            sendProviderFrame(JSON.stringify({ type: 'response.created', response: {
              id: 'resp_synthetic_stall', status: 'in_progress', output: [],
            } }))
          }
          // The peer still responds to control frames while its model stream stalls.
          socket.ping('synthetic-health-check')
          if (mode === 'close') {
            const timer = setTimeout(() => {
              timers.delete(timer)
              socket.close(1011, 'synthetic upstream failure')
            }, 100)
            timers.add(timer)
          }
          return
        }
        const upstream = await fetch(`${httpBaseUrl}/responses`, {
          method: 'POST', body: JSON.stringify(request), signal: upstreamAbort.signal,
          headers: { 'content-type': 'application/json' },
        })
        if (!upstream.body) throw new Error('Missing scripted response stream')
        let buffer = ''
        const decoder = new TextDecoder()
        for await (const chunk of upstream.body) {
          buffer += decoder.decode(chunk, { stream: true })
          let end: number
          while ((end = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, end)
            buffer = buffer.slice(end + 1)
            if (line.startsWith('data: ') && line !== 'data: [DONE]') sendProviderFrame(line.slice(6))
          }
        }
      } catch (error) {
        if (!closing) proxyErrors.push(error)
        socket.close(1011, 'Synthetic proxy failure')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    setMode(value: typeof mode) { mode = value },
    measurements: () => ({
      httpRequests, websocketRequests, connections, clientPings, providerPongs, requestTurnCorrelations,
      recoveryMs: fallbackAt === null || stalledAt === null ? null : fallbackAt - stalledAt,
    }),
    async close() {
      closing = true
      upstreamAbort.abort()
      for (const timer of timers) clearTimeout(timer)
      for (const socket of sockets) socket.terminate()
      await new Promise<void>((resolve) => websocketServer.close(() => resolve()))
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
      if (proxyErrors.length) throw new AggregateError(proxyErrors, 'Synthetic proxy failed')
    },
  }
}
