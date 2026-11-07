import { rm } from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import {
  getAssistantSession,
  resolveAssistantSession,
  runAssistantCodexResumeRetention,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { withAssistantTurnLock } from '../src/assistant/turn-lock.ts'
import { executeCodexAppServerTurn, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import * as requests from '../src/assistant-codex/app-server-requests.ts'
import { createDeferred, createTempVaultContext } from './test-helpers.ts'
import { prepareScriptedTurnScenario, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'

const roots: string[] = []
const now = new Date('2026-11-02T12:00:00.000Z')
const old = '2026-09-01T12:00:00.000Z'
const target = createAssistantModelTarget({ provider: 'codex-cli', model: 'gpt-6.1-sol' })
afterEach(async () => {
  vi.restoreAllMocks()
  await stopWarmCodexAppServer()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('cannot retire an in-flight turn and rechecks lastTurnAt after the turn completes', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-retention-turn-')
  roots.push(parentRoot)
  const created = await resolveAssistantSession({ vault: vaultRoot, target })
  const session = await saveAssistantSession(vaultRoot, {
    ...created.session, lastTurnAt: old,
    codexResume: { routeFingerprint: 'synthetic-route', threadId: 'synthetic-thread' },
  })
  const entered = createDeferred<void>()
  const finish = createDeferred<void>()
  const turn = withAssistantTurnLock({ vault: vaultRoot, run: async () => {
    entered.resolve()
    await finish.promise
    await saveAssistantSession(vaultRoot, { ...session, lastTurnAt: now.toISOString() })
  } })
  await entered.promise
  const controller = new AbortController()
  const interruptedRetention = runAssistantCodexResumeRetention({ vault: vaultRoot, now, signal: controller.signal })
  controller.abort()
  await expect(interruptedRetention).rejects.toMatchObject({ code: 'ASSISTANT_TURN_ABORTED' })
  expect((await getAssistantSession(vaultRoot, session.sessionId)).codexResume).toEqual(session.codexResume)
  const retention = runAssistantCodexResumeRetention({ vault: vaultRoot, now })
  finish.resolve()
  await Promise.all([turn, retention])
  const saved = await getAssistantSession(vaultRoot, session.sessionId)
  expect(saved.codexResume).toEqual(session.codexResume)
  expect(saved.lastTurnAt).toBe(now.toISOString())
})

it('starts a fresh native thread after retirement without a resume RPC or resume-failure diagnostic', async () => {
  const stub = await startScriptedResponsesStub()
  try {
    const scenario = await prepareScriptedTurnScenario(stub, roots)
    const vault = scenario.turnInput.workingDirectory
    const resolved = await resolveAssistantSession({ vault, target })
    stub.queue({ text: 'Initial synthetic reply.' })
    const original = await executeCodexAppServerTurn({ ...scenario.turnInput, dynamicTools: [], prompt: 'Say hello.' })
    await saveAssistantSession(vault, {
      ...resolved.session, lastTurnAt: old, turnCount: 1,
      codexResume: { routeFingerprint: 'synthetic-route', threadId: original.threadId! },
    })
    await stopWarmCodexAppServer()
    await runAssistantCodexResumeRetention({ vault, now })
    const resumed = await resolveAssistantSession({ vault, sessionId: resolved.session.sessionId })
    expect(resumed.session.codexResume).toBeNull()
    const resume = vi.spyOn(requests, 'buildCodexThreadResumeParams')
    const start = vi.spyOn(requests, 'buildCodexThreadStartParams')
    const traces: unknown[] = []
    stub.markRequestBaseline()
    stub.queue({ text: 'Fresh synthetic reply.' })
    const fresh = await executeCodexAppServerTurn({
      ...scenario.turnInput, dynamicTools: [], prompt: 'Say hello again.',
      resumeSessionId: resumed.session.codexResume?.threadId,
      onTraceEvent: event => traces.push(event),
    })
    expect(fresh.threadId).not.toBe(original.threadId)
    expect(fresh.finalMessage).toBe('Fresh synthetic reply.')
    expect(start).toHaveBeenCalledTimes(1)
    expect(resume).not.toHaveBeenCalled()
    expect(JSON.stringify(traces)).not.toContain('resume_failure')
    expect(stub.requestCountSinceBaseline()).toBe(1)
  } finally {
    await stopWarmCodexAppServer()
    await stub.close()
  }
}, 30_000)
