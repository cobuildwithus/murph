import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addMeal, initializeVault, removeAutomaticMealPhoto } from '@murphai/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { canSkipManagedAutomaticMealCloseout } from '../src/assistant/automatic-meal-closeout-eligibility.js'
import { MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID } from '../src/assistant/managed-automations.js'

describe('automatic meal closeout eligibility', () => {
  let root: string
  let vaultRoot: string
  const occurrenceAt = '2030-05-09T01:00:00.000Z'
  const check = (overrides = {}) => canSkipManagedAutomaticMealCloseout({
    automationId: MURPH_AUTOMATIC_MEAL_CLOSEOUT_AUTOMATION_ID,
    occurrenceAt, timeZone: 'America/New_York', vaultRoot, ...overrides,
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-05-08T18:00:00.000Z'))
    root = await mkdtemp(path.join(tmpdir(), 'meal-closeout-eligibility-'))
    vaultRoot = path.join(root, 'vault')
    await initializeVault({ timezone: 'America/New_York', vaultRoot })
  })
  afterEach(async () => {
    vi.useRealTimers()
    await rm(root, { recursive: true, force: true })
  })

  async function capture(occurredAt = '2030-05-08T16:00:00.000Z') {
    const photoPath = path.join(root, 'meal.jpg')
    await writeFile(photoPath, 'synthetic meal photo')
    return addMeal({ vaultRoot, occurredAt, source: 'device', photoPath,
      externalRef: { system: 'meal-photo-capture', resourceType: 'photo', resourceId: 'synthetic-capture' },
    })
  }

  it('skips an empty vault and manual meals', async () => {
    expect(await check()).toBe(true)
    await addMeal({ vaultRoot, source: 'manual', occurredAt: '2030-05-08T16:00:00.000Z', note: 'Synthetic lunch' })
    expect(await check()).toBe(true)
  })

  it.each(['2030-05-08T16:00:00.000Z', '2030-05-09T00:30:00.000Z', '2030-05-02T16:00:00.000Z'])(
    'admits retained automatic photos from %s', async (at) => {
      await capture(at)
      expect(await check()).toBe(false)
    },
  )

  it('skips cleaned historical captures but retains same-occurrence retry evidence', async () => {
    const meal = await capture()
    await removeAutomaticMealPhoto({ vaultRoot, eventId: meal.event.id, now: new Date(occurrenceAt) })
    expect(await check()).toBe(false)
    expect(await check({ occurrenceAt: '2030-05-10T01:00:00.000Z' })).toBe(true)
  })

  it('uses the occurrence local date even when delayed past midnight', async () => {
    await capture('2030-05-09T04:30:00.000Z')
    vi.setSystemTime(new Date('2030-05-09T05:00:00.000Z'))
    expect(await check()).toBe(true)
    expect(await check({ occurrenceAt: '2030-05-10T01:00:00.000Z' })).toBe(false)
    expect(await check({ timeZone: null })).toBe(false)
  })

  it('does not read the queue for another automation', async () => {
    expect(await check({ automationId: 'aut_unrelated', vaultRoot: path.join(root, 'missing') })).toBe(false)
  })

  it('propagates cancellation and unreadable vault failures', async () => {
    await expect(check({ signal: AbortSignal.abort(new Error('cancelled')) })).rejects.toThrow('cancelled')
    const invalidVault = path.join(root, 'not-a-directory')
    await writeFile(invalidVault, 'invalid vault')
    await expect(check({ vaultRoot: invalidVault })).rejects.toThrow()
  })
})
