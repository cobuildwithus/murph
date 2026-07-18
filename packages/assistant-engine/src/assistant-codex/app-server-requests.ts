import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantApprovalPolicy,
  AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  CodexAppServerSteerInput,
  CodexAppServerTurnInput,
} from '../assistant-codex.js'
import { stripUndefinedRpcParams } from './app-server-rpc.js'

const CODEX_RPC_CLIENT_NAME = 'murph'
const MURPH_CODEX_ENFORCED_CONFIG = Object.freeze({
  'features.apps': false,
  'features.code_mode_host': false,
  'features.plugins': false,
  'features.remote_plugin': false,
  notify: Object.freeze([]),
}) satisfies Readonly<Record<string, unknown>>

export const MURPH_CODEX_FINAL_CONFIG_OVERRIDES: readonly string[] = Object.freeze(
  Object.entries(MURPH_CODEX_ENFORCED_CONFIG).map(
    ([key, value]) => `${key}=${JSON.stringify(value)}`,
  ),
)

type CodexAppServerSandboxMode =
  | 'danger-full-access'
  | 'read-only'
  | 'workspace-write'

type CodexAppServerSandboxPolicy =
  | {
      type: 'dangerFullAccess'
    }
  | {
      networkAccess: false
      type: 'readOnly'
    }
  | {
      excludeSlashTmp: false
      excludeTmpdirEnvVar: false
      networkAccess: false
      type: 'workspaceWrite'
      writableRoots: []
    }

export type CodexAppServerInputItem =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'localImage'
      path: string
    }

export type CodexAppServerSteerRequestInput = Omit<
  CodexAppServerSteerInput,
  'images'
> & {
  imagePaths?: readonly string[] | null
}

export function buildCodexThreadStartParams(
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  },
): Record<string, unknown> {
  return buildCodexThreadContextParams({
    includeInstructions: true,
    includeServiceName: true,
    input,
  })
}

export function buildCodexThreadResumeParams(input: {
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
  codexThreadId: string
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    ...buildCodexThreadResumeContextParams(input.input),
    excludeTurns: input.input.excludeResumeTurns === false ? undefined : true,
    threadId: input.codexThreadId,
  })
}

export function buildCodexThreadContextParams(input: {
  includeInstructions: boolean
  includeServiceName: boolean
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
}): Record<string, unknown> {
  const permissions = normalizeNullableString(input.input.permissions)
  if (permissions && input.input.sandbox) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Codex app-server requests cannot combine named permissions with a legacy sandbox.',
      {
        invalidFields: ['permissions', 'sandbox'],
        retryable: false,
      },
    )
  }
  const scheduledExecution = input.input.scheduledExecution === true
  const threadConfig = scheduledExecution
    ? {
        ...(input.input.threadConfig ?? {}),
        ...MURPH_CODEX_ENFORCED_CONFIG,
      }
    : input.input.threadConfig

  return stripUndefinedRpcParams({
    approvalPolicy: mapCodexAppServerApprovalPolicy(input.input.approvalPolicy),
    baseInstructions: input.includeInstructions
      ? normalizeNullableString(input.input.baseInstructions)
      : undefined,
    cwd: input.input.workingDirectory,
    developerInstructions: input.includeInstructions
      ? normalizeNullableString(input.input.developerInstructions)
      : undefined,
    dynamicTools: input.input.dynamicTools,
    ephemeral: input.input.ephemeral ?? undefined,
    environments: input.input.environments
      ? input.input.environments.map((environment) => ({ ...environment }))
      : undefined,
    model: normalizeNullableString(input.input.model),
    modelProvider: normalizeNullableString(input.input.modelProvider),
    permissions,
    runtimeWorkspaceRoots: input.input.runtimeWorkspaceRoots
      ? [...input.input.runtimeWorkspaceRoots]
      : undefined,
    selectedCapabilityRoots: scheduledExecution ? [] : undefined,
    config: threadConfig,
    sandbox: permissions
      ? undefined
      : mapCodexAppServerSandboxMode(input.input.sandbox),
    serviceName: input.includeServiceName ? CODEX_RPC_CLIENT_NAME : undefined,
  })
}

function buildCodexThreadResumeContextParams(
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  },
): Record<string, unknown> {
  return {
    approvalPolicy: mapCodexAppServerApprovalPolicy(input.approvalPolicy),
    cwd: input.workingDirectory,
    model: normalizeNullableString(input.model),
    modelProvider: normalizeNullableString(input.modelProvider),
    sandbox: mapCodexAppServerSandboxMode(input.sandbox),
  }
}

export function buildCodexTurnStartParams(input: {
  imagePaths: readonly string[]
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
  codexThreadId: string
}): Record<string, unknown> {
  const permissions = normalizeNullableString(input.input.permissions)
  if (permissions && input.input.sandbox) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Codex app-server requests cannot combine named permissions with a legacy sandbox.',
      {
        invalidFields: ['permissions', 'sandbox'],
        retryable: false,
      },
    )
  }

  const params = stripUndefinedRpcParams({
    approvalPolicy: mapCodexAppServerApprovalPolicy(input.input.approvalPolicy),
    effort: normalizeNullableString(input.input.reasoningEffort),
    input: buildCodexAppServerInputItems({
      imagePaths: input.imagePaths,
      prompt: input.input.prompt,
    }),
    outputSchema: input.input.outputSchema
      ? { ...input.input.outputSchema }
      : undefined,
    model: normalizeNullableString(input.input.model),
    permissions,
    runtimeWorkspaceRoots: permissions && input.input.runtimeWorkspaceRoots
      ? [...input.input.runtimeWorkspaceRoots]
      : undefined,
    sandboxPolicy: permissions
      ? undefined
      : mapCodexAppServerSandboxPolicy(input.input.sandbox),
    threadId: input.codexThreadId,
  })

  // Always explicit: `serviceTier` overrides stick to the thread for
  // subsequent turns, so non-tiered turns must send null to reset it
  // (double-option semantics: absent = inherit, null = default tier).
  params.serviceTier = normalizeNullableString(input.input.serviceTier) ?? null
  return params
}

export function buildCodexTurnSteerParams(
  input: CodexAppServerSteerRequestInput,
): Record<string, unknown> {
  return stripUndefinedRpcParams({
    expectedTurnId: assertCodexRpcIdentifier({
      field: 'turnId',
      value: input.turnId,
    }),
    input: buildCodexAppServerInputItems({
      imagePaths: input.imagePaths ?? [],
      prompt: input.prompt,
    }),
    threadId: assertCodexRpcIdentifier({
      field: 'threadId',
      value: input.threadId,
    }),
  })
}

export function buildCodexTurnInterruptParams(input: {
  threadId: string
  turnId: string
}): Record<string, unknown> {
  return {
    threadId: assertCodexRpcIdentifier({
      field: 'threadId',
      value: input.threadId,
    }),
    turnId: assertCodexRpcIdentifier({
      field: 'turnId',
      value: input.turnId,
    }),
  }
}

export function buildCodexAppServerInputItems(input: {
  imagePaths: readonly string[]
  prompt: string
}): CodexAppServerInputItem[] {
  return [
    {
      type: 'text',
      text: input.prompt,
    },
    ...input.imagePaths.map((imagePath) => ({
      type: 'localImage' as const,
      path: imagePath,
    })),
  ]
}

export function mapCodexAppServerApprovalPolicy(
  approvalPolicy: string | null | undefined,
): 'never' {
  return resolveSupportedCodexAppServerApprovalPolicy(approvalPolicy)
}

export function mapCodexAppServerSandboxMode(
  sandbox: AssistantSandbox | null | undefined,
): CodexAppServerSandboxMode | undefined {
  switch (sandbox) {
    case 'read-only':
      return 'read-only'
    case 'workspace-write':
      return 'workspace-write'
    case 'danger-full-access':
      return 'danger-full-access'
    default:
      return undefined
  }
}

export function mapCodexAppServerSandboxPolicy(
  sandbox: AssistantSandbox | null | undefined,
): CodexAppServerSandboxPolicy | undefined {
  switch (sandbox) {
    case 'read-only':
      return {
        networkAccess: false,
        type: 'readOnly',
      }
    case 'workspace-write':
      return {
        excludeSlashTmp: false,
        excludeTmpdirEnvVar: false,
        networkAccess: false,
        type: 'workspaceWrite',
        writableRoots: [],
      }
    case 'danger-full-access':
      return {
        type: 'dangerFullAccess',
      }
    default:
      return undefined
  }
}

export function resolveSupportedCodexAppServerApprovalPolicy(
  approvalPolicy: string | null | undefined,
): 'never' {
  if (!approvalPolicy || approvalPolicy === 'never') {
    return 'never'
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_APPROVAL_POLICY_UNSUPPORTED',
    `Codex app-server approval policy "${approvalPolicy}" is not supported in noninteractive assistant turns. Use approvalPolicy=never.`,
    {
      approvalPolicy,
      retryable: false,
    },
  )
}

function assertCodexRpcIdentifier(input: {
  field: 'threadId' | 'turnId'
  value: string
}): string {
  const normalized = normalizeNullableString(input.value)
  if (normalized) {
    return normalized
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
    `Codex app-server ${input.field} is required for live turn requests.`,
    {
      field: input.field,
      retryable: false,
    },
  )
}
