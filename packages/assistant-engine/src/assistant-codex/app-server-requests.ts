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
import {
  MURPH_SEND_PROGRESS_UPDATE_TOOL,
} from './dynamic-tools.js'
import {
  isAssistantModelProgressAvailable,
} from '../assistant/turn-progress.js'

const CODEX_RPC_CLIENT_NAME = 'murph'

type CodexAppServerSandboxMode =
  | 'danger-full-access'
  | 'read-only'
  | 'workspace-write'

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
    developerInstructions:
      input.input.refreshThreadInstructions === true
        ? normalizeNullableString(input.input.developerInstructions)
        : undefined,
    dynamicTools: resolveCodexAppServerDynamicTools(input.input),
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
  return stripUndefinedRpcParams({
    approvalPolicy: mapCodexAppServerApprovalPolicy(input.input.approvalPolicy),
    baseInstructions: input.includeInstructions
      ? normalizeNullableString(input.input.baseInstructions)
      : undefined,
    cwd: input.input.workingDirectory,
    developerInstructions: input.includeInstructions
      ? normalizeNullableString(input.input.developerInstructions)
      : undefined,
    dynamicTools: resolveCodexAppServerDynamicTools(input.input),
    model: normalizeNullableString(input.input.model),
    modelProvider: normalizeNullableString(input.input.modelProvider),
    sandbox: mapCodexAppServerSandboxMode(input.input.sandbox),
    serviceName: input.includeServiceName ? CODEX_RPC_CLIENT_NAME : undefined,
  })
}

function resolveCodexAppServerDynamicTools(
  input: CodexAppServerTurnInput,
): readonly [typeof MURPH_SEND_PROGRESS_UPDATE_TOOL] | undefined {
  return isAssistantModelProgressAvailable(input)
    ? [MURPH_SEND_PROGRESS_UPDATE_TOOL]
    : undefined
}

export function buildCodexTurnStartParams(input: {
  imagePaths: readonly string[]
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
  codexThreadId: string
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    effort: normalizeNullableString(input.input.reasoningEffort),
    input: buildCodexAppServerInputItems({
      imagePaths: input.imagePaths,
      prompt: input.input.prompt,
    }),
    threadId: input.codexThreadId,
  })
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
