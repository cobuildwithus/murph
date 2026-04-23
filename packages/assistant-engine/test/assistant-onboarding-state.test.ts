import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  completeAssistantOnboarding,
  readAssistantOnboardingState,
  reopenAssistantOnboarding,
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
})

async function createTempVault(): Promise<string> {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-assistant-onboarding-'))
  cleanupPaths.push(vault)
  return vault
}
