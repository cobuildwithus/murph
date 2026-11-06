import { Cli, z } from 'incur'
import { MemoryDocumentParseError, memoryDocumentRelativePath } from '@murphai/contracts'
import {
  assistantOnboardingCompletionReasonValues,
  assistantOnboardingResultSchema,
  assistantOnboardingResumeContextResultSchema,
  type AssistantOnboardingResumeContextResult,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  completeAssistantOnboarding,
  redactAssistantDisplayPath,
  readAssistantOnboardingState,
  reopenAssistantOnboarding,
  resolveAssistantOnboardingStatePath,
  resolveAssistantStatePaths,
} from '@murphai/assistant-engine/assistant-state'
import { emptyArgsSchema, requestIdFromOptions, withBaseOptions } from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { projectVaultCliError } from '@murphai/operator-config/vault-cli-error-projection'
import type { VaultServices } from '@murphai/vault-usecases'

function buildAssistantVaultResultPath(vault: string) {
  return {
    vault: redactAssistantDisplayPath(vault),
  }
}

function buildAssistantStateRootResultPaths(vault: string, stateRoot: string) {
  return {
    ...buildAssistantVaultResultPath(vault),
    stateRoot: redactAssistantDisplayPath(stateRoot),
  }
}

function buildAssistantStateResultPaths(vault: string) {
  const statePaths = resolveAssistantStatePaths(vault)
  return buildAssistantStateRootResultPaths(vault, statePaths.assistantStateRoot)
}

function buildAssistantOnboardingResult(vault: string, onboarding: unknown) {
  return assistantOnboardingResultSchema.parse({
    ...buildAssistantStateResultPaths(vault),
    statePath: redactAssistantDisplayPath(resolveAssistantOnboardingStatePath(vault)),
    onboarding,
  })
}

type AssistantOnboardingResumeContextSurface =
  AssistantOnboardingResumeContextResult[
    | 'goals'
    | 'regimens'
    | 'supplements'
    | 'conditions'
    | 'allergies'
    | 'experiments'
    | 'deviceAccounts'
  ]

type AssistantOnboardingResumeContextFailureSurface = Exclude<
  AssistantOnboardingResumeContextSurface,
  { status: 'ok' }
>

type AssistantOnboardingDeviceAccountServices = {
  devices?: {
    listAccounts(input: {
      baseUrl?: string
      provider?: string
      sourceProvider?: string
      vault?: string
    }): Promise<{
      accounts: unknown[]
    }>
  }
}

type AssistantVaultServices = VaultServices &
  AssistantOnboardingDeviceAccountServices

const assistantOnboardingResumeContextDefaultLimit = 3

function normalizeAssistantOnboardingResumeContextLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), 50)
}

function requireAssistantVaultServices(
  services: AssistantVaultServices | undefined,
): AssistantVaultServices {
  if (!services) {
    throw new VaultCliError(
      'unavailable',
      'Assistant onboarding resume context requires vault services.',
    )
  }

  return services
}

function buildAssistantOnboardingResumeContextErrorSurface(
  error: unknown,
): AssistantOnboardingResumeContextFailureSurface {
  if (error instanceof VaultCliError) {
    const projection = projectVaultCliError(error)
    return {
      status: 'error',
      code: projection.code,
      message: 'This onboarding context surface could not be read.',
      retryable: projection.retryable,
      ...(projection.hint ? { hint: projection.hint } : {}),
    }
  }

  const nodeCode = readAssistantOnboardingErrorCode(error)
  if (nodeCode === 'EACCES' || nodeCode === 'EPERM') {
    return {
      status: 'error',
      code: 'permission_denied',
      message: 'This onboarding context surface could not be read.',
      retryable: false,
      hint: 'Check the vault file permissions before retrying.',
    }
  }

  return {
    status: 'error',
    code: nodeCode === 'ENOENT' ? 'not_found' : 'read_failed',
    message: 'This onboarding context surface could not be read.',
    retryable: nodeCode !== 'ENOENT',
    hint: nodeCode === 'ENOENT'
      ? 'Check that the vault is initialized and the expected records exist.'
      : 'Retry the context read; use the individual vault command if it continues to fail.',
  }
}

function buildAssistantOnboardingResumeContextMemoryErrorSurface(
  error: unknown,
): AssistantOnboardingResumeContextFailureSurface {
  if (
    !(error instanceof MemoryDocumentParseError)
    || error.details.sourcePath !== memoryDocumentRelativePath
  ) {
    return buildAssistantOnboardingResumeContextErrorSurface(error)
  }

  const { field, lineNumber } = error.details
  const location = lineNumber === undefined
    ? memoryDocumentRelativePath
    : `${memoryDocumentRelativePath}:${lineNumber}`
  const hint = field === undefined
    ? `Repair ${location} before continuing onboarding.`
    : `Repair ${location} by fixing the invalid ${field} field before continuing onboarding.`

  return {
    status: 'error',
    code: 'memory_document_invalid',
    message: 'Canonical memory could not be read while resuming onboarding.',
    retryable: false,
    hint,
  }
}

function buildAssistantOnboardingResumeContextUnavailableSurface():
  AssistantOnboardingResumeContextFailureSurface {
  return {
    status: 'unavailable',
    code: 'service_unavailable',
    message: 'This onboarding context surface is not available in the current runtime.',
    retryable: false,
    hint: 'Use a runtime with the matching service enabled to inspect this surface.',
  }
}

function readAssistantOnboardingErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }
  return typeof error.code === 'string' ? error.code : null
}

function buildAssistantOnboardingResumeContextListSurface(input: {
  count?: number
  items: readonly unknown[]
  limit: number
}): AssistantOnboardingResumeContextSurface {
  const count = input.count ?? input.items.length
  const items = input.items.slice(0, input.limit)

  return {
    status: 'ok',
    count,
    truncated: count > items.length,
    items,
  }
}

async function readAssistantOnboardingResumeContextListSurface(input: {
  limit: number
  read: () => Promise<{
    count?: number
    items?: readonly unknown[]
  }>
}): Promise<AssistantOnboardingResumeContextSurface> {
  try {
    const result = await input.read()

    return buildAssistantOnboardingResumeContextListSurface({
      count: result.count,
      items: result.items ?? [],
      limit: input.limit,
    })
  } catch (error) {
    return buildAssistantOnboardingResumeContextErrorSurface(error)
  }
}

async function readAssistantOnboardingResumeContextMemory(input: {
  commandContext: {
    requestId: string | null
    vault: string
  }
  limit: number
  services: AssistantVaultServices
}): Promise<AssistantOnboardingResumeContextResult['memory']> {
  try {
    const result = await input.services.query.readMemoryDocument(
      input.commandContext,
    )
    const records = result.document.records.slice(0, input.limit)

    return {
      status: 'ok',
      exists: result.document.exists,
      recordCount: result.document.records.length,
      records,
      truncated: result.document.records.length > records.length,
      updatedAt: result.document.updatedAt,
    }
  } catch (error) {
    return buildAssistantOnboardingResumeContextMemoryErrorSurface(error)
  }
}

function resolveAssistantOnboardingDeviceAccountServices(
  services?: AssistantVaultServices,
): AssistantOnboardingDeviceAccountServices['devices'] | null {
  return services?.devices ?? null
}

async function readAssistantOnboardingResumeContextDeviceAccounts(input: {
  limit: number
  services?: AssistantVaultServices
  vault: string
}): Promise<AssistantOnboardingResumeContextSurface> {
  const deviceServices = resolveAssistantOnboardingDeviceAccountServices(
    input.services,
  )
  if (!deviceServices) {
    return buildAssistantOnboardingResumeContextUnavailableSurface()
  }

  return readAssistantOnboardingResumeContextListSurface({
    limit: input.limit,
    async read() {
      const result = await deviceServices.listAccounts({
        vault: input.vault,
      })

      return {
        count: result.accounts.length,
        items: result.accounts,
      }
    },
  })
}

export function registerAssistantOnboardingCommands(cli: Cli.Cli, vaultServices?: AssistantVaultServices) {
  const assistant = Cli.create('assistant', { description: 'Manage hosted assistant onboarding.' })
  const onboarding = Cli.create('onboarding', {
    description:
      'Inspect or update the assistant Murph onboarding lifecycle state shared across user-facing channels for this vault.',
  })

  onboarding.command('status', {
    args: emptyArgsSchema,
    description:
      'Show whether assistant Murph onboarding is still open or has already been completed for this vault.',
    options: withBaseOptions(),
    output: assistantOnboardingResultSchema,
    async run(context) {
      return buildAssistantOnboardingResult(
        context.options.vault,
        await readAssistantOnboardingState(context.options.vault),
      )
    },
  })

  onboarding.command('resume-context', {
    args: emptyArgsSchema,
    description:
      'Read the compact setup context Murph needs to resume first-run onboarding without re-asking saved facts.',
    options: withBaseOptions({
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .default(assistantOnboardingResumeContextDefaultLimit)
        .describe(
          'Maximum records to return per setup surface. Defaults to 3.',
        ),
    }),
    output: assistantOnboardingResumeContextResultSchema,
    async run(context) {
      const services = requireAssistantVaultServices(vaultServices)
      const vault = context.options.vault
      const limit = normalizeAssistantOnboardingResumeContextLimit(
        context.options.limit,
      )
      const commandContext = {
        requestId: requestIdFromOptions(context.options),
        vault,
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
        readAssistantOnboardingState(vault),
        readAssistantOnboardingResumeContextMemory({
          commandContext,
          limit,
          services,
        }),
        readAssistantOnboardingResumeContextListSurface({
          limit,
          read: () => services.query.listGoals({ ...commandContext, limit }),
        }),
        readAssistantOnboardingResumeContextListSurface({
          limit,
          read: () => services.query.listRegimens({ ...commandContext, limit }),
        }),
        readAssistantOnboardingResumeContextListSurface({
          limit,
          read: () => services.query.listSupplements({ ...commandContext, limit }),
        }),
        readAssistantOnboardingResumeContextListSurface({
          limit,
          read: () => services.query.listConditions({ ...commandContext, limit }),
        }),
        readAssistantOnboardingResumeContextListSurface({
          limit,
          read: () => services.query.listAllergies({ ...commandContext, limit }),
        }),
        readAssistantOnboardingResumeContextListSurface({
          limit,
          async read() {
            const result = await services.query.listExperiments({
              ...commandContext,
              limit,
            })

            return {
              count: result.count,
              items: result.items,
            }
          },
        }),
        readAssistantOnboardingResumeContextDeviceAccounts({
          limit,
          services,
          vault,
        }),
      ])

      return assistantOnboardingResumeContextResultSchema.parse({
        vault: redactAssistantDisplayPath(vault),
        limit,
        onboarding: onboardingState,
        memory,
        goals,
        regimens,
        supplements,
        conditions,
        allergies,
        experiments,
        deviceAccounts,
      })
    },
  })

  onboarding.command('complete', {
    args: emptyArgsSchema,
    description:
      'Mark assistant Murph onboarding complete for this vault so the onboarding prompt policy stops being injected on future turns.',
    options: withBaseOptions({
      reason: z
        .enum(assistantOnboardingCompletionReasonValues)
        .describe(
          'Why onboarding is done: user_answered, user_declined, or manual.',
        ),
    }),
    output: assistantOnboardingResultSchema,
    async run(context) {
      return buildAssistantOnboardingResult(
        context.options.vault,
        await completeAssistantOnboarding({
          reason: context.options.reason,
          vault: context.options.vault,
        }),
      )
    },
  })

  onboarding.command('reopen', {
    args: emptyArgsSchema,
    description:
      'Reopen assistant Murph onboarding for this vault so onboarding guidance is injected again until it is completed later.',
    options: withBaseOptions(),
    output: assistantOnboardingResultSchema,
    async run(context) {
      return buildAssistantOnboardingResult(
        context.options.vault,
        await reopenAssistantOnboarding({
          vault: context.options.vault,
        }),
      )
    },
  })

  assistant.command(onboarding)
  cli.command(assistant)
}
