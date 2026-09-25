import { createPhaseInput, mocks } from './hosted-runtime-workspace-assistant-phase.harness.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initializeVault, showAutomation, upsertAutomation, upsertEvent } from '@murphai/core'
import { completeAssistantOnboarding, MURPH_MANAGED_AUTOMATIONS } from '@murphai/assistant-engine'
import { processDueAssistantCronJobs } from '@murphai/assistant-engine/assistant-cron'
import { executeCodexAppServerTurn } from '@murphai/assistant-engine/assistant-codex'
import { runHostedWorkspaceAssistantPhase } from '../src/hosted-runtime/workspace-assistant-phase.ts'
import { drainHostedRuntimeLogWritesBestEffort } from '../src/hosted-runtime/runtime-logs.ts'

vi.mock('@murphai/assistant-engine/assistant-codex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@murphai/assistant-engine/assistant-codex')>()),
  executeCodexAppServerTurn: vi.fn(),
}))

afterEach(async () => {
  vi.useRealTimers()
  await drainHostedRuntimeLogWritesBestEffort()
})

it('binds the normal automation tool through hosted morning cron and real turn planning', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hosted-morning-tool-'))
  const vaultRoot = path.join(root, 'vault')
  const now = new Date('2026-11-10T08:00:00Z')
  const route = { channel: 'telegram', deliveryTarget: 'private-thread', threadId: 'private-thread',
    threadIsDirect: true, identityId: null, participantId: null }
  const connectedRequest = vi.fn(async () => ({ result: { accounts: [], toolkits: [] } }))
  let repairs = 0
  try {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    await initializeVault({ vaultRoot, timezone: 'UTC' })
    await completeAssistantOnboarding({ vault: vaultRoot, completedAt: '2026-11-09T08:00:00Z', reason: 'user_answered' })
    const event = await upsertEvent({ vaultRoot, payload: {
      kind: 'note', noteType: 'journal-plan', source: 'manual', title: 'Pool session',
      occurredAt: '2026-11-12T12:00:00+01:00', timeZone: 'Europe/Warsaw',
      note: 'Member moved the pool session from 18:00 to 12:00.',
      plan: { category: 'training', status: 'planned', endsAt: '2026-11-12T13:00:00+01:00', lastVerifiedAt: now.toISOString() },
    } })
    const reminder = (await upsertAutomation({ vaultRoot, title: 'Pack swim bag',
      instructions: 'Remind me to pack my bag one hour before the linked pool session.',
      schedule: { kind: 'at', at: '2026-11-12T16:00:00Z' }, route,
      status: 'active', continuityPolicy: 'fresh',
      contextReferences: [{ entityKind: 'event', entityId: event.eventId }],
      now: new Date('2026-11-09T08:00:00Z'),
    })).record
    const seed = MURPH_MANAGED_AUTOMATIONS.find(item => item.slug === 'journal-connected-context-morning')!
    await upsertAutomation({ ...seed, vaultRoot, route, status: 'active',
      now: new Date('2026-11-09T08:00:00Z') })

    vi.mocked(executeCodexAppServerTurn).mockImplementation(async input => {
      expect(input.dynamicTools?.some(tool => tool.name === 'automation')).toBe(true)
      const tool = input.hostedToolContext?.automationTool
      expect(tool).toBeTruthy()
      if (!tool) throw new Error('The hosted scheduler did not provide its automation tool.')
      const inspected = await tool.request({ action: 'inspect', lookup: reminder.automationId })
      if (inspected.action !== 'inspect') throw new Error('Expected automation inspection.')
      const desired = '2026-11-12T10:00:00.000Z'
      if (inspected.schedule.kind !== 'at' || inspected.schedule.at !== desired) {
        const repaired = await tool.request({ action: 'patch', lookup: reminder.automationId,
          expectedUpdatedAt: inspected.updatedAt, schedule: { kind: 'at', at: desired } })
        expect(repaired).toMatchObject({ action: 'patch', routeBinding: 'preserved',
          occurrenceProjection: { status: 'resolved', nextOccurrenceAt: desired } })
        repairs++
      }
      return {
        followUpRequest: null, acceptedNoReplyDeliveryContextOrdinals: [], additionalUsages: [],
        finalAction: null, finalActionExplicit: false,
        finalMessage: '{"kind":"skip","privateSummary":"Reminders reconciled."}',
        jsonEvents: [], precedingAgentMessageSegments: [], providerActionCount: 0,
        reactions: [], responseCard: null, responseDeliveryContextOrdinal: 0, responseMedia: [],
        rolloutRelativePath: null, runtimeIssueInputs: [], sessionId: 'scheduled-tool-session',
        stderr: '', stdout: '', targetInputId: null, threadId: 'scheduled-tool-session',
        transcriptMessage: '', turnId: 'scheduled-tool-turn',
      }
    })
    mocks.runHostedAssistantAutomationLane.mockImplementation(async input => {
      expect(input.executionContext.hosted?.automationTool).toBeUndefined()
      const result = await processDueAssistantCronJobs({
        vault: vaultRoot, executionContext: input.executionContext, limit: 1,
      })
      expect(result).toEqual({ failed: 0, processed: 1, succeeded: 1 })
      return { assistantAutomationProgressed: true,
        assistantAutomationCurrentTurnDeliveryIntentIds: [], nextWakeAt: null, redactedLogEntries: [] }
    })
    const phaseInput = createPhaseInput({ vaultRoot, operatorHomeRoot: path.join(root, 'home'),
      now: () => new Date().toISOString(), runtimeConnectedApps: { request: connectedRequest } })
    phaseInput.runtime.platform.effectsPort.assertExternalThreadRouteAuthority = vi.fn(async () => ({
      threadIsDirect: true,
    }))
    await runHostedWorkspaceAssistantPhase(phaseInput)
    expect(executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    const after = await showAutomation({ vaultRoot, automationId: reminder.automationId })
    expect(after?.schedule).toEqual({ kind: 'at', at: '2026-11-12T10:00:00.000Z' })
    expect(after?.route).toEqual(reminder.route)
    expect(repairs).toBe(1)
    vi.setSystemTime(new Date('2026-11-11T08:00:00Z'))
    await runHostedWorkspaceAssistantPhase(phaseInput)
    expect(executeCodexAppServerTurn).toHaveBeenCalledTimes(2)
    expect(repairs).toBe(1)
    expect(await showAutomation({ vaultRoot, automationId: reminder.automationId })).toEqual(after)
    expect(connectedRequest).not.toHaveBeenCalled()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
