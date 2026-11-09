import { expect, it } from 'vitest'
import { createAssistantRuntimeStateService } from '../src/assistant/runtime-state-service.ts'
import { fingerprintTranscriptEntry, readTranscriptBoundary } from '../src/assistant/transcript-bookmark.ts'
import {
  applyAssistantSessionCodexResumeStateAction,
  persistAssistantTurnAndSession,
} from '../src/assistant/turn-finalizer.ts'
import { buildCodexResumeState } from '@murphai/operator-config/assistant/codex-resume-state'
import type { ExecutedAssistantProviderTurnResult } from '../src/assistant/service-contracts.ts'
import { createAssistantSession, createSharedPlan, tempRoots } from './assistant-local-service-runtime.harness.ts'
import { createTempVaultContext } from './test-helpers.ts'

async function setup() {
  const { parentRoot, vaultRoot } = await createTempVaultContext('assistant-transcript-bookmark-')
  tempRoots.push(parentRoot)
  const session = createAssistantSession()
  const state = createAssistantRuntimeStateService(vaultRoot)
  await state.transcripts.append(session.sessionId, [
    { kind: 'user', text: 'I take two fish oil capsules a day.', createdAt: '2026-01-10T11:00:00.000Z' },
    { kind: 'assistant', text: 'Got it, two capsules a day.', createdAt: '2026-01-10T11:00:05.000Z' },
  ])
  const boundary = readTranscriptBoundary(await state.transcripts.list(session.sessionId))
  const providerResult = (transcriptBoundary: ExecutedAssistantProviderTurnResult['transcriptBoundary']): ExecutedAssistantProviderTurnResult => ({
    assistantContractFingerprint: 'a'.repeat(64),
    attemptCount: 1,
    codexContinuation: { kind: 'explicit-structured-history' },
    codexThreadId: 'thread-synthetic-bookmark',
    provider: 'codex-cli',
    providerOptions: session.providerOptions,
    rawEvents: [],
    response: 'Both messages answered.',
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
    transcriptBoundary,
    transcriptResponse: 'Both messages answered.',
    workingDirectory: vaultRoot,
  })
  const persist = (input: {
    ownTranscriptEntries?: Parameters<typeof persistAssistantTurnAndSession>[0]['ownTranscriptEntries']
    transcriptBoundary: ExecutedAssistantProviderTurnResult['transcriptBoundary']
  }) => persistAssistantTurnAndSession({
    input: { prompt: 'And magnesium?', vault: vaultRoot },
    ...(input.ownTranscriptEntries ? { ownTranscriptEntries: input.ownTranscriptEntries } : {}),
    plan: createSharedPlan(),
    providerResult: providerResult(input.transcriptBoundary),
    providerResumeStateAction: 'persist-from-provider-turn',
    session,
    turnCreatedAt: '2026-01-10T12:00:00.000Z',
    turnId: 'synthetic-bookmark-turn',
  })
  return { boundary, persist, session, state, vaultRoot }
}

it('advances the bookmark over member messages the turn saved while its thread ran', async () => {
  const { boundary, persist, session, state } = await setup()
  // A steered message is saved mid-turn, outside the finalizer.
  const steered = await state.transcripts.append(session.sessionId, [
    { kind: 'user', text: 'Also, magnesium at night?', createdAt: '2026-01-10T12:00:02.000Z' },
  ])

  const saved = await persist({ ownTranscriptEntries: steered, transcriptBoundary: boundary })

  const transcript = await state.transcripts.list(session.sessionId)
  expect(transcript.at(-1)).toMatchObject({ kind: 'assistant', text: 'Both messages answered.' })
  expect(saved.codexResume?.transcriptSeenThrough).toEqual(fingerprintTranscriptEntry(transcript.at(-1)!))
})

it('stops the bookmark at a message the turn did not write', async () => {
  const { boundary, persist, session, state } = await setup()
  // An imported self-authored Linq reply lands mid-turn, outside the turn lock.
  await state.transcripts.append(session.sessionId, [
    { kind: 'user', text: 'Can I swap the plank day?', createdAt: '2026-01-10T12:00:01.000Z' },
    { kind: 'assistant', text: 'Yes, swap it.', standaloneAssistantContext: true, createdAt: '2026-01-10T12:00:03.000Z' },
  ])

  const saved = await persist({ transcriptBoundary: boundary })

  expect(saved.codexResume?.threadId).toBe('thread-synthetic-bookmark')
  expect(saved.codexResume?.transcriptSeenThrough).toEqual(boundary)
})

it('saves no bookmark when the turn has no planning boundary, so the next turn rebuilds', async () => {
  const { persist } = await setup()

  const saved = await persist({ transcriptBoundary: undefined })

  expect(saved.codexResume?.threadId).toBe('thread-synthetic-bookmark')
  expect(saved.codexResume).not.toHaveProperty('transcriptSeenThrough')
})

// A provider turn that fails may never have shown Codex its history, so a
// failed save must not mark anything seen.
async function failedSave(input: {
  assistantTargetOverride?: Parameters<typeof applyAssistantSessionCodexResumeStateAction>[0]['assistantTargetOverride']
  codexThreadId: string
  routeFingerprint: string
}) {
  const { boundary, session, state, vaultRoot } = await setup()
  const durable = buildCodexResumeState({
    assistantContractFingerprint: 'a'.repeat(64),
    routeFingerprint: 'durable-route',
    threadId: 'thread-durable',
    transcriptSeenThrough: boundary,
  })
  // The game kickoff lands after the durable thread's bookmark.
  await state.transcripts.append(session.sessionId, [
    { kind: 'assistant', text: 'You and Zach are on for a plank. Want help keeping it going?', standaloneAssistantContext: true, createdAt: '2026-01-10T11:30:00.000Z' },
  ])
  const saved = await applyAssistantSessionCodexResumeStateAction({
    action: 'persist-from-provider-turn',
    assistantContractFingerprint: 'a'.repeat(64),
    ...(input.assistantTargetOverride ? { assistantTargetOverride: input.assistantTargetOverride } : {}),
    codexRolloutRelativePath: null,
    codexThreadId: input.codexThreadId,
    routeFingerprint: input.routeFingerprint,
    session: { ...session, codexResume: durable, resumeState: durable },
    vault: vaultRoot,
  })
  return { boundary, durable, saved }
}

it('keeps the bookmark when a failed turn reused the same thread', async () => {
  const { boundary, saved } = await failedSave({ codexThreadId: 'thread-durable', routeFingerprint: 'durable-route' })

  expect(saved.codexResume?.threadId).toBe('thread-durable')
  expect(saved.codexResume?.transcriptSeenThrough).toEqual(boundary)
})

it('saves no bookmark when a failed turn opened a new thread, so the next turn rebuilds', async () => {
  const { saved } = await failedSave({ codexThreadId: 'thread-new', routeFingerprint: 'durable-route' })

  expect(saved.codexResume?.threadId).toBe('thread-new')
  expect(saved.codexResume).not.toHaveProperty('transcriptSeenThrough')
})

it('keeps the durable binding when a failed turn ran on an override route', async () => {
  const { durable, saved } = await failedSave({
    assistantTargetOverride: { model: 'gpt-override' },
    codexThreadId: 'thread-override',
    routeFingerprint: 'override-route',
  })

  expect(saved.codexResume).toEqual(durable)
})
