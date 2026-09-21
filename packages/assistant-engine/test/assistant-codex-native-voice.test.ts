import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { afterEach, expect, it, vi } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  executeCodexAppServerTurn,
  startCodexAppServerRealtime,
  stopWarmCodexAppServer,
  type CodexRealtimeInput,
} from '../src/assistant-codex.ts'
import {
  readCodexRpcResponseId,
  rejectPendingCodexRpcRequests,
  resolvePendingCodexRpcRequest,
  stopCodexAppServerChild,
  tryParseJsonLine,
  waitForCodexSpawn,
  withCodexRpcTimeout,
  writeCodexRpcMessage,
  type CodexRpcId,
  type CodexRpcMessage,
  type PendingCodexRpcRequest,
} from '../src/assistant-codex/app-server-rpc.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'

const temporaryPaths: string[] = []
// CI supplies the CLI extracted from the actual runner image. The published
// development package still uses the private wire contract until upstream lands it.
const publicLive = Boolean(process.env.MURPH_TEST_CODEX_COMMAND?.trim())
const createPath = publicLive ? '/v1/live/sessions' : '/v1/live'
const attachPath = publicLive ? '/v1/live/sessions/rtc_synthetic/attach' : '/v1/live/rtc_synthetic'
afterEach(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

// This pins the native protocol contract. The provider is synthetic; Codex owns
// voice transport; the patched host-managed input mode uses the normal turn APIs.
it.each(['native', 'host'] as const)('native V3 voice creates successive tool-backed turns on one thread (%s output)', { timeout: 60_000 }, async (outputOwner) => {
  const stub = await startScriptedResponsesStub()
  const requests: { path: string | undefined; multipart: boolean; nativeModel: boolean }[] = []
  const sidebandPaths: (string | undefined)[] = []
  const forwarded: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    requests.push({
      path: request.url,
      multipart: request.headers['content-type']?.startsWith('multipart/form-data') === true,
      nativeModel: body.includes('gpt-live-1-codex'),
    })
    if (request.method !== 'POST' || request.url !== createPath) {
      response.writeHead(404).end()
      return
    }
    if (publicLive) {
      expect(JSON.parse(body)).toMatchObject({
        session: { model: 'gpt-live-1' }, transport: { type: 'webrtc', sdp: 'v=0\r\ns=synthetic-offer\r\n' },
      })
      response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({
        session: { id: 'rtc_synthetic' }, transport: { type: 'webrtc', sdp: 'v=0\r\ns=synthetic-answer\r\n' },
      }))
      return
    }
    response.writeHead(201, {
      'content-type': 'application/sdp',
      location: '/v1/live/rtc_synthetic',
    }).end('v=0\r\ns=synthetic-answer\r\n')
  })
  const sockets = new WebSocketServer({ server })
  let sideband: WebSocket | undefined
  sockets.on('connection', (socket, request) => {
    sideband = socket
    sidebandPaths.push(request.url)
    socket.send(JSON.stringify({ type: 'session.started', session: { id: 'rtc_synthetic' } }))
    socket.on('message', (data) => {
      const event = readRecord(JSON.parse(String(data)))
      if (event) forwarded.push(event)
      if (publicLive && event?.type === 'session.close') {
        socket.send(JSON.stringify({
          type: 'session.closed', reason: 'close_requested',
          session: { id: 'rtc_synthetic' }, usage: { seconds: 12 },
        }))
      }
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Synthetic voice listener unavailable.')
  const baseUrl = `http://127.0.0.1:${address.port}/v1`
  const { turnInput } = await prepareScriptedTurnScenario(stub, temporaryPaths)
  const child = spawn(turnInput.codexCommand, [
    '-c', 'features.realtime_conversation=true',
    '-c', `experimental_realtime_ws_base_url="${baseUrl}"`,
    '-c', `experimental_realtime_webrtc_call_base_url="${baseUrl}"`,
    'app-server',
  ], {
    cwd: turnInput.workingDirectory,
    env: { ...turnInput.env, CODEX_HOME: turnInput.codexHome },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pendingRequests = new Map<CodexRpcId, PendingCodexRpcRequest>()
  const notifications: CodexRpcMessage[] = []
  const tools: Record<string, unknown>[] = []
  const methods: string[] = []
  const lines = createInterface({ input: child.stdout })
  child.stderr.resume()
  child.on('error', (error) => rejectPendingCodexRpcRequests(pendingRequests, error))
  child.on('exit', () => rejectPendingCodexRpcRequests(pendingRequests, new Error('Native voice process exited.')))
  lines.on('line', (line) => {
    const parsed = tryParseJsonLine(line)
    if (!parsed.ok) return
    const message = parsed.value
    const responseId = readCodexRpcResponseId(message)
    if (responseId !== null) {
      resolvePendingCodexRpcRequest({ message, responseId, pendingRequests })
      return
    }
    notifications.push(message)
    if (message.method === 'item/tool/call') {
      const params = readRecord(message.params)
      if (params) tools.push(params)
      writeCodexRpcMessage(child, {
        id: message.id,
        result: { contentItems: [{ type: 'inputText', text: 'Synthetic record verified.' }], success: true },
      })
    }
  })
  let nextId = 0
  async function request(method: string, params: Record<string, unknown>) {
    methods.push(method)
    const id = ++nextId
    return withCodexRpcTimeout(new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(id, { method, resolve, reject })
      writeCodexRpcMessage(child, { id, method, params })
    }), method === 'initialize' ? 30_000 : 10_000, method, () => pendingRequests.delete(id))
  }
  const events = (method: string) => notifications.filter((message) => message.method === method)
  try {
    await waitForCodexSpawn(child)
    await request('initialize', {
      clientInfo: { name: 'native_voice_test', version: '1' },
      capabilities: { experimentalApi: true },
    })
    writeCodexRpcMessage(child, { method: 'initialized', params: {} })
    const started = readRecord(await request('thread/start', {
      model: turnInput.model,
      cwd: turnInput.workingDirectory,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      dynamicTools: [{
        name: 'read_probe',
        description: 'Read a synthetic record.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }],
    }))
    const threadId = readRecord(started?.thread)?.id
    expect(threadId).toEqual(expect.any(String))
    await request('thread/realtime/start', {
      threadId,
      version: 'v3',
      clientManagedHandoffs: outputOwner === 'host',
      ...(publicLive ? { clientManagedInputs: true } : {}),
      codexResponseHandoffMode: 'bemTags',
      outputModality: 'audio',
      includeStartupContext: false,
      prompt: 'Use the synthetic lookup tool when asked for the synthetic record.',
      transport: { type: 'webrtc', sdp: 'v=0\r\ns=synthetic-offer\r\n' },
    })
    await vi.waitFor(() => expect(events('thread/realtime/sdp')).toHaveLength(1))
    expect(events('thread/realtime/sdp')[0]?.params).toMatchObject({ sdp: 'v=0\r\ns=synthetic-answer\r\n' })
    for (let index = 1; index <= 2; index += 1) {
      stub.queue(
        { functionCall: { name: 'read_probe', arguments: {} } },
        { text: 'Synthetic lookup complete.', requestIncludes: ['Synthetic record verified.'] },
      )
      expect(sideband).toBeDefined()
      if (publicLive) sideband!.send(JSON.stringify({
        type: 'session.input_transcript.delta', delta: 'Read the synthetic record.',
        start_ms: index * 100, end_ms: index * 100 + 50,
      }))
      sideband!.send(JSON.stringify(publicLive ? {
        type: 'session.delegation.created', offset_ms: index * 100 + 50,
        delegation: { id: `delegation_${index}`, type: 'delegation', target: 'client' },
      } : {
        type: 'delegation.created',
        item: {
          id: `delegation_${index}`,
          type: 'delegation',
          target: 'client',
          content: [{ type: 'input_text', text: 'Read the synthetic record.' }],
        },
      }))
      if (publicLive) {
        const inputs = () => events('thread/realtime/itemAdded')
          .map((event) => readRecord(readRecord(event.params)?.item))
          .filter((item) => item?.type === 'input.requested')
        await vi.waitFor(() => expect(inputs()).toHaveLength(index))
        const input = inputs()[index - 1]!
        expect(input.text).toContain('Read the synthetic record.')
        expect(input.inputId).toEqual(expect.any(String))
        expect(stub.requestCountSinceBaseline()).toBe((index - 1) * 2)
        expect(tools).toHaveLength(index - 1)
        // The existing host turn path can add context and bind tools before
        // starting backing work. Native voice owns normalization and transport.
        await request('turn/start', {
          threadId,
          input: [{ type: 'text', text: input.text }],
          serviceTier: null,
        })
      }
      await vi.waitFor(() => expect(events('turn/completed')).toHaveLength(index), { timeout: 10_000 })
      expect(events('turn/completed')[index - 1]?.params).toMatchObject({
        threadId, turn: { status: 'completed' },
      })
      if (outputOwner === 'host') {
        await request(publicLive ? 'thread/realtime/appendSpeech' : 'thread/realtime/appendText', {
          threadId,
          ...(publicLive ? {} : { role: 'assistant' }),
          text: 'Verified synthetic lookup complete.',
        })
      }
    }
    const outputMethod = publicLive ? 'session.commentary.append'
      : outputOwner === 'host' ? 'session.context.append' : 'delegation.context.append'
    await vi.waitFor(() => expect(forwarded.filter((event) => event.type === outputMethod)).toHaveLength(2))
    if (publicLive) {
      expect(forwarded.filter((event) => event.type === outputMethod)).toEqual(
        [1, 2].map((index) => expect.objectContaining({
          type: outputMethod,
          content: outputOwner === 'host' ? 'Verified synthetic lookup complete.' : 'Synthetic lookup complete.',
          ...(outputOwner === 'native' ? { delegation_id: `delegation_${index}` } : {}),
        })),
      )
    } else if (outputOwner === 'host') {
      expect(forwarded.filter((event) => event.type === 'delegation.context.append')).toEqual([])
      expect(forwarded.filter((event) => event.type === outputMethod)).toEqual([
        { type: outputMethod, content: [{ type: 'input_text', text: 'Verified synthetic lookup complete.' }] },
        { type: outputMethod, content: [{ type: 'input_text', text: 'Verified synthetic lookup complete.' }] },
      ])
    } else {
      expect(forwarded.filter((event) => event.type === outputMethod)).toEqual([
        expect.objectContaining({
          delegation_item_id: 'delegation_1',
          channel: 'speakable',
          content: [{ type: 'input_text', text: 'Synthetic lookup complete.' }],
        }),
        expect.objectContaining({
          delegation_item_id: 'delegation_2',
          channel: 'speakable',
          content: [{ type: 'input_text', text: 'Synthetic lookup complete.' }],
        }),
      ])
    }
    expect(tools).toHaveLength(2)
    expect(tools.every((call) => call.threadId === threadId && call.tool === 'read_probe')).toBe(true)
    expect(new Set(tools.map((call) => call.turnId)).size).toBe(2)
    expect(methods.filter((method) => method === 'turn/start')).toHaveLength(publicLive ? 2 : 0)
    expect(stub.requestCountSinceBaseline()).toBe(4)
    expect(requests).toEqual([{ path: createPath, multipart: !publicLive, nativeModel: !publicLive }])
    expect(sidebandPaths).toEqual([attachPath])
    expect(events('thread/realtime/error')).toHaveLength(0)
    await request('thread/realtime/stop', { threadId })
    await vi.waitFor(() => expect(events('thread/realtime/closed')).toHaveLength(1))
    if (publicLive) {
      expect(events('thread/realtime/itemAdded').map((event) => readRecord(event.params)?.item)).toContainEqual({
        type: 'session.closed', reason: 'close_requested',
        session: { id: 'rtc_synthetic' }, usage: { seconds: 12 },
      })
      expect(forwarded.filter((event) => event.type === 'session.close')).toHaveLength(1)
      expect(events('thread/realtime/error')).toHaveLength(0)
    }
  } finally {
    await stopCodexAppServerChild({ child, closeStdin: () => { child.stdin.end(); return null } })
    lines.close()
    for (const socket of sockets.clients) socket.terminate()
    await new Promise<void>((resolve) => sockets.close(() => resolve()))
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stub.close()
  }
})

it.skipIf(!publicLive)('keeps native media on the resident process across ordinary host turns and closes it before process shutdown', { timeout: 60_000 }, async () => {
  const stub = await startScriptedResponsesStub()
  const inputs: CodexRealtimeInput[] = []
  const usage: number[] = []
  const forwarded: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the synthetic offer. */ }
    response.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({
      session: { id: 'rtc_resident' }, transport: { type: 'webrtc', sdp: 'v=0\r\ns=resident-answer\r\n' },
    }))
  })
  const sockets = new WebSocketServer({ server })
  let sideband: WebSocket | undefined
  sockets.on('connection', (socket) => {
    sideband = socket
    socket.send(JSON.stringify({ type: 'session.started', session: { id: 'rtc_resident' } }))
    socket.on('message', (data) => {
      const event = readRecord(JSON.parse(String(data)))
      if (event) forwarded.push(event)
      if (event?.type === 'session.close') socket.send(JSON.stringify({
        type: 'session.closed', reason: 'close_requested',
        session: { id: 'rtc_resident' }, usage: { seconds: 15 },
      }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Synthetic voice listener unavailable.')
  const { turnInput } = await prepareScriptedTurnScenario(stub, temporaryPaths)
  const launch = {
    ...turnInput,
    configOverrides: [
      `experimental_realtime_ws_base_url="http://127.0.0.1:${address.port}/v1"`,
      `experimental_realtime_webrtc_call_base_url="http://127.0.0.1:${address.port}/v1"`,
    ],
  }
  try {
    const voice = await startCodexAppServerRealtime({
      ...launch,
      sessionId: 'synthetic-resident-call',
      sdp: 'v=0\r\ns=resident-offer\r\n',
      prompt: 'Delegate requests to the host.',
      onInput: (input) => inputs.push(input),
      onUsage: (seconds) => usage.push(seconds),
    })
    expect(voice.sdp).toContain('resident-answer')
    await vi.waitFor(() => expect(sideband).toBeDefined())
    let threadId: string | null = null
    for (let index = 1; index <= 2; index += 1) {
      sideband!.send(JSON.stringify({
        type: 'session.input_transcript.delta', delta: `Synthetic request ${index}.`,
        start_ms: index * 100, end_ms: index * 100 + 50,
      }))
      sideband!.send(JSON.stringify({
        type: 'session.delegation.created', offset_ms: index * 100 + 50,
        delegation: { id: `resident_${index}`, type: 'delegation', target: 'client' },
      }))
      await vi.waitFor(() => expect(inputs).toHaveLength(index))
      expect(stub.requestCountSinceBaseline()).toBe(index - 1)
      stub.queue({
        text: `Selected answer ${index}.`,
        requestIncludes: ['Prepared host context', `Synthetic request ${index}.`],
        beforeRespond: async () => {
          sideband!.send(JSON.stringify({ type: 'session.output_transcript.delta', delta: 'synthetic-private-voice-fragment' }))
          sideband!.send(JSON.stringify({ type: 'session.usage.updated', usage: { seconds: index * 5 } }))
          await vi.waitFor(() => expect(usage).toContain(index * 5))
        },
      })
      const result = await executeCodexAppServerTurn({
        ...launch,
        dynamicTools: [],
        prompt: `Prepared host context\n${inputs[index - 1]!.text}`,
        resumeSessionId: threadId,
      })
      if (threadId) expect(result.threadId).toBe(threadId)
      threadId = result.threadId
      expect(threadId).toEqual(expect.any(String))
      const capturedMethods = result.stdout.split('\n').flatMap((line) => {
        const parsed = tryParseJsonLine(line)
        return parsed.ok && typeof parsed.value.method === 'string' ? [parsed.value.method] : []
      })
      expect(capturedMethods.filter((method) => method.startsWith('thread/realtime/'))).toEqual([])
      await voice.speak(result.finalMessage)
    }
    await vi.waitFor(() => expect(forwarded.filter((event) => event.type === 'session.commentary.append').map((event) => event.content))
      .toEqual(['Selected answer 1.', 'Selected answer 2.']))
    await stopWarmCodexAppServer('synthetic-voice-shutdown')
    expect(await voice.closed).toEqual({ providerConfirmed: true, providerSessionId: 'rtc_resident', seconds: 15 })
    expect(forwarded.filter((event) => event.type === 'session.close')).toHaveLength(1)
    await expect(voice.speak('Late result')).rejects.toThrow('closed')
  } finally {
    await stopWarmCodexAppServer()
    sockets.close()
    for (const socket of sockets.clients) socket.terminate()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stub.close()
  }
})
