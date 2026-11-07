import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeVault, patchAutomation, showAutomation } from '@murphai/core'
import { getAssistantCronJob, listAssistantCronJobs } from '../src/assistant-cron.ts'
import { applyMurphManagedAutomations } from '../src/assistant/managed-automations.ts'
import { seedMurphOnboardingEarlyStallAutomation } from '../src/assistant/onboarding-followup-seed.ts'
import { completeAssistantOnboarding, reopenAssistantOnboarding, startAssistantOnboarding } from '../src/assistant/onboarding-state.ts'

const paths: string[] = []
const startedAt = '2026-09-24T12:00:00.000Z'
const now = new Date('2026-09-24T12:02:00.000Z')
const slug = 'onboarding-early-stall-check-in'
const route = {
  channel: 'telegram', deliveryTarget: 'synthetic-direct', identityId: null,
  participantId: null, threadId: 'synthetic-direct', threadIsDirect: true,
} as const

afterEach(async () => { await Promise.all(paths.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
async function fixture(start = true) {
  const vault = await mkdtemp(path.join(tmpdir(), 'onboarding-early-stall-'))
  paths.push(vault)
  await initializeVault({ vaultRoot: vault, timezone: 'America/New_York' })
  if (start) await startAssistantOnboarding({ vault, startedAt })
  return { vault, now, route }
}

describe('deterministic onboarding early stall enrollment', () => {
  it('uses the existing managed owner and projects a fixed canonical one-shot across replay', async () => {
    const input = await fixture()
    await applyMurphManagedAutomations({ vaultRoot: input.vault, now, defaultRoute: route })
    const saved = await showAutomation({ vaultRoot: input.vault, slug })
    expect(saved).toMatchObject({
      status: 'active', route,
      schedule: { kind: 'at', at: '2026-09-24T12:15:00.000Z' },
      activeUntil: '2026-09-24T12:30:00.000Z',
    })
    await applyMurphManagedAutomations({ vaultRoot: input.vault, now: new Date('2026-09-24T12:05:00.000Z'), defaultRoute: route })
    expect(await showAutomation({ vaultRoot: input.vault, slug })).toEqual(saved)
    const jobs = await listAssistantCronJobs(input.vault)
    expect(jobs.filter(job => job.jobId === saved?.automationId)).toHaveLength(1)
    expect((await getAssistantCronJob(input.vault, slug)).state.nextRunAt).toBe('2026-09-24T12:15:00.000Z')
  })

  it('uses the canonical create-only lock for concurrent enrollment', async () => {
    const input = await fixture()
    const results = await Promise.all([
      seedMurphOnboardingEarlyStallAutomation(input),
      seedMurphOnboardingEarlyStallAutomation({ ...input, now: new Date('2026-09-24T12:03:00.000Z') }),
    ])
    expect(results.sort()).toEqual(['created', 'skipped'])
    expect(await listAssistantCronJobs(input.vault)).toHaveLength(1)
  })

  it.each(['active', 'paused', 'archived'] as const)('preserves an existing %s one-shot including its instructions', async status => {
    const input = await fixture()
    await seedMurphOnboardingEarlyStallAutomation(input)
    await patchAutomation({ vaultRoot: input.vault, lookup: slug, status, instructions: 'Existing member-owned instructions.' })
    const before = await showAutomation({ vaultRoot: input.vault, slug })
    expect(await seedMurphOnboardingEarlyStallAutomation(input)).toBe('skipped')
    expect(await showAutomation({ vaultRoot: input.vault, slug })).toEqual(before)
  })

  it.each(['missing', 'completed', 'old', 'deadline', 'future', 'group', 'unknown-audience', 'yield'] as const)('does not enroll for %s', async scenario => {
    const input = await fixture(scenario !== 'missing')
    if (scenario === 'completed') await completeAssistantOnboarding({ vault: input.vault, completedAt: now.toISOString(), reason: 'user_answered' })
    await seedMurphOnboardingEarlyStallAutomation({
      ...input,
      now: new Date(scenario === 'old' ? '2026-09-25T12:00:00.000Z' : scenario === 'deadline' ? '2026-09-24T12:15:00.000Z' : scenario === 'future' ? '2026-09-24T11:59:00.000Z' : now),
      route: { ...route, threadIsDirect: scenario === 'group' ? false : scenario === 'unknown-audience' ? null : true },
      shouldYield: () => scenario === 'yield',
    })
    expect(await showAutomation({ vaultRoot: input.vault, slug })).toBeNull()
  })

  it('does not rearm old onboarding when reopened', async () => {
    const input = await fixture()
    await completeAssistantOnboarding({ vault: input.vault, completedAt: now.toISOString(), reason: 'user_answered' })
    await reopenAssistantOnboarding({ vault: input.vault, reopenedAt: '2026-09-25T12:00:00.000Z' })
    await seedMurphOnboardingEarlyStallAutomation({ ...input, now: new Date('2026-09-25T12:01:00.000Z') })
    expect(await showAutomation({ vaultRoot: input.vault, slug })).toBeNull()
  })
})
