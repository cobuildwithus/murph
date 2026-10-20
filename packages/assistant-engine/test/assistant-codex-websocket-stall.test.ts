import { rm } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { executeCodexAppServerTurn, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'
import { startCodexWebSocketProxy } from './support/codex-websocket-proxy.ts'

const temporaryPaths: string[] = []
// The deployed Codex patch fails a request after this much silence before the first provider frame.
const NATIVE_RESPONSE_ACKNOWLEDGEMENT_MS = 15_000
const deployedCodex = Boolean(process.env.MURPH_TEST_CODEX_COMMAND?.trim())
afterEach(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

async function reproduce(mode: 'silent' | 'acknowledged-silent' | 'partial-silent' | 'close', idleMs: number) {
  // Only a request that receives no provider frame can reach the deployed acknowledgement bound.
  const nativeAcknowledgementExpected = deployedCodex
    && mode === 'silent'
    && NATIVE_RESPONSE_ACKNOWLEDGEMENT_MS < idleMs
  const nativeIdleExpected = mode !== 'close' && !nativeAcknowledgementExpected
  const stub = await startScriptedResponsesStub()
  const proxy = await startCodexWebSocketProxy(stub.baseUrl)
  try {
    const scenario = await prepareScriptedTurnScenario({ ...stub, baseUrl: proxy.baseUrl }, temporaryPaths, {
      websocket: { streamIdleTimeoutMs: idleMs },
    })
    const turnInput = { ...scenario.turnInput, dynamicTools: [] }
    stub.queue({ text: 'WARM_OK' }, { text: 'RECOVERED_OK' }, { text: 'NEXT_OK' })
    const first = await executeCodexAppServerTurn({ ...turnInput, prompt: 'Warm the synthetic connection.' })
    expect(first.finalMessage).toBe('WARM_OK')
    expect(proxy.measurements()).toMatchObject({ connections: 1, websocketRequests: 1, httpRequests: 0 })
    proxy.setMode(mode)
    const events: Record<string, unknown>[] = []
    const second = await executeCodexAppServerTurn({
      ...turnInput, prompt: 'Recover the synthetic stalled turn.',
      resumeSessionId: first.sessionId,
      onTraceEvent: (event) => {
        const record = readRecord(event.rawEvent)
        if (record) events.push(record)
      },
    })
    expect(second.finalMessage).toBe('RECOVERED_OK')
    const measurements = proxy.measurements()
    expect(measurements).toMatchObject({ connections: 1, websocketRequests: 2, httpRequests: 1, clientPings: 0 })
    expect(measurements.providerPongs).toBeGreaterThan(0)
    const fallback = events.find((event) => event.codexTransportFallbackActivated === true)
    expect(fallback).toMatchObject({
      codexTransportWarmReused: true,
      codexTransportEventKind: 'transport-fallback',
      codexTransportIdleTimeout: mode !== 'close',
      codexTransportTimeoutPhase: nativeAcknowledgementExpected
        ? 'websocket-ack'
        : nativeIdleExpected ? 'websocket-read' : null,
      codexTransportTransport: 'websocket',
    })
    expect(measurements.recoveryMs).not.toBeNull()
    const expectedRecoveryMs = nativeAcknowledgementExpected
      ? NATIVE_RESPONSE_ACKNOWLEDGEMENT_MS
      : nativeIdleExpected ? idleMs : null
    if (expectedRecoveryMs === null) expect(measurements.recoveryMs!).toBeLessThan(5_000)
    else {
      expect(measurements.recoveryMs!).toBeGreaterThanOrEqual(expectedRecoveryMs - 100)
      expect(measurements.recoveryMs!).toBeLessThan(expectedRecoveryMs + 5_000)
    }
    const third = await executeCodexAppServerTurn({ ...turnInput, prompt: 'Complete the next synthetic turn.', resumeSessionId: second.sessionId })
    expect(third.finalMessage).toBe('NEXT_OK')
    expect(proxy.measurements()).toMatchObject({ connections: 1, websocketRequests: 2, httpRequests: 2 })
    process.stdout.write(`Synthetic Codex stall proof ${JSON.stringify({ mode, idleMs, deployedCodex, ...measurements })}\n`)
  } finally {
    await stopWarmCodexAppServer()
    await proxy.close()
    await stub.close()
  }
}

it('proves a warm silent WebSocket waits for native idle timeout then falls back once', { timeout: 30_000 }, async () => {
  await reproduce('silent', 1_000)
})

it('recovers explicit WebSocket failure quickly with the existing 90 second idle setting', { timeout: 30_000 }, async () => {
  await reproduce('close', 90_000)
})

it.runIf(deployedCodex)('recovers a silent reused WebSocket at the native acknowledgement deadline instead of the 90 second idle timeout', { timeout: 60_000 }, async () => {
  await reproduce('silent', 90_000)
})

it.runIf(deployedCodex)('keeps an acknowledged response on the WebSocket when it stays silent past the native acknowledgement deadline', { timeout: 60_000 }, async () => {
  const stub = await startScriptedResponsesStub()
  const proxy = await startCodexWebSocketProxy(stub.baseUrl)
  try {
    const scenario = await prepareScriptedTurnScenario({ ...stub, baseUrl: proxy.baseUrl }, temporaryPaths, {
      websocket: { streamIdleTimeoutMs: 90_000 },
    })
    stub.queue({ text: 'SLOW_ACKNOWLEDGED_OK', delayAfterCreatedMs: NATIVE_RESPONSE_ACKNOWLEDGEMENT_MS + 3_000 })
    const result = await executeCodexAppServerTurn({ ...scenario.turnInput, dynamicTools: [], prompt: 'Complete the synthetic slow acknowledged response.' })
    expect(result.finalMessage).toBe('SLOW_ACKNOWLEDGED_OK')
    expect(proxy.measurements()).toMatchObject({ websocketRequests: 1, httpRequests: 0 })
  } finally {
    await stopWarmCodexAppServer()
    await proxy.close()
    await stub.close()
  }
})

it('still needs native idle recovery for a stall after acknowledgement', { timeout: 30_000 }, async () => {
  await reproduce('acknowledged-silent', 1_000)
})

it('discards interrupted assistant text when native recovery completes the answer', { timeout: 30_000 }, async () => {
  await reproduce('partial-silent', 1_000)
})

async function steerUnfinishedWebSocketAnswer(interruptBehavior: 'discard' | 'ignore', holdMs: number) {
  const stub = await startScriptedResponsesStub()
  const proxy = await startCodexWebSocketProxy(stub.baseUrl)
  try {
    const scenario = await prepareScriptedTurnScenario({ ...stub, baseUrl: proxy.baseUrl }, temporaryPaths, {
      websocket: { streamIdleTimeoutMs: 90_000 },
    })
    proxy.setInterruptBehavior(interruptBehavior)
    let partialSent!: () => void
    const partial = new Promise<void>((resolve) => { partialSent = resolve })
    stub.queue(
      {
        partialText: { delta: 'STALE_UNFINISHED ', holdMs, onSent: () => partialSent() },
        text: 'STALE_UNFINISHED COMPLETE',
      },
      { requestIncludes: ['Use the corrected synthetic detail.'], text: 'STEERED_FINAL_OK' },
    )
    let steered: Promise<void> | null = null
    const startedAt = Date.now()
    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: [],
      onLiveTurn: (turn) => {
        steered = partial.then(() => turn.steer({ prompt: 'Use the corrected synthetic detail.' }))
        return () => {}
      },
      prompt: 'Answer the first synthetic message.',
    })
    await steered
    return { elapsedMs: Date.now() - startedAt, measurements: proxy.measurements(), result, stub }
  } finally {
    await stopWarmCodexAppServer()
    await proxy.close()
    await stub.close()
  }
}

it('asks a WebSocket provider to discard an unfinished answer when a steer arrives', { timeout: 30_000 }, async () => {
  const { elapsedMs, measurements, result, stub } = await steerUnfinishedWebSocketAnswer('discard', 25_000)
  expect(measurements).toMatchObject({
    httpRequests: 0,
    interruptModes: ['discard_partial_items'],
    websocketRequests: 2,
  })
  expect(stub.abortedResponseCountSinceBaseline()).toBe(1)
  expect(result.finalMessage).toBe('STEERED_FINAL_OK')
  expect(result.precedingAgentMessageSegments).toEqual([])
  expect(elapsedMs).toBeLessThan(15_000)
})

it('falls back to the queued steer result when a WebSocket provider ignores the interrupt', { timeout: 30_000 }, async () => {
  const { elapsedMs, measurements, result, stub } = await steerUnfinishedWebSocketAnswer('ignore', 3_000)
  expect(measurements).toMatchObject({
    httpRequests: 0,
    interruptModes: ['discard_partial_items'],
    websocketRequests: 2,
  })
  expect(stub.abortedResponseCountSinceBaseline()).toBe(0)
  expect(result.finalMessage).toBe('STEERED_FINAL_OK')
  expect(result.precedingAgentMessageSegments.map((segment) => segment.response))
    .toEqual(['STALE_UNFINISHED COMPLETE'])
  expect(elapsedMs).toBeGreaterThanOrEqual(3_000)
})
