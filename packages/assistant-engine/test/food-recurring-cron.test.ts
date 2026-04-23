import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault, readFood, updateVaultSummary } from '@murphai/core'
import {
  addDailyFoodRecord,
  deleteFoodRecord,
  editFoodRecord,
  renameFoodRecord,
  upsertFoodRecord,
  buildDailyFoodCronJobId,
} from '@murphai/vault-usecases/records'
import { afterEach, test } from 'vitest'

import {
  addAssistantCronJob,
  createAssistantFoodAutoLogHooks,
  getAssistantCronJob,
  listAssistantCronJobs,
  removeAssistantCronJob,
  setAssistantCronJobEnabled,
  setAssistantCronJobTarget,
} from '../src/assistant-cron.ts'
import {
  readAssistantCronCanonicalRuntimeStore,
  removeAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from '../src/assistant/cron/runtime-state.ts'
import { readAssistantCronStore } from '../src/assistant/cron/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

test('editing a recurring food repairs missing canonical runtime state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-edit-recurring-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Morning Smoothie',
      slug: 'morning-smoothie',
      summary: 'Original summary.',
      autoLogDaily: {
        time: '08:00',
      },
    },
  })

  const originalJob = (await listAssistantCronJobs(vaultRoot))[0]
  assert.ok(originalJob)
  const paths = resolveAssistantStatePaths(vaultRoot)
  const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
  assert.equal(
    removeAssistantCronCanonicalRuntimeRecord(runtimeStore, originalJob.jobId),
    true,
  )
  await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)

  await editFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    lookup: created.lookupId,
    set: ['summary=Updated summary.'],
  })

  const repairedJobs = await listAssistantCronJobs(vaultRoot)
  assert.equal(repairedJobs.length, 1)
  assert.equal(repairedJobs[0]?.name, 'food-daily:morning-smoothie')
  assert.equal(repairedJobs[0]?.foodAutoLog?.foodId, created.foodId)
  assert.equal(repairedJobs[0]?.schedule.kind, 'dailyLocal')
  assert.equal(repairedJobs[0]?.schedule.localTime, '08:00')

  const repairedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
  assert.ok(
    repairedRuntimeStore.jobs.some((record) => record.jobId === originalJob.jobId),
  )
})

test('editing a recurring food after a vault timezone change retimes the derived cron job', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-retime-recurring-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({
    vaultRoot,
    timezone: 'Australia/Melbourne',
  })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Morning Smoothie',
      slug: 'morning-smoothie',
      summary: 'Original summary.',
      autoLogDaily: {
        time: '08:00',
      },
    },
  })

  const initialJob = (await listAssistantCronJobs(vaultRoot))[0]
  assert.ok(initialJob)
  const initialNextRunAt = initialJob.state.nextRunAt

  await updateVaultSummary({
    vaultRoot,
    timezone: 'America/New_York',
  })

  await editFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    lookup: created.lookupId,
    set: ['summary=Retimed after timezone change.'],
  })

  const retimedJob = (await listAssistantCronJobs(vaultRoot))[0]
  assert.ok(retimedJob)
  assert.equal(retimedJob?.name, 'food-daily:morning-smoothie')
  assert.equal(retimedJob?.schedule.kind, 'dailyLocal')
  assert.equal(retimedJob?.schedule.localTime, '08:00')
  assert.equal(retimedJob?.foodAutoLog?.foodId, created.foodId)
  assert.notEqual(retimedJob?.state.nextRunAt, initialNextRunAt)
})

test('editing an overdue recurring food preserves its pending occurrence when the schedule did not change', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-preserve-pending-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({
    vaultRoot,
    timezone: 'UTC',
  })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Morning Smoothie',
      slug: 'morning-smoothie',
      summary: 'Original summary.',
      autoLogDaily: {
        time: '08:00',
      },
    },
  })

  const jobId = buildDailyFoodCronJobId(created.foodId)
  const paths = resolveAssistantStatePaths(vaultRoot)
  const runtimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
  const runtimeRecord = runtimeStore.jobs.find((record) => record.jobId === jobId)
  assert.ok(runtimeRecord)
  runtimeRecord.state.activatedAt = '2026-04-08T07:00:00.000Z'
  runtimeRecord.state.pendingOccurrenceAt = '2026-04-08T08:00:00.000Z'
  runtimeRecord.updatedAt = '2026-04-08T07:00:00.000Z'
  await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)

  await editFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    lookup: created.lookupId,
    set: ['summary=Updated summary.'],
  })

  const updatedJob = await getAssistantCronJob(vaultRoot, jobId)
  assert.equal(updatedJob.state.nextRunAt, '2026-04-08T08:00:00.000Z')

  const updatedRuntimeStore = await readAssistantCronCanonicalRuntimeStore(paths)
  assert.equal(
    updatedRuntimeStore.jobs.find((record) => record.jobId === jobId)?.state
      .pendingOccurrenceAt,
    '2026-04-08T08:00:00.000Z',
  )
})

test('food schedule retimes an existing recurring food instead of refusing on stale saved state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-schedule-retime-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  await addDailyFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    title: 'Morning Protein Drink',
    time: '08:00',
  })

  const updated = await addDailyFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    title: 'Morning Protein Drink',
    time: '09:00',
  })

  const jobs = await listAssistantCronJobs(vaultRoot)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0]?.jobId, updated.jobId)
  assert.equal(jobs[0]?.schedule.kind, 'dailyLocal')
  assert.equal(jobs[0]?.schedule.localTime, '09:00')

  const food = await readFood({
    vaultRoot,
    foodId: updated.foodId,
  })
  assert.deepEqual(food.autoLogDaily, {
    time: '09:00',
  })
})

test('clearing recurring food auto-log removes the backing cron job', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-clear-recurring-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Daily Oats',
      slug: 'daily-oats',
      autoLogDaily: {
        time: '07:30',
      },
    },
  })

  assert.equal((await listAssistantCronJobs(vaultRoot)).length, 1)

  await editFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    lookup: created.lookupId,
    clear: ['autoLogDaily'],
  })

  const food = await readFood({
    vaultRoot,
    foodId: created.foodId,
  })
  assert.equal(food.autoLogDaily, undefined)
  assert.deepEqual(await listAssistantCronJobs(vaultRoot), [])
})

test('deleting a recurring food removes the backing cron job', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-delete-recurring-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Daily Oats',
      slug: 'daily-oats',
      autoLogDaily: {
        time: '07:30',
      },
    },
  })

  assert.equal((await listAssistantCronJobs(vaultRoot)).length, 1)

  const deleted = await deleteFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    lookup: created.lookupId,
  })

  assert.equal(deleted.deleted, true)
  assert.deepEqual(await listAssistantCronJobs(vaultRoot), [])
})

test('editing a recurring food collapses duplicate auto-log jobs back to one canonical job', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-dedupe-recurring-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Daily Oats',
      slug: 'daily-oats',
      autoLogDaily: {
        time: '07:30',
      },
    },
  })

  await addAssistantCronJob({
    vault: vaultRoot,
    name: 'food-daily:daily-oats-duplicate',
    prompt: 'Auto-log recurring food "Daily Oats" as a note-only meal.',
    schedule: {
      kind: 'dailyLocal',
      localTime: '07:30',
    },
    foodAutoLog: {
      foodId: created.foodId,
    },
  })

  const paths = resolveAssistantStatePaths(vaultRoot)
  const beforeEditStore = await readAssistantCronStore(paths)
  assert.equal(
    beforeEditStore.jobs.filter((job) => job.foodAutoLog?.foodId === created.foodId)
      .length,
    1,
  )
  assert.equal(
    (await listAssistantCronJobs(vaultRoot)).filter(
      (job) => job.foodAutoLog?.foodId === created.foodId,
    ).length,
    1,
  )

  await editFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    lookup: created.lookupId,
    set: ['summary=Normalized recurring food.'],
  })

  const jobs = (await listAssistantCronJobs(vaultRoot)).filter(
    (job) => job.foodAutoLog?.foodId === created.foodId,
  )
  const afterEditStore = await readAssistantCronStore(paths)
  assert.equal(
    afterEditStore.jobs.filter((job) => job.foodAutoLog?.foodId === created.foodId)
      .length,
    0,
  )
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0]?.name, 'food-daily:daily-oats')
  assert.equal(jobs[0]?.jobId, buildDailyFoodCronJobId(created.foodId))
})

test('canonical food lookups ignore hidden local duplicates and removal scrubs them', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-remove-dedupe-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Daily Oats',
      slug: 'daily-oats',
      autoLogDaily: {
        time: '07:30',
      },
    },
  })

  await addAssistantCronJob({
    vault: vaultRoot,
    name: 'food-daily:daily-oats',
    prompt: 'Auto-log recurring food "Daily Oats" as a note-only meal.',
    schedule: {
      kind: 'dailyLocal',
      localTime: '07:30',
    },
    foodAutoLog: {
      foodId: created.foodId,
    },
  })

  const resolved = await getAssistantCronJob(vaultRoot, 'food-daily:daily-oats')
  assert.equal(resolved.jobId, buildDailyFoodCronJobId(created.foodId))

  await removeAssistantCronJob(vaultRoot, 'food-daily:daily-oats')

  const food = await readFood({
    vaultRoot,
    foodId: created.foodId,
  })
  assert.equal(food.autoLogDaily, undefined)
  assert.deepEqual(await listAssistantCronJobs(vaultRoot), [])

  const paths = resolveAssistantStatePaths(vaultRoot)
  const store = await readAssistantCronStore(paths)
  assert.equal(
    store.jobs.filter((job) => job.foodAutoLog?.foodId === created.foodId).length,
    0,
  )
})

test('canonical food lookups stay visible while enable and target mutations still address hidden local duplicates', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-local-mutation-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Daily Oats',
      slug: 'daily-oats',
      autoLogDaily: {
        time: '07:30',
      },
    },
  })

  await addAssistantCronJob({
    vault: vaultRoot,
    name: 'food-daily:daily-oats',
    prompt: 'Auto-log recurring food "Daily Oats" as a note-only meal.',
    schedule: {
      kind: 'dailyLocal',
      localTime: '07:30',
    },
    foodAutoLog: {
      foodId: created.foodId,
    },
  })

  const updatedTarget = await setAssistantCronJobTarget({
    channel: 'telegram',
    deliveryTarget: 'room-1',
    job: 'food-daily:daily-oats',
    vault: vaultRoot,
  })
  assert.equal(updatedTarget.job.target.channel, 'telegram')

  const disabled = await setAssistantCronJobEnabled(
    vaultRoot,
    'food-daily:daily-oats',
    false,
  )
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.target.channel, 'telegram')

  const visibleJob = await getAssistantCronJob(vaultRoot, 'food-daily:daily-oats')
  assert.equal(visibleJob.jobId, buildDailyFoodCronJobId(created.foodId))
  assert.equal(visibleJob.enabled, true)
  assert.equal(visibleJob.target.channel, null)

  const hiddenLocalJob = (await readAssistantCronStore(
    resolveAssistantStatePaths(vaultRoot),
  )).jobs.find((job) => job.foodAutoLog?.foodId === created.foodId)
  assert.ok(hiddenLocalJob)
  assert.equal(hiddenLocalJob.enabled, false)
  assert.equal(hiddenLocalJob.target.channel, 'telegram')
  assert.equal(hiddenLocalJob.target.deliveryTarget, 'room-1')
})

test('food auto-log creation through addAssistantCronJob preserves create-time target metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-target-preserve-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Daily Oats',
      slug: 'daily-oats',
      autoLogDaily: {
        time: '07:30',
      },
    },
  })

  const job = await addAssistantCronJob({
    vault: vaultRoot,
    name: 'food-daily:daily-oats-targeted',
    prompt: 'Auto-log recurring food "Daily Oats" as a note-only meal.',
    schedule: {
      kind: 'dailyLocal',
      localTime: '07:30',
    },
    sessionId: 'session-food-target',
    alias: 'alias-food-target',
    channel: 'telegram',
    deliveryTarget: 'room-1',
    foodAutoLog: {
      foodId: created.foodId,
    },
  })

  assert.equal(job.target.sessionId, 'session-food-target')
  assert.equal(job.target.alias, 'alias-food-target')
  assert.equal(job.target.channel, 'telegram')
  assert.equal(job.target.deliveryTarget, 'room-1')

  const storedJob = (await readAssistantCronStore(resolveAssistantStatePaths(vaultRoot))).jobs
    .find((entry) => entry.jobId === job.jobId)
  assert.ok(storedJob)
  assert.equal(storedJob?.target.sessionId, 'session-food-target')
  assert.equal(storedJob?.target.alias, 'alias-food-target')
  assert.equal(storedJob?.target.channel, 'telegram')
  assert.equal(storedJob?.target.deliveryTarget, 'room-1')
})

test('renaming a recurring food refreshes the derived cron job metadata', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-rename-recurring-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
      status: 'active',
      title: 'Morning Smoothie',
      slug: 'morning-smoothie',
      autoLogDaily: {
        time: '08:15',
      },
    },
  })

  await renameFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    lookup: created.lookupId,
    title: 'Morning Protein Drink',
    slug: 'morning-protein-drink',
  })

  const jobs = await listAssistantCronJobs(vaultRoot)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0]?.name, 'food-daily:morning-protein-drink')
  assert.equal(
    jobs[0]?.prompt,
    'Auto-log recurring food "Morning Protein Drink" as a note-only meal.',
  )
  assert.equal(jobs[0]?.schedule.kind, 'dailyLocal')
  assert.equal(jobs[0]?.schedule.localTime, '08:15')
})
