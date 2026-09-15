import { rm } from 'node:fs/promises'
import { afterEach, expect, it } from 'vitest'
import { MURPH_SEND_PROGRESS_UPDATE_TOOL } from '../src/assistant-codex/dynamic-tool-catalog.ts'
import { executeCodexAppServerTurn, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'
import { startCodexWebSocketProxy } from './support/codex-websocket-proxy.ts'

const temporaryPaths: string[] = []
afterEach(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(temporaryPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

async function healthyWork(input: { idleMs: number; workMs: number; tool?: boolean }) {
  const stub = await startScriptedResponsesStub()
  const proxy = await startCodexWebSocketProxy(stub.baseUrl)
  const events: Record<string, unknown>[] = []
  let toolCalls = 0
  let toolElapsedMs: number | null = null
  let toolCompletedBeforeContinuation = false
  try {
    const scenario = await prepareScriptedTurnScenario({ ...stub, baseUrl: proxy.baseUrl }, temporaryPaths, {
      websocket: { streamIdleTimeoutMs: input.idleMs },
    })
    if (input.tool) {
      stub.queue({
        functionCall: {
          name: 'send_progress_update', namespace: 'murph',
          arguments: { text: 'Synthetic local tool wait.' },
        },
      }, {
        text: 'HEALTHY_TOOL_OK',
        beforeRespond: async () => { toolCompletedBeforeContinuation = toolElapsedMs !== null },
      })
    } else {
      // Both attempts are healthy and would finish after the same quiet work.
      // The second scripted response is consumed only if native retries.
      stub.queue(
        { text: 'HEALTHY_ORIGINAL_OK', delayAfterCreatedMs: input.workMs },
        { text: 'HEALTHY_REPLACEMENT_OK', delayAfterCreatedMs: input.workMs },
      )
    }
    const startedAt = Date.now()
    const run = executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: input.tool ? [MURPH_SEND_PROGRESS_UPDATE_TOOL] : [],
      providerRequestOrdinal: 1,
      progressDelivery: {
        async send() {
          toolCalls += 1
          const toolStartedAt = Date.now()
          // Local fixture callback only: no message or external request is sent.
          await new Promise((resolve) => setTimeout(resolve, input.workMs))
          toolElapsedMs = Date.now() - toolStartedAt
          return { kind: 'sent', source: 'model' }
        },
      },
      prompt: 'Complete the synthetic healthy-work fixture.',
      onTraceEvent(event) {
        const record = readRecord(event.rawEvent)
        if (record) events.push(record)
      },
    })
    const shouldTimeout = !input.tool && input.workMs > input.idleMs
    if (shouldTimeout) {
      await expect(run).rejects.toThrow(/idle timeout/i)
      expect(proxy.measurements()).toMatchObject({ websocketRequests: 1, httpRequests: 1 })
      expect(events).toContainEqual(expect.objectContaining({
        codexTransportFallbackActivated: true, codexTransportTimeoutPhase: 'websocket-read',
      }))
      expect(events.some((event) => event.codexTimingStage === 'provider-output-received')).toBe(false)
    } else {
      const result = await run
      expect(toolCalls).toBe(input.tool ? 1 : 0)
      if (input.tool) {
        expect(toolElapsedMs).toBeGreaterThanOrEqual(input.workMs - 10)
        expect(toolCompletedBeforeContinuation).toBe(true)
      }
      expect(result.finalMessage).toBe(input.tool ? 'HEALTHY_TOOL_OK' : 'HEALTHY_ORIGINAL_OK')
      const measurements = proxy.measurements()
      expect(measurements).toMatchObject({ websocketRequests: input.tool ? 2 : 1, httpRequests: 0 })
      const receipt = events.find((event) => event.codexTimingStage === 'provider-output-received')
      expect(receipt).toMatchObject({
        codexTimingReceiptKind: input.tool ? 'tool' : 'assistant',
        codexTimingTurnCorrelation: measurements.requestTurnCorrelations[0],
        codexTimingProviderRequestOrdinal: 1,
      })
      expect(events.filter((event) => event.codexTimingStage === 'provider-output-received')).toHaveLength(1)
      expect(events).toContainEqual(expect.objectContaining({
        codexTimingStage: 'turn-completed',
        codexTimingTurnCorrelation: measurements.requestTurnCorrelations[0],
        codexTimingFirstProviderReceiptElapsedMs: receipt?.codexTimingFirstProviderReceiptElapsedMs,
      }))
      if (!input.tool) expect(receipt?.codexTimingFirstProviderReceiptElapsedMs).toBeGreaterThanOrEqual(input.workMs)
    }
    process.stdout.write(`Synthetic idle safety ${JSON.stringify({
      ...input, outcome: shouldTimeout ? 'healthy-work-interrupted' : 'completed',
      elapsedMs: Date.now() - startedAt, toolCalls, toolElapsedMs, ...proxy.measurements(),
    })}\n`)
  } finally {
    await stopWarmCodexAppServer()
    await proxy.close()
    await stub.close()
  }
}

it('observes actual native receipt after a quiet healthy response without interrupting it', { timeout: 30_000 }, async () => {
  await healthyWork({ idleMs: 5_000, workMs: 1_200 })
})

it('shows a shorter idle timeout interrupts both healthy WebSocket and HTTP reasoning', { timeout: 30_000 }, async () => {
  await healthyWork({ idleMs: 1_000, workMs: 2_000 })
})

it('keeps an executed Murph tool alive beyond the response-stream idle timeout', { timeout: 30_000 }, async () => {
  await healthyWork({ idleMs: 1_000, workMs: 2_000, tool: true })
})

it.runIf(process.env.MURPH_RUN_CODEX_TIMEOUT_SAFETY === '1')(
  'compares healthy 22-second reasoning and executed Murph tool work with 20-second and 90-second idle settings',
  { timeout: 180_000 },
  async () => {
    await healthyWork({ idleMs: 90_000, workMs: 22_000 })
    await healthyWork({ idleMs: 20_000, workMs: 22_000 })
    await healthyWork({ idleMs: 20_000, workMs: 22_000, tool: true })
  },
)
