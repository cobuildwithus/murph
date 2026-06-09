import { rm } from 'node:fs/promises'

import {
  showAutomation,
  upsertAutomation,
} from '@murphai/core'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
  applyMurphManagedAutomations,
} from '../src/assistant/managed-automations.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []

const defaultRoute = {
  channel: 'telegram',
  deliveryTarget: 'telegram-thread-1',
  identityId: null,
  participantId: null,
  threadId: null,
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0, tempRoots.length).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  )
})

async function createVaultRoot(): Promise<string> {
  const context = await createTempVaultContext('murph-managed-automations-core-')
  tempRoots.push(context.parentRoot)
  return context.vaultRoot
}

describe('applyMurphManagedAutomations core integration', () => {
  it('creates the weekly health digest through the canonical automation registry', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })

    const record = await showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })

    expect(record).toMatchObject({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      route: defaultRoute,
      slug: 'weekly-health-digest',
      status: 'active',
      title: 'Weekly health digest',
    })
  })

  it('creates over a Linq participant route with a Linq delivery source, preserving deliverySource', async () => {
    const vaultRoot = await createVaultRoot()
    const linqParticipantRoute = {
      channel: 'linq',
      deliverySource: {
        fromPhoneNumber: '+15550001111',
        kind: 'linq' as const,
      },
      deliveryTarget: null,
      identityId: 'hid_linq_identity_participant',
      participantId: '+15550002222',
      threadId: null,
    }

    await expect(applyMurphManagedAutomations({
      defaultRoute: linqParticipantRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 1,
      skipped: 0,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toMatchObject({
      route: linqParticipantRoute,
      status: 'active',
    })
  })

  it('skips creation for a Linq participant route without a Linq delivery source', async () => {
    const vaultRoot = await createVaultRoot()

    await expect(applyMurphManagedAutomations({
      defaultRoute: {
        channel: 'linq',
        deliverySource: null,
        deliveryTarget: null,
        identityId: 'hid_linq_identity_participant',
        participantId: '+15550002222',
        threadId: null,
      },
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 1,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
  })

  it('is idempotent against the persisted record: a second apply writes nothing', async () => {
    const vaultRoot = await createVaultRoot()

    await applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })

    // Guards against seed/persistence normalization drift (trimming, markdown
    // round-tripping, tag dedup order): the persisted record must compare
    // equal to the seed so background wakes never rewrite it.
    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T13:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 1,
      updated: 0,
    })
  })

  it('does not overwrite a user automation that already owns the managed slug', async () => {
    const vaultRoot = await createVaultRoot()
    const userAutomation = await upsertAutomation({
      automationId: 'automation_01JNW7YJ7MNE7M9Q2QWQK4Z3F8',
      continuityPolicy: 'preserve',
      instructions: 'Keep this user-owned automation prompt.',
      now: new Date('2026-06-09T12:00:00.000Z'),
      route: defaultRoute,
      schedule: {
        kind: 'cron',
        expression: '0 8 * * 1',
      },
      slug: 'weekly-health-digest',
      status: 'active',
      summary: 'User-owned automation.',
      tags: ['user'],
      title: 'My weekly health digest',
      vaultRoot,
    })

    await expect(applyMurphManagedAutomations({
      defaultRoute,
      now: new Date('2026-06-09T12:00:00.000Z'),
      vaultRoot,
    })).resolves.toEqual({
      created: 0,
      skipped: 1,
      updated: 0,
    })

    await expect(showAutomation({
      automationId: MURPH_WEEKLY_HEALTH_DIGEST_AUTOMATION_ID,
      vaultRoot,
    })).resolves.toBeNull()
    await expect(showAutomation({
      automationId: userAutomation.record.automationId,
      vaultRoot,
    })).resolves.toMatchObject({
      automationId: userAutomation.record.automationId,
      instructions: 'Keep this user-owned automation prompt.',
      slug: 'weekly-health-digest',
      tags: ['user'],
      title: 'My weekly health digest',
    })
  })
})
