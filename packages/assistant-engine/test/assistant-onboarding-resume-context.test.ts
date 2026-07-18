import path from 'node:path'

import type { MemoryRecord } from '@murphai/contracts'
import type { ListEntity } from '@murphai/operator-config/vault-cli-contracts'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resumeContextMocks = vi.hoisted(() => ({
  readAssistantOnboardingState: vi.fn(),
}))

vi.mock('../src/assistant/onboarding-state.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/assistant/onboarding-state.ts')>()),
  readAssistantOnboardingState:
    resumeContextMocks.readAssistantOnboardingState,
}))

import {
  ASSISTANT_ONBOARDING_RESUME_CONTEXT_DEFAULT_LIMIT,
  readAssistantOnboardingResumeContext,
} from '../src/assistant/onboarding-resume-context.ts'

const OPEN_ONBOARDING_STATE = {
  schemaVersion: 'murph.assistant-onboarding.v1' as const,
  status: 'open' as const,
  createdAt: null,
  updatedAt: null,
  completedAt: null,
  completedReason: null,
}

beforeEach(() => {
  vi.restoreAllMocks()
  resumeContextMocks.readAssistantOnboardingState
    .mockReset()
    .mockResolvedValue(OPEN_ONBOARDING_STATE)
})

describe('assistant onboarding resume context', () => {
  it('forwards only the trusted vault and request context to every owner read', async () => {
    const vault = '/trusted/onboarding-vault'
    const requestId = 'request_onboarding_resume'
    const fixture = createQueryFixture({ itemCount: 2, vault })
    const readDeviceAccounts = vi.fn().mockResolvedValue([
      { accountId: 'device-account-1' },
      { accountId: 'device-account-2' },
    ])

    const result = await readAssistantOnboardingResumeContext({
      readDeviceAccounts,
      requestId,
      services: fixture.services,
      vault,
    })

    const listInput = {
      limit: ASSISTANT_ONBOARDING_RESUME_CONTEXT_DEFAULT_LIMIT,
      requestId,
      vault,
    }
    expect(resumeContextMocks.readAssistantOnboardingState).toHaveBeenCalledWith(
      vault,
    )
    expect(fixture.spies.readMemoryDocument).toHaveBeenCalledWith({
      requestId,
      vault,
    })
    expect(fixture.spies.listGoals).toHaveBeenCalledWith(listInput)
    expect(fixture.spies.listRegimens).toHaveBeenCalledWith(listInput)
    expect(fixture.spies.listSupplements).toHaveBeenCalledWith(listInput)
    expect(fixture.spies.listConditions).toHaveBeenCalledWith(listInput)
    expect(fixture.spies.listAllergies).toHaveBeenCalledWith(listInput)
    expect(fixture.spies.listExperiments).toHaveBeenCalledWith(listInput)
    expect(readDeviceAccounts).toHaveBeenCalledWith()
    expect(result).toMatchObject({
      limit: ASSISTANT_ONBOARDING_RESUME_CONTEXT_DEFAULT_LIMIT,
      onboarding: OPEN_ONBOARDING_STATE,
      vault,
    })
  })

  it.each([
    { expectedLimit: 1, requestedLimit: -4.8 },
    { expectedLimit: 50, requestedLimit: 99.8 },
  ])(
    'clamps $requestedLimit to $expectedLimit and truncates every successful surface',
    async ({ expectedLimit, requestedLimit }) => {
      const vault = '/trusted/onboarding-vault'
      const fixture = createQueryFixture({ itemCount: 55, vault })
      const deviceAccounts = Array.from({ length: 55 }, (_, index) => ({
        accountId: `device-account-${index + 1}`,
      }))

      const result = await readAssistantOnboardingResumeContext({
        limit: requestedLimit,
        readDeviceAccounts: async () => deviceAccounts,
        requestId: 'request_bounded_resume',
        services: fixture.services,
        vault,
      })

      expect(result.limit).toBe(expectedLimit)
      expect(result.memory).toMatchObject({
        recordCount: 55,
        status: 'ok',
        truncated: true,
      })
      if (result.memory.status !== 'ok') {
        throw new Error('Expected the memory resume surface to be available.')
      }
      expect(result.memory.records).toHaveLength(expectedLimit)

      for (const surface of [
        result.goals,
        result.regimens,
        result.supplements,
        result.conditions,
        result.allergies,
        result.experiments,
        result.deviceAccounts,
      ]) {
        expect(surface).toMatchObject({
          count: 55,
          status: 'ok',
          truncated: true,
        })
        if (surface.status !== 'ok') {
          throw new Error('Expected the onboarding resume surface to be available.')
        }
        expect(surface.items).toHaveLength(expectedLimit)
      }

      expect(fixture.spies.listGoals).toHaveBeenCalledWith({
        limit: expectedLimit,
        requestId: 'request_bounded_resume',
        vault,
      })
    },
  )

  it('keeps one owner read failure isolated behind the stable error surface', async () => {
    const vault = '/trusted/onboarding-vault'
    const fixture = createQueryFixture({ itemCount: 2, vault })
    fixture.spies.listConditions.mockRejectedValueOnce(
      new Error('private database host and query details'),
    )

    const result = await readAssistantOnboardingResumeContext({
      readDeviceAccounts: async () => [{ accountId: 'device-account-1' }],
      services: fixture.services,
      vault,
    })

    expect(result.conditions).toEqual({
      message: 'Read failed.',
      status: 'error',
    })
    expect(result.goals.status).toBe('ok')
    expect(result.memory.status).toBe('ok')
    expect(JSON.stringify(result)).not.toContain(
      'private database host and query details',
    )
  })

  it('returns a prompt-safe snapshot with a home-relative vault display path', async () => {
    const homeDirectory = process.env.HOME
    if (!homeDirectory) {
      throw new Error('This path-redaction test requires a home directory.')
    }
    const vault = path.join(
      homeDirectory,
      '.murph-test-vaults',
      'onboarding-resume-context',
    )
    const fixture = createQueryFixture({ itemCount: 1, vault })

    const result = await readAssistantOnboardingResumeContext({
      readDeviceAccounts: async () => [],
      services: fixture.services,
      vault,
    })
    const serializedPromptSnapshot = JSON.stringify(result)

    expect(result.vault).toBe(
      path.join('~', '.murph-test-vaults', 'onboarding-resume-context'),
    )
    expect(serializedPromptSnapshot).not.toContain(homeDirectory)
    expect(serializedPromptSnapshot).toContain('"vault":"~')
  })
})

function createQueryFixture(input: {
  itemCount: number
  vault: string
}) {
  const services = createIntegratedVaultServices()
  const items = Array.from({ length: input.itemCount }, (_, index) =>
    createListEntity(index),
  )
  const records = Array.from({ length: input.itemCount }, (_, index) =>
    createMemoryRecord(index),
  )
  const healthListResult = {
    count: input.itemCount,
    filters: { limit: input.itemCount },
    items,
    nextCursor: null,
    vault: input.vault,
  }
  const experimentsResult = {
    count: input.itemCount,
    filters: { limit: input.itemCount, status: null },
    items,
    nextCursor: null,
    vault: input.vault,
  }
  const memoryResult = {
    document: {
      exists: true,
      frontmatter: {
        docType: 'memory' as const,
        schemaVersion: 'murph.frontmatter.memory.v1' as const,
        title: 'Memory',
        updatedAt: '2026-07-18T12:00:00.000Z',
      },
      markdown: '# Memory',
      records,
      sourcePath: 'bank/memory.md',
      updatedAt: '2026-07-18T12:00:00.000Z',
    },
    vault: input.vault,
  }

  return {
    services,
    spies: {
      listAllergies: vi.spyOn(services.query, 'listAllergies')
        .mockResolvedValue(healthListResult),
      listConditions: vi.spyOn(services.query, 'listConditions')
        .mockResolvedValue(healthListResult),
      listExperiments: vi.spyOn(services.query, 'listExperiments')
        .mockResolvedValue(experimentsResult),
      listGoals: vi.spyOn(services.query, 'listGoals')
        .mockResolvedValue(healthListResult),
      listRegimens: vi.spyOn(services.query, 'listRegimens')
        .mockResolvedValue(healthListResult),
      listSupplements: vi.spyOn(services.query, 'listSupplements')
        .mockResolvedValue(healthListResult),
      readMemoryDocument: vi.spyOn(services.query, 'readMemoryDocument')
        .mockResolvedValue(memoryResult),
    },
  }
}

function createListEntity(index: number): ListEntity {
  return {
    data: { ordinal: index + 1 },
    id: `goal-${index + 1}`,
    kind: 'goal',
    links: [],
    occurredAt: null,
    path: null,
    title: `Goal ${index + 1}`,
  }
}

function createMemoryRecord(index: number): MemoryRecord {
  const timestamp = '2026-07-18T12:00:00.000Z'
  return {
    createdAt: timestamp,
    id: `mem_01ARZ3NDEKTSV4RRFFQ69G${String(index).padStart(3, '0')}`,
    section: 'Context',
    sourceLine: index + 1,
    sourcePath: 'bank/memory.md',
    text: `Context ${index + 1}`,
    updatedAt: timestamp,
  }
}
