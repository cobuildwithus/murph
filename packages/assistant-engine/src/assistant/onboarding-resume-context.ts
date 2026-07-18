import {
  assistantOnboardingResumeContextResultSchema,
  type AssistantOnboardingResumeContextResult,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  createIntegratedVaultServices,
  type VaultServices,
} from '@murphai/vault-usecases'

import { readAssistantOnboardingState } from './onboarding-state.js'
import { redactAssistantDisplayPath } from './store/paths.js'

type OnboardingResumeContextSurface = AssistantOnboardingResumeContextResult[
  | 'goals'
  | 'regimens'
  | 'supplements'
  | 'conditions'
  | 'allergies'
  | 'experiments'
  | 'deviceAccounts'
]

export const ASSISTANT_ONBOARDING_RESUME_CONTEXT_DEFAULT_LIMIT = 3

/**
 * One canonical owner for the compact onboarding resume snapshot.
 *
 * Callers supply device-account reading because hosted and local runtimes own
 * that transport differently. Every other surface comes from the active vault
 * selected by the trusted parent; the model supplies neither a path nor a
 * selector.
 */
export async function readAssistantOnboardingResumeContext(input: {
  limit?: number
  readDeviceAccounts?: (() => Promise<readonly unknown[]>) | null
  requestId?: string | null
  services?: Pick<VaultServices, 'query'>
  vault: string
}): Promise<AssistantOnboardingResumeContextResult> {
  const services = input.services ?? createIntegratedVaultServices()
  const limit = normalizeLimit(
    input.limit ?? ASSISTANT_ONBOARDING_RESUME_CONTEXT_DEFAULT_LIMIT,
  )
  const commandContext = {
    requestId: input.requestId ?? null,
    vault: input.vault,
  }
  const [
    onboardingState,
    memory,
    goals,
    regimens,
    supplements,
    conditions,
    allergies,
    experiments,
    deviceAccounts,
  ] = await Promise.all([
    readAssistantOnboardingState(input.vault),
    readMemory({ commandContext, limit, services }),
    readListSurface({
      limit,
      read: () => services.query.listGoals({ ...commandContext, limit }),
    }),
    readListSurface({
      limit,
      read: () => services.query.listRegimens({ ...commandContext, limit }),
    }),
    readListSurface({
      limit,
      read: () => services.query.listSupplements({ ...commandContext, limit }),
    }),
    readListSurface({
      limit,
      read: () => services.query.listConditions({ ...commandContext, limit }),
    }),
    readListSurface({
      limit,
      read: () => services.query.listAllergies({ ...commandContext, limit }),
    }),
    readListSurface({
      limit,
      async read() {
        const result = await services.query.listExperiments({
          ...commandContext,
          limit,
        })
        return { count: result.count, items: result.items }
      },
    }),
    readDeviceAccounts(input.readDeviceAccounts ?? null, limit),
  ])

  return assistantOnboardingResumeContextResultSchema.parse({
    allergies,
    conditions,
    deviceAccounts,
    experiments,
    goals,
    limit,
    memory,
    onboarding: onboardingState,
    regimens,
    supplements,
    vault: redactAssistantDisplayPath(input.vault),
  })
}

function normalizeLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), 50)
}

async function readListSurface(input: {
  limit: number
  read: () => Promise<{ count?: number; items?: readonly unknown[] }>
}): Promise<OnboardingResumeContextSurface> {
  try {
    const result = await input.read()
    return buildListSurface(result.items ?? [], input.limit, result.count)
  } catch {
    return errorSurface()
  }
}

async function readMemory(input: {
  commandContext: { requestId: string | null; vault: string }
  limit: number
  services: Pick<VaultServices, 'query'>
}): Promise<AssistantOnboardingResumeContextResult['memory']> {
  try {
    const result = await input.services.query.readMemoryDocument(
      input.commandContext,
    )
    const records = result.document.records.slice(0, input.limit)
    return {
      exists: result.document.exists,
      recordCount: result.document.records.length,
      records,
      status: 'ok',
      truncated: result.document.records.length > records.length,
      updatedAt: result.document.updatedAt,
    }
  } catch {
    return errorSurface()
  }
}

async function readDeviceAccounts(
  read: (() => Promise<readonly unknown[]>) | null,
  limit: number,
): Promise<OnboardingResumeContextSurface> {
  if (!read) {
    return errorSurface()
  }
  return readListSurface({
    limit,
    async read() {
      const accounts = await read()
      return { count: accounts.length, items: accounts }
    },
  })
}

function buildListSurface(
  allItems: readonly unknown[],
  limit: number,
  count = allItems.length,
): OnboardingResumeContextSurface {
  const items = allItems.slice(0, limit)
  return {
    count,
    items,
    status: 'ok',
    truncated: count > items.length,
  }
}

function errorSurface(): { message: string; status: 'error' } {
  return { message: 'Read failed.', status: 'error' }
}
