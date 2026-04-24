import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantApprovalPolicy,
  AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { CodexAppServerTurnInput } from '../assistant-codex.js'
import { stripUndefinedRpcParams } from './app-server-rpc.js'

const CODEX_RPC_CLIENT_NAME = 'murph'

export type CodexAppServerInputItem =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'localImage'
      path: string
    }

export function buildCodexThreadStartParams(
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  },
): Record<string, unknown> {
  return buildCodexThreadContextParams({
    includeServiceName: true,
    input,
  })
}

export function buildCodexThreadResumeParams(input: {
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
  providerSessionId: string
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    ...buildCodexThreadContextParams({
      includeServiceName: false,
      input: input.input,
    }),
    threadId: input.providerSessionId,
  })
}

export function buildCodexThreadContextParams(input: {
  includeServiceName: boolean
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    approvalPolicy: mapCodexAppServerApprovalPolicy(input.input.approvalPolicy),
    cwd: input.input.workingDirectory,
    model: normalizeNullableString(input.input.model),
    sandbox: mapCodexAppServerSandboxMode(input.input.sandbox),
    serviceName: input.includeServiceName ? CODEX_RPC_CLIENT_NAME : undefined,
  })
}

export function buildCodexTurnStartParams(input: {
  imagePaths: readonly string[]
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
  providerSessionId: string
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    effort: normalizeNullableString(input.input.reasoningEffort),
    input: buildCodexAppServerInputItems({
      imagePaths: input.imagePaths,
      prompt: input.input.prompt,
    }),
    threadId: input.providerSessionId,
  })
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
  approvalPolicy: AssistantApprovalPolicy | null | undefined,
): string | undefined {
  switch (approvalPolicy) {
    case 'on-request':
      return 'onRequest'
    case 'untrusted':
      return 'unlessTrusted'
    case 'never':
      return 'never'
    default:
      return undefined
  }
}

export function mapCodexAppServerSandboxMode(
  sandbox: AssistantSandbox | null | undefined,
): string | undefined {
  switch (sandbox) {
    case 'read-only':
      return 'readOnly'
    case 'workspace-write':
      return 'workspaceWrite'
    case 'danger-full-access':
      return 'dangerFullAccess'
    default:
      return undefined
  }
}

export function resolveSupportedCodexAppServerApprovalPolicy(
  approvalPolicy: AssistantApprovalPolicy | null | undefined,
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
