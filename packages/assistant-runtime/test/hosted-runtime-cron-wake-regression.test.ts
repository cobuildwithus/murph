import {
  createDueAssistantWorkspace,
  createPhaseInput,
  mocks,
  PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
  runHostedWorkspaceAssistantPhase,
} from './hosted-runtime-workspace-assistant-phase.harness.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initializeVault, upsertAutomation } from '@murphai/core'
import type { AutomationSchedule } from '@murphai/contracts'
import {
  completeAssistantOnboarding,
  getAssistantCronJob,
  listAssistantCronRuns,
  MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID,
  MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID,
  MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID,
  setAssistantCronJobEnabled,
} from '@murphai/assistant-engine'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const notification = vi.hoisted(() => vi.fn())
vi.mock('@murphai/assistant-engine/assistant-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@murphai/assistant-engine/assistant-service')>()),
  sendAssistantNotificationLocal: notification,
}))

afterEach(() => { vi.useRealTimers() })

it.each([
  { cadence: 'weekly', day: '2027-03-14', anchor: '2027-03-13T23:00:00.000Z', morning: '03:30', dueAt: '2027-03-14T12:30:00.000Z', runtimePresent: false },
  { cadence: 'weekly', day: '2027-11-07', anchor: '2027-11-06T23:00:00.000Z', morning: '02:30', dueAt: '2027-11-07T13:30:00.000Z', runtimePresent: true },
  { cadence: 'monthly', day: '2027-04-01', anchor: '2027-03-31T23:00:00.000Z', morning: '03:30', dueAt: '2027-04-01T21:00:00.000Z', runtimePresent: true },
])('keeps the $cadence hosted wake after another job fails then no-ops ($day)', async ({ cadence, day, anchor, morning, dueAt, runtimePresent }) => {
  // Only the notification/provider edge and unrelated hosted services are fake.
  // Canonical files, claims, finalization, run-loop and workspace wake selection are real.
  const engine = await vi.importActual<typeof import('@murphai/assistant-engine')>('@murphai/assistant-engine')
  const maintenance = await vi.importActual<typeof import('../src/hosted-runtime/maintenance.ts')>('../src/hosted-runtime/maintenance.ts')
  mocks.getAssistantCronStatus.mockImplementation(engine.getAssistantCronStatus)
  mocks.runHostedAssistantAutomationLane.mockImplementation((input) => maintenance.runHostedAssistantAutomationLane({
    ...input, assistantRuntimeState: PREPARED_HOSTED_ASSISTANT_RUNTIME_STATE,
  }))
  const root = await mkdtemp(path.join(tmpdir(), 'hosted-cron-wake-'))
  const vaultRoot = path.join(root, 'vault')
  const morningAt = `${day}T07:30:00.000Z`
  const timeZone = 'America/New_York'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(anchor))
  try {
    await initializeVault({ createdAt: anchor, vaultRoot, timezone: timeZone })
    const jobs: Array<{ automationId?: string; slug: string; schedule: AutomationSchedule; status?: 'paused' }> = [
      { slug: 'synthetic-morning', schedule: { kind: 'dailyLocal', localTime: morning, timeZone } },
      { automationId: MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID, slug: 'weekly-health-insight', schedule: { kind: 'cron', expression: '30 8 * * 0' } },
      { automationId: MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID, slug: 'monthly-improvement-coach', schedule: { kind: 'cron', expression: '0 17 1 * *', timeZone } },
      { automationId: MURPH_OVERNIGHT_MEMORY_CONSOLIDATION_AUTOMATION_ID, slug: 'overnight-memory-consolidation', schedule: { kind: 'cron', expression: '0 3 * * 1', timeZone } },
      { slug: 'synthetic-paused', schedule: { kind: 'dailyLocal', localTime: '04:00', timeZone }, status: 'paused' },
      { slug: 'synthetic-one-shot', schedule: { kind: 'at', at: new Date(Date.parse(anchor) + 3 * 86_400_000).toISOString() } },
      { slug: 'synthetic-interval', schedule: { kind: 'every', everyMs: 2 * 86_400_000 } },
    ]
    for (const job of jobs) {
      await upsertAutomation({
        ...job, continuityPolicy: 'fresh', instructions: `Run ${job.slug}.`,
        now: new Date(anchor), status: job.status ?? 'active', title: job.slug, vaultRoot,
        route: {
          channel: 'telegram', deliveryTarget: 'synthetic-chat', threadIsDirect: true,
          identityId: null, participantId: null, threadId: null,
        },
      })
    }
    const targetId = cadence === 'weekly' ? MURPH_WEEKLY_HEALTH_INSIGHT_AUTOMATION_ID : MURPH_MONTHLY_IMPROVEMENT_COACH_AUTOMATION_ID
    if (runtimePresent) await setAssistantCronJobEnabled(vaultRoot, targetId, true)
    const targetBefore = await getAssistantCronJob(vaultRoot, targetId)
    expect(targetBefore.state.nextRunAt).toBe(dueAt)
    notification.mockReset()
      .mockRejectedValueOnce(new VaultCliError('ASSISTANT_NOTIFICATION_ENQUEUE_FAILED', 'Synthetic enqueue failure.'))
      .mockResolvedValueOnce({ decision: { kind: 'skip', privateSummary: 'No update needed.' }, response: null, session: { sessionId: 'session-synthetic' } })
      .mockResolvedValue({
        decision: { kind: 'send_message', text: 'Synthetic scheduled update.', privateSummary: 'Update prepared.' },
        deliveryOutcome: { kind: 'sent' }, response: 'Synthetic scheduled update.', session: { sessionId: 'session-synthetic' },
      })
    const runAt = async (at: string) => {
      vi.setSystemTime(new Date(at))
      const input = createPhaseInput({
        importedCount: 0, now: () => at, operatorHomeRoot: path.join(root, 'operator'), vaultRoot,
        workspace: createDueAssistantWorkspace({ nextWakeAt: at }),
      })
      input.runtime.platform.effectsPort.assertExternalThreadRouteAuthority = async () => ({ threadIsDirect: true })
      return runHostedWorkspaceAssistantPhase(input)
    }
    const first = await runAt(morningAt)
    expect(first.nextWakeAt).toBe(`${day}T07:30:30.000Z`)
    const second = await runAt(`${day}T07:30:57.000Z`)
    expect((await listAssistantCronRuns({ job: 'synthetic-morning', vault: vaultRoot })).runs.map((run) => run.outcome))
      .toEqual(['no_op', 'failed'])
    expect(await getAssistantCronJob(vaultRoot, targetId)).toEqual(targetBefore)
    expect(second.nextWakeAt).toBe(dueAt)

    // Completion before the retained wake permits delivery; a still-open member
    // remains protected by the existing execution-time onboarding gate.
    await completeAssistantOnboarding({ reason: 'user_answered', vault: vaultRoot })
    await runAt(dueAt)
    const runs = await listAssistantCronRuns({ job: targetId, vault: vaultRoot })
    expect(runs.runs).toEqual([expect.objectContaining({ outcome: 'delivered', scheduledOccurrenceAt: dueAt })])
    expect(notification).toHaveBeenCalledTimes(3)
    expect((await getAssistantCronJob(vaultRoot, targetId)).state.lastSucceededAt).toBe(dueAt)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
