import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket, WebSocketServer } from 'ws'
import { expect, it } from 'vitest'
import { CacheReplayDiagnostics, object } from '../scripts/lib/prompt-cache-diagnostics.js'
import { startCacheReplayProxy } from '../scripts/lib/prompt-cache-proxy.js'

it('forwards HTTP and WebSocket completions and keeps the comparison across reconnects', async () => {
  const received: Record<string, unknown>[] = []
  const events: Record<string, unknown>[] = []
  const completion = (index: number) => ({ type: 'response.completed', response: {
    id: `resp_synthetic_${index}`, status: 'completed', output: [],
    usage: { input_tokens: 2000, output_tokens: 1, input_tokens_details: { cached_tokens: index === 1 ? 0 : 1900, cache_write_tokens: index === 1 ? 1997 : 97 } },
    prompt_cache_diagnostics: index === 1 ? null : { type: 'cache_hit' },
  } })
  const upstream = createServer(async (req, res) => {
    let text = ''
    for await (const chunk of req) text += String(chunk)
    received.push(object(JSON.parse(text)))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const data = `data: ${JSON.stringify(completion(received.length))}\r\n\r\n`
    res.write(data.slice(0, 17))
    res.end(data.slice(17))
  })
  const wsServer = new WebSocketServer({ server: upstream })
  wsServer.on('connection', (socket) => {
    socket.on('message', (data) => {
      received.push(object(JSON.parse(data.toString())))
      socket.send(JSON.stringify(completion(received.length)))
    })
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('test_listen_failed')
  const proxy = await startCacheReplayProxy({
    apiKey: 'synthetic-upstream-key', upstream: `http://127.0.0.1:${address.port}/v1/responses`,
    diagnostics: new CacheReplayDiagnostics((event) => events.push(event)),
    policy: () => ({ cohort: 'synthetic', key: 'preserve', breakpoint: 'none', mode: 'implicit' }),
  })
  try {
    expect((await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', body: '{}' })).status).toBe(404)
    expect(received).toHaveLength(0)
    const first = await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${proxy.token}` }, body: JSON.stringify({ model: 'gpt-5.6-terra', input: 'private synthetic prompt', stream: true }) })
    expect(await first.text()).toContain('response.completed')
    for (let index = 0; index < 2; index++) {
      const socket = new WebSocket(`${proxy.baseUrl.replace('http:', 'ws:')}/responses`, { headers: { authorization: `Bearer ${proxy.token}` } })
      await once(socket, 'open')
      const reply = once(socket, 'message')
      socket.send(JSON.stringify({ type: 'response.create', model: 'gpt-5.6-terra', input: 'private synthetic prompt' }))
      expect(JSON.parse(String((await reply)[0])).type).toBe('response.completed')
      socket.close()
      await once(socket, 'close')
    }
    expect(received.map((request) => object(request.prompt_cache_options).comparison_response_id)).toEqual([undefined, 'resp_synthetic_1', 'resp_synthetic_2'])
    expect(events.map((event) => event.transport)).toEqual(['http', 'websocket', 'websocket'])
    expect(events[2]).toMatchObject({ diagnosticType: 'cache_hit', inputTokens: 2000, cachedTokens: 1900 })
    expect(JSON.stringify(events)).not.toContain('private synthetic')
    expect(JSON.stringify(events)).not.toContain('resp_synthetic')
  } finally {
    await proxy.close()
    for (const socket of wsServer.clients) socket.terminate()
    wsServer.close()
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
})
