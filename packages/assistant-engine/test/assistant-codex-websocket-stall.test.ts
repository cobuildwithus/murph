import { rm } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { executeCodexAppServerTurn, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'
import { startCodexWebSocketProxy } from './support/codex-websocket-proxy.ts'

const temporaryPaths: string[] = []
afterEach(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

async function reproduce(mode: 'silent' | 'acknowledged-silent' | 'close', idleMs: number, responseStartTimeoutMs?: number) {
  const nativeIdleExpected = mode !== 'close'
    && (responseStartTimeoutMs === undefined || mode === 'acknowledged-silent')
  const stub = await startScriptedResponsesStub()
  const proxy = await startCodexWebSocketProxy(stub.baseUrl, responseStartTimeoutMs)
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
      codexTransportIdleTimeout: nativeIdleExpected,
      codexTransportTimeoutPhase: nativeIdleExpected ? 'websocket-read' : null,
      codexTransportTransport: 'websocket',
    })
    expect(measurements.recoveryMs).not.toBeNull()
    if (nativeIdleExpected) {
      expect(measurements.recoveryMs!).toBeGreaterThanOrEqual(idleMs - 100)
      expect(measurements.recoveryMs!).toBeLessThan(idleMs + 5_000)
    }
    else if (responseStartTimeoutMs !== undefined) {
      expect(measurements.recoveryMs!).toBeGreaterThanOrEqual(responseStartTimeoutMs - 100)
      expect(measurements.recoveryMs!).toBeLessThan(responseStartTimeoutMs + 5_000)
    }
    else expect(measurements.recoveryMs!).toBeLessThan(5_000)
    const third = await executeCodexAppServerTurn({ ...turnInput, prompt: 'Complete the next synthetic turn.', resumeSessionId: second.sessionId })
    expect(third.finalMessage).toBe('NEXT_OK')
    expect(proxy.measurements()).toMatchObject({ connections: 1, websocketRequests: 2, httpRequests: 2 })
    process.stdout.write(`Synthetic Codex stall proof ${JSON.stringify({ mode, idleMs, responseStartTimeoutMs, ...measurements })}\n`)
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

it('prototypes a response-start deadline that activates native fallback before the 90 second idle timeout', { timeout: 30_000 }, async () => {
  await reproduce('silent', 90_000, 500)
})

it('keeps an acknowledged response alive when reasoning outlasts the response-start deadline', { timeout: 30_000 }, async () => {
  const stub = await startScriptedResponsesStub()
  const proxy = await startCodexWebSocketProxy(stub.baseUrl, 500)
  try {
    const scenario = await prepareScriptedTurnScenario({ ...stub, baseUrl: proxy.baseUrl }, temporaryPaths, {
      websocket: { streamIdleTimeoutMs: 90_000 },
    })
    stub.queue({ text: 'SLOW_HEALTHY_OK', delayAfterCreatedMs: 1_000 })
    const result = await executeCodexAppServerTurn({ ...scenario.turnInput, dynamicTools: [], prompt: 'Complete the synthetic healthy response.' })
    expect(result.finalMessage).toBe('SLOW_HEALTHY_OK')
    expect(proxy.measurements()).toMatchObject({ websocketRequests: 1, httpRequests: 0 })
  } finally {
    await stopWarmCodexAppServer()
    await proxy.close()
    await stub.close()
  }
})

it('still needs native idle recovery for a stall after acknowledgement', { timeout: 30_000 }, async () => {
  await reproduce('acknowledged-silent', 1_000, 500)
})

it.runIf(process.env.MURPH_RUN_CODEX_STALL_REPRO === '1')('reproduces the full 90 second native stall and compares five second recovery', { timeout: 150_000 }, async () => {
  await reproduce('silent', 90_000)
  await reproduce('silent', 5_000)
  await reproduce('silent', 90_000, 5_000)
})
