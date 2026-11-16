import { createServer } from 'node:http'
import type { HostedCustomConnectionManifestEntry } from '@murphai/hosted-execution'

/** Fake Web gateway: no production Web code, remote provider or credentials. */
export async function startCustomConnectionsGateway() {
  const state = {
    connection: null as HostedCustomConnectionManifestEntry | null,
    schemaField: 'query',
    resultText: 'The saved note says to bring a blue notebook and a pencil.',
    calls: [] as Record<string, unknown>[],
    admittedRequests: 0,
  }
  const server = createServer(async (request, response) => {
    const entry = state.connection
    const expectedPath = entry ? `/v1/${entry.id}/${entry.generation}/${entry.catalog}/mcp` : null
    if (request.url !== expectedPath || request.method !== 'POST') {
      response.writeHead(404).end(); return
    }
    state.admittedRequests += 1
    let body = ''
    for await (const chunk of request) body += String(chunk)
    const message = JSON.parse(body)
    if (!('id' in message)) { response.writeHead(202).end(); return }
    let result: unknown
    if (message.method === 'initialize') result = {
      protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'Notes', version: '1' },
    }
    else if (message.method === 'tools/list') result = { tools: [{
      name: 'read_notes', description: 'Read the member’s saved notes about what to bring.',
      inputSchema: { type: 'object', properties: { [state.schemaField]: { type: 'string' } }, required: [state.schemaField] },
      annotations: { readOnlyHint: true },
    }] }
    else if (message.method === 'tools/call' && message.params?.name === 'read_notes') {
      state.calls.push(message.params.arguments)
      result = { content: [{ type: 'text', text: state.resultText }] }
    } else { response.writeHead(400).end(); return }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing synthetic server address')
  return {
    state,
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}
