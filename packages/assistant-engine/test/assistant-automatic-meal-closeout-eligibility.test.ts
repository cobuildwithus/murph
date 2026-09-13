import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { addMeal, initializeVault, removeAutomaticMealPhoto } from '@murphai/core'
import * as records from '@murphai/vault-usecases/records'
import { afterEach, expect, test, vi } from 'vitest'

import { canSkipManagedAutomaticMealCloseout } from '../src/assistant/automatic-meal-closeout-eligibility.js'
import { MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION as managed } from '../src/assistant/managed-automations.js'
import { createTempVaultContext } from './test-helpers.js'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup() {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-meal-closeout-gate-')
  roots.push(parentRoot)
  await initializeVault({ vaultRoot })
  return {
    automationId: managed.automationId,
    instructions: managed.instructions,
    occurrenceAt: '2099-07-24T01:00:00.000Z',
    timeZone: 'America/New_York',
    vaultRoot,
    parentRoot,
  }
}

async function addAutomaticPhoto(input: Awaited<ReturnType<typeof setup>>, occurredAt: string) {
  const photoPath = path.join(input.parentRoot, 'automatic-meal.jpg')
  await writeFile(photoPath, 'synthetic image bytes')
  return addMeal({
    vaultRoot: input.vaultRoot,
    occurredAt,
    source: 'device',
    photoPath,
    externalRef: { system: 'meal-photo-capture', resourceType: 'photo', resourceId: 'synthetic-capture', version: 'a'.repeat(64) },
  })
}

test('empty closeouts use one bounded occurrence-date query', async () => {
  const input = await setup()
  await addMeal({ vaultRoot: input.vaultRoot, occurredAt: '2099-07-23T12:00:00.000Z', source: 'manual', note: 'Synthetic manual meal' })
  const query = vi.spyOn(records, 'listAutomaticMealPhotoCloseoutWorkRecords')
  expect(await canSkipManagedAutomaticMealCloseout(input)).toBe(true)
  expect(query).toHaveBeenCalledExactlyOnceWith({
    limit: 1, occurrenceAt: input.occurrenceAt, to: '2099-07-23', vault: input.vaultRoot,
  })
})

test('historical retained photos remain eligible and same-occurrence removals survive retries', async () => {
  const input = await setup()
  const meal = await addAutomaticPhoto(input, '2099-07-20T12:00:00.000Z')
  expect(await canSkipManagedAutomaticMealCloseout(input)).toBe(false)
  await removeAutomaticMealPhoto({
    eventId: meal.event.id, vaultRoot: input.vaultRoot, now: new Date(input.occurrenceAt),
  })
  expect(await canSkipManagedAutomaticMealCloseout(input)).toBe(false)
  expect(await canSkipManagedAutomaticMealCloseout({ ...input, occurrenceAt: '2099-07-25T01:00:00.000Z' })).toBe(true)
})

test('a next-local-day capture does not start the previous day closeout', async () => {
  const input = await setup()
  await addAutomaticPhoto(input, '2099-07-24T12:00:00.000Z')
  expect(await canSkipManagedAutomaticMealCloseout(input)).toBe(true)
})

test('custom work and uncertain time context bypass the empty-work gate', async () => {
  const input = await setup()
  const query = vi.spyOn(records, 'listAutomaticMealPhotoCloseoutWorkRecords')
  for (const override of [
    { automationId: 'custom-closeout' },
    { instructions: managed.instructions + '\nAlso review another task.' },
    { timeZone: null },
    { timeZone: 'invalid-time-zone' },
    { occurrenceAt: 'not-an-instant' },
  ]) expect(await canSkipManagedAutomaticMealCloseout({ ...input, ...override })).toBe(false)
  expect(query).not.toHaveBeenCalled()
})

test('failed reads remain eligible and cancellation propagates', async () => {
  const input = await setup()
  const query = vi.spyOn(records, 'listAutomaticMealPhotoCloseoutWorkRecords').mockRejectedValue(new Error('Unavailable'))
  expect(await canSkipManagedAutomaticMealCloseout(input)).toBe(false)
  const controller = new AbortController()
  query.mockImplementation(async () => {
    controller.abort(new Error('Occurrence canceled'))
    throw new Error('Interrupted read')
  })
  await expect(canSkipManagedAutomaticMealCloseout({ ...input, signal: controller.signal })).rejects.toThrow('Occurrence canceled')
})
