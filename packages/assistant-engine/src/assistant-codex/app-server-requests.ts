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
const MAX_CODEX_INJECTED_FILE_BYTES = 50 * 1024 * 1024
const CODEX_INJECTED_FILE_DATA_URL_PATTERN = /^data:([^,]*?),(.*)$/su
const CODEX_INJECTED_FILE_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u

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

export type CodexAppServerInjectedContentPart =
  | {
      type: 'input_text'
      text: string
    }
  | {
      type: 'input_file'
      filename?: string
      file_data: string
    }

export interface CodexAppServerInjectedMessageItem {
  type: 'message'
  role: 'user'
  content: readonly CodexAppServerInjectedContentPart[]
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
    modelProvider: normalizeNullableString(input.input.modelProvider),
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

export function buildCodexThreadInjectItemsParams(input: {
  items: readonly CodexAppServerInjectedMessageItem[]
  providerSessionId: string
}): Record<string, unknown> {
  return {
    items: validateCodexInjectedMessageItems(input.items),
    threadId: assertCodexRpcIdentifier({
      field: 'threadId',
      value: input.providerSessionId,
    }),
  }
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

function validateCodexInjectedMessageItems(
  items: readonly CodexAppServerInjectedMessageItem[],
): CodexAppServerInjectedMessageItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Codex app-server thread/inject_items requires at least one injected message item.',
      {
        retryable: false,
      },
    )
  }

  return items.map((item, index) => {
    if (!item || item.type !== 'message' || item.role !== 'user') {
      throw new VaultCliError(
        'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
        `Codex app-server injected item ${index + 1} must be a user message item.`,
        {
          retryable: false,
        },
      )
    }

    if (!Array.isArray(item.content) || item.content.length === 0) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
        `Codex app-server injected message ${index + 1} must include content.`,
        {
          retryable: false,
        },
      )
    }

    let fileIndex = 0
    const content = item.content.map((
      part: CodexAppServerInjectedContentPart,
      partIndex: number,
    ) => {
      const currentFileIndex = fileIndex
      if (part?.type === 'input_file') {
        fileIndex += 1
      }
      return validateCodexInjectedContentPart(
        part,
        index,
        partIndex,
        currentFileIndex,
      )
    })

    return {
      type: 'message',
      role: 'user',
      content,
    }
  })
}

function validateCodexInjectedContentPart(
  part: CodexAppServerInjectedContentPart,
  itemIndex: number,
  partIndex: number,
  fileIndex: number,
): CodexAppServerInjectedContentPart {
  if (!part || typeof part !== 'object') {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      `Codex app-server injected content ${itemIndex + 1}.${partIndex + 1} must be an object.`,
      {
        retryable: false,
      },
    )
  }

  if (part.type === 'input_text') {
    if (typeof part.text === 'string' && part.text.trim().length > 0) {
      return {
        type: 'input_text',
        text: part.text,
      }
    }
  }

  if (part.type === 'input_file') {
    const fileData =
      typeof part.file_data === 'string' ? part.file_data.trim() : ''
    if (fileData.length > 0) {
      return {
        type: 'input_file',
        filename: buildSyntheticCodexInjectedFilename(fileIndex),
        file_data: validateCodexInjectedFileData(fileData),
      }
    }
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
    `Codex app-server injected content ${itemIndex + 1}.${partIndex + 1} is malformed.`,
    {
      retryable: false,
    },
  )
}

function validateCodexInjectedFileData(fileData: string): string {
  const match = CODEX_INJECTED_FILE_DATA_URL_PATTERN.exec(fileData)
  if (!match) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Codex app-server injected file data must be a base64 data URL.',
      {
        retryable: false,
      },
    )
  }

  const metadata = match[1] ?? ''
  const metadataParts = metadata
    .split(';')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)
  const mediaType = metadataParts[0] ?? ''
  if (mediaType !== 'application/pdf' && mediaType !== 'application/x-pdf') {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Codex app-server injected file data currently supports PDF data URLs only.',
      {
        retryable: false,
      },
    )
  }
  if (!metadataParts.includes('base64')) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Codex app-server injected file data URLs must use base64 encoding.',
      {
        retryable: false,
      },
    )
  }

  const payload = match[2] ?? ''
  if (
    !CODEX_INJECTED_FILE_BASE64_PATTERN.test(payload) ||
    payload.length % 4 !== 0
  ) {
    throw invalidCodexInjectedFileBase64()
  }

  const decoded = Buffer.from(payload, 'base64')
  if (decoded.byteLength === 0 || decoded.toString('base64') !== payload) {
    throw invalidCodexInjectedFileBase64()
  }
  if (decoded.byteLength > MAX_CODEX_INJECTED_FILE_BYTES) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Codex app-server injected file data exceeds the per-file size limit.',
      {
        maxBytes: MAX_CODEX_INJECTED_FILE_BYTES,
        retryable: false,
      },
    )
  }

  return `data:${mediaType};base64,${payload}`
}

function buildSyntheticCodexInjectedFilename(partIndex: number): string {
  return `attachment-${String(partIndex + 1).padStart(2, '0')}.pdf`
}

function invalidCodexInjectedFileBase64(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
    'Codex app-server injected file data URL contains invalid base64.',
    {
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
