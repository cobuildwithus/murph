import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  completeAssistantOnboarding,
  readAssistantOnboardingState,
  reopenAssistantOnboarding,
  resolveAssistantOnboardingStatePath,
} from '../src/assistant/onboarding-state.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant onboarding state', () => {
  it('defaults to open when no onboarding state exists yet', async () => {
    const vault = await createTempVault()

    await expect(readAssistantOnboardingState(vault)).resolves.toEqual({
      schemaVersion: 'murph.assistant-onboarding.v1',
      status: 'open',
      createdAt: null,
      updatedAt: null,
      completedAt: null,
      completedReason: null,
    })
  })

  it('persists completion state and reopens it later', async () => {
    const vault = await createTempVault()

    await expect(
      completeAssistantOnboarding({
        completedAt: '2026-04-23T00:05:00.000Z',
        reason: 'user_answered',
        vault,
      }),
    ).resolves.toEqual({
      schemaVersion: 'murph.assistant-onboarding.v1',
      status: 'completed',
      createdAt: '2026-04-23T00:05:00.000Z',
      updatedAt: '2026-04-23T00:05:00.000Z',
      completedAt: '2026-04-23T00:05:00.000Z',
      completedReason: 'user_answered',
    })

    await expect(readAssistantOnboardingState(vault)).resolves.toMatchObject({
      status: 'completed',
      completedReason: 'user_answered',
    })

    await expect(
      reopenAssistantOnboarding({
        reopenedAt: '2026-04-23T00:10:00.000Z',
        vault,
      }),
    ).resolves.toEqual({
      schemaVersion: 'murph.assistant-onboarding.v1',
      status: 'open',
      createdAt: '2026-04-23T00:05:00.000Z',
      updatedAt: '2026-04-23T00:10:00.000Z',
      completedAt: null,
      completedReason: null,
    })
  })

  it('persists declined and manual completion reasons', async () => {
    const declinedVault = await createTempVault()
    const manualVault = await createTempVault()

    await expect(
      completeAssistantOnboarding({
        completedAt: '2026-04-23T00:15:00.000Z',
        reason: 'user_declined',
        vault: declinedVault,
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      completedReason: 'user_declined',
    })

    await expect(
      completeAssistantOnboarding({
        completedAt: '2026-04-23T00:20:00.000Z',
        reason: 'manual',
        vault: manualVault,
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      completedReason: 'manual',
    })
  })

  it('preserves the first terminal completion until onboarding is reopened', async () => {
    const vault = await createTempVault()
    const first = await completeAssistantOnboarding({
      completedAt: '2026-04-23T00:15:00.000Z',
      reason: 'user_answered',
      vault,
    })

    await expect(completeAssistantOnboarding({
      completedAt: '2026-04-23T00:20:00.000Z',
      reason: 'manual',
      vault,
    })).resolves.toEqual(first)
    await expect(readAssistantOnboardingState(vault)).resolves.toEqual(first)
  })

  it('does not silently reopen onboarding when the persisted state is malformed', async () => {
    const vault = await createTempVault()
    const statePath = resolveAssistantOnboardingStatePath(vault)

    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, '{"schemaVersion":', 'utf8')

    await expect(readAssistantOnboardingState(vault)).rejects.toMatchObject({
      name: 'AssistantOnboardingStateReadError',
      reason: 'invalid-json',
    })
  })

  it('does not silently reopen onboarding when the persisted state has the wrong schema', async () => {
    const vault = await createTempVault()
    const statePath = resolveAssistantOnboardingStatePath(vault)

    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(
      statePath,
      JSON.stringify({
        schemaVersion: 'murph.assistant-onboarding.v1',
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
        completedAt: null,
      }),
      'utf8',
    )

    await expect(readAssistantOnboardingState(vault)).rejects.toMatchObject({
      name: 'AssistantOnboardingStateReadError',
      reason: 'invalid-schema',
    })
  })

  it('surfaces read failures instead of silently reopening onboarding', async () => {
    const vault = await createTempVault()
    const statePath = resolveAssistantOnboardingStatePath(vault)

    await mkdir(statePath, { recursive: true })

    await expect(readAssistantOnboardingState(vault)).rejects.toMatchObject({
      message: expect.stringContaining(
        '.runtime/operations/assistant/state/onboarding/conversation.json could not be read',
      ),
      name: 'AssistantOnboardingStateReadError',
      reason: 'read-failed',
    })
  })

  it('lets an explicit reopen overwrite malformed onboarding state', async () => {
    const vault = await createTempVault()
    const statePath = resolveAssistantOnboardingStatePath(vault)

    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, '{"schemaVersion":', 'utf8')

    await expect(
      reopenAssistantOnboarding({
        reopenedAt: '2026-04-23T00:10:00.000Z',
        vault,
      }),
    ).resolves.toEqual({
      schemaVersion: 'murph.assistant-onboarding.v1',
      status: 'open',
      createdAt: '2026-04-23T00:10:00.000Z',
      updatedAt: '2026-04-23T00:10:00.000Z',
      completedAt: null,
      completedReason: null,
    })
  })
})

async function createTempVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-assistant-onboarding-'))
  cleanupPaths.push(vault)
  return vault
}
