import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault, readFood } from '@murphai/core'
import {
  addDailyFoodRecord,
  deleteFoodRecord,
  editFoodRecord,
  renameFoodRecord,
  upsertFoodRecord,
} from '@murphai/vault-usecases/records'
import { afterEach, test } from 'vitest'

import {
  addAssistantCronJob,
  createAssistantFoodAutoLogHooks,
  listAssistantCronJobs,
  removeAssistantCronJob,
} from '../src/assistant-cron.ts'

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

test('editing a recurring food repairs a missing auto-log cron job', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'murph-food-edit-recurring-cron-'))
  const vaultRoot = path.join(parent, 'vault')
  cleanupPaths.push(parent)

  await initializeVault({ vaultRoot })

  const created = await upsertFoodRecord({
    vault: vaultRoot,
    hooks: createAssistantFoodAutoLogHooks(),
    payload: {
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
  await removeAssistantCronJob(vaultRoot, originalJob.jobId)
  assert.deepEqual(await listAssistantCronJobs(vaultRoot), [])

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
      timeZone: 'UTC',
    },
    foodAutoLog: {
      foodId: created.foodId,
    },
  })

  assert.equal(
    (await listAssistantCronJobs(vaultRoot)).filter(
      (job) => job.foodAutoLog?.foodId === created.foodId,
    ).length,
    2,
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
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0]?.name, 'food-daily:daily-oats')
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
