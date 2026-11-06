import { afterEach, expect, it, vi } from 'vitest'
import * as runtimeState from '../src/assistant/runtime-state-service.ts'
import { persistAssistantTurnAndSession } from '../src/assistant/turn-finalizer.ts'
import type { ExecutedAssistantProviderTurnResult } from '../src/assistant/service-contracts.ts'
import { createAssistantSession, createSharedPlan, tempRoots } from './assistant-local-service-runtime.harness.ts'
import { createTempVaultContext } from './test-helpers.ts'

afterEach(() => { vi.restoreAllMocks() })

it.each([false, true])('attributes transcript and session writes without changing failure propagation (write fails: %s)', async (writeFails) => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('assistant-artifact-timing-')
  tempRoots.push(parentRoot)
  const session = createAssistantSession()
  const state = runtimeState.createAssistantRuntimeStateService(vaultRoot)
  vi.spyOn(runtimeState, 'createAssistantRuntimeStateService').mockReturnValue(state)
  let clock = 100
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const append = state.transcripts.append
  const save = state.sessions.save
  const failure = new Error('synthetic durable write failed')
  vi.spyOn(state.transcripts, 'append').mockImplementation(async (...args) => {
    clock += 20
    return append(...args)
  })
  vi.spyOn(state.sessions, 'save').mockImplementation(async (...args) => {
    clock += 30
    if (writeFails) throw failure
    return save(...args)
  })
  const onPersistenceTiming = vi.fn(() => { throw new Error('synthetic observer failure') })
  const providerResult: ExecutedAssistantProviderTurnResult = {
    assistantContractFingerprint: 'a'.repeat(64),
    attemptCount: 1,
    codexContinuation: { kind: 'explicit-structured-history' },
    codexThreadId: null,
    provider: 'codex-cli',
    providerOptions: session.providerOptions,
    rawEvents: [],
    response: 'synthetic persisted answer',
    responseDeliveryContextOrdinal: 0,
    route: {
      codexCommand: null,
      label: 'synthetic',
      provider: 'codex-cli',
      providerOptions: session.providerOptions,
      routeId: 'synthetic-route',
    },
    session,
    stderr: '',
    stdout: '',
    transcriptResponse: 'synthetic persisted answer',
    workingDirectory: vaultRoot,
  }
  const pending = persistAssistantTurnAndSession({
    input: { prompt: 'synthetic prompt', vault: vaultRoot },
    onPersistenceTiming,
    plan: createSharedPlan(),
    providerResult,
    providerResumeStateAction: 'preserve-existing',
    session,
    turnCreatedAt: '2026-01-10T12:00:00.000Z',
    turnId: 'synthetic-turn',
  })
  if (writeFails) {
    await expect(pending).rejects.toBe(failure)
    expect(onPersistenceTiming).not.toHaveBeenCalled()
  } else {
    await expect(pending).resolves.toMatchObject({ turnCount: session.turnCount + 1 })
    expect(onPersistenceTiming).toHaveBeenCalledExactlyOnceWith({
      turnTimingAssistantTranscriptMs: 20,
      turnTimingGeneratedImageMarkersMs: 0,
      turnTimingNoReplyMarkersMs: 0,
      turnTimingSessionPersistenceMs: 30,
    })
    await expect(state.sessions.get(session.sessionId)).resolves.toMatchObject({ turnCount: session.turnCount + 1 })
  }
  expect(state.transcripts.append).toHaveBeenCalledOnce()
  expect(state.sessions.save).toHaveBeenCalledOnce()
  await expect(state.transcripts.list(session.sessionId)).resolves.toEqual([
    expect.objectContaining({ kind: 'assistant', text: 'synthetic persisted answer' }),
  ])
})
