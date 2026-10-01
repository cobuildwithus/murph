import { describe, expect, it } from 'vitest'

import {
  createVersionedAutomationPatchFixture,
  type VersionedAutomationFixtureRecord,
} from './support/automation-live-fixture.ts'

const CURRENT_RECORD = {
  automationId: 'automation-evening-reminder',
  effectiveTimeZone: 'America/Chicago',
  lookupId: 'evening-reminder',
  occurrenceProjection: {
    nextOccurrenceAt: '2026-08-11T02:00:00.000Z',
    status: 'resolved',
  },
  schedule: {
    kind: 'dailyLocal',
    localTime: '21:00',
    timeZone: 'America/Chicago',
  },
  status: 'active',
  updatedAt: '2026-08-10T00:00:00.000Z',
} satisfies VersionedAutomationFixtureRecord

const PATCHED_RECORD = {
  ...CURRENT_RECORD,
  occurrenceProjection: {
    nextOccurrenceAt: '2026-08-11T03:00:00.000Z',
    status: 'resolved',
  },
  schedule: {
    kind: 'dailyLocal',
    localTime: '22:00',
    timeZone: 'America/Chicago',
  },
  updatedAt: '2026-08-10T00:01:00.000Z',
} satisfies VersionedAutomationFixtureRecord

describe('versioned automation live fixture', () => {
  it('accepts inspect followed by a version-matched patch', async () => {
    const fixture = createFixture()
    const inspected = await fixture.request({
      action: 'inspect',
      lookup: CURRENT_RECORD.lookupId,
    })
    expect(inspected).toMatchObject({
      action: 'inspect',
      automationId: CURRENT_RECORD.automationId,
      updatedAt: CURRENT_RECORD.updatedAt,
    })

    const patched = await fixture.request({
      action: 'patch',
      expectedUpdatedAt: CURRENT_RECORD.updatedAt,
      lookup: CURRENT_RECORD.automationId,
      schedule: { kind: 'dailyLocal', localTime: '22:00' },
    })
    expect(patched).toMatchObject({
      action: 'patch',
      automationId: CURRENT_RECORD.automationId,
      created: false,
      schedule: PATCHED_RECORD.schedule,
      updatedAt: PATCHED_RECORD.updatedAt,
    })
  })

  it('rejects blind, unauthorized, and stale-version writes', async () => {
    const blind = createFixture()
    await expect(blind.request({
      action: 'patch',
      expectedUpdatedAt: CURRENT_RECORD.updatedAt,
      lookup: CURRENT_RECORD.lookupId,
      status: 'paused',
    })).rejects.toThrow(/inspect .* before patching/iu)

    const unauthorized = createFixture()
    await unauthorized.request({
      action: 'inspect',
      lookup: CURRENT_RECORD.lookupId,
    })
    await expect(unauthorized.request({
      action: 'patch',
      expectedUpdatedAt: CURRENT_RECORD.updatedAt,
      lookup: 'another-reminder',
      status: 'paused',
    })).rejects.toThrow(/does not identify the fixture record/iu)

    const stale = createFixture()
    await stale.request({
      action: 'inspect',
      lookup: CURRENT_RECORD.lookupId,
    })
    await expect(stale.request({
      action: 'patch',
      expectedUpdatedAt: '2026-08-09T23:59:00.000Z',
      lookup: CURRENT_RECORD.lookupId,
      status: 'paused',
    })).rejects.toThrow(/inspected updatedAt/iu)
  })

  it('rejects a write after a concurrent version change', async () => {
    const fixture = createFixture()
    await fixture.request({
      action: 'inspect',
      lookup: CURRENT_RECORD.lookupId,
    })
    fixture.replaceCurrent({
      ...CURRENT_RECORD,
      updatedAt: '2026-08-10T00:00:30.000Z',
    })

    await expect(fixture.request({
      action: 'patch',
      expectedUpdatedAt: CURRENT_RECORD.updatedAt,
      lookup: CURRENT_RECORD.lookupId,
      status: 'paused',
    })).rejects.toThrow(/changed after inspection/iu)
  })
})

function createFixture() {
  return createVersionedAutomationPatchFixture({
    current: CURRENT_RECORD,
    patch: () => PATCHED_RECORD,
  })
}
