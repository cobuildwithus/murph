import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type {
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from '@murphai/hosted-execution/action-approval'
import {
  assistantOutboxIntentSchema,
  assistantVaultFileMaxBytes,
  type AssistantOutboxIntent,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import {
  buildAssistantOutboxPersistedTarget,
  buildAssistantOutboxRawTargetIdentity,
  hashAssistantOutboxTargetFingerprint,
} from './outbox/intents.js'
import {
  normalizeNullableString,
} from './shared.js'
import {
  resolveAssistantHostedReturnContactKind,
} from './return-contact-kind.js'

export const ASSISTANT_VAULT_FILE_SEND_ACTION_KIND = 'vault.file.send.v1'

const ASSISTANT_VAULT_FILE_CONTENT_TYPES = new Map<string, string>([
  ['.csv', 'text/csv'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.ics', 'text/calendar'],
  ['.json', 'application/json'],
  ['.md', 'text/markdown'],
  ['.pdf', 'application/pdf'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.rtf', 'text/rtf'],
  ['.txt', 'text/plain'],
  ['.vcf', 'text/vcard'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.zip', 'application/zip'],
])

export interface AssistantActionApprovalPort {
  request(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>
}

export type AssistantVaultFileSendRequestResult =
  & {
    file: AssistantVaultFileResponseMedia
    filename: string
  }
  & HostedActionApprovalResult

export async function requestAssistantVaultFileSend(input: {
  actionApprovalPort: AssistantActionApprovalPort
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliverySource?: AssistantOutboxIntent['deliverySource']
  explicitTarget?: string | null
  identityId?: string | null
  ref: string
  replyToMessageId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}): Promise<AssistantVaultFileSendRequestResult> {
  const targetFingerprint = requireAssistantVaultFileSendTargetFingerprint(input)
  const file = await resolveAssistantVaultFileResponseMedia({
    ref: input.ref,
    vaultRoot: input.vault,
  })
  const approval = await input.actionApprovalPort.request(
    buildAssistantVaultFileSendApprovalRequestForTarget({
      channel: input.channel ?? null,
      file,
      targetFingerprint,
      threadIsDirect: input.threadIsDirect ?? null,
    }),
  )

  const approvedFile = approval.status === 'approved'
    ? applyAssistantVaultFileApprovalToMedia({ approval, file })
    : file
  return {
    approvalId: approval.approvalId,
    file: approvedFile,
    filename: file.filename,
    ...(approval.status === 'pending'
      ? {
          approvalUrl: approval.approvalUrl,
          expiresAt: approval.expiresAt,
          status: approval.status,
        }
      : approval.status === 'approved'
        ? {
            approvalGeneration: approval.approvalGeneration,
            status: approval.status,
          }
        : { status: approval.status }),
  }
}

export async function resolveAssistantVaultFileResponseMedia(input: {
  ref: string
  vaultRoot: string
}): Promise<AssistantVaultFileResponseMedia> {
  return (await readAssistantVaultFileSnapshot(input)).file
}

export async function readVerifiedAssistantVaultFileBytes(input: {
  file: AssistantVaultFileResponseMedia
  vaultRoot: string
}): Promise<Uint8Array> {
  const snapshot = await readAssistantVaultFileSnapshot({
    ref: input.file.ref,
    vaultRoot: input.vaultRoot,
  })
  if (
    snapshot.file.sha256 !== input.file.sha256
    || snapshot.file.sizeBytes !== input.file.sizeBytes
    || snapshot.file.filename !== input.file.filename
    || snapshot.file.contentType !== input.file.contentType
  ) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_CHANGED_AFTER_APPROVAL',
      'The vault file changed after approval and was not sent.',
    )
  }
  return snapshot.bytes
}

export function readAssistantVaultFileMedia(
  intent: AssistantOutboxIntent,
): AssistantVaultFileResponseMedia | null {
  const vaultFiles = intent.media.filter(
    (item): item is AssistantVaultFileResponseMedia => item.kind === 'vault_file',
  )
  if (vaultFiles.length === 0) {
    return null
  }
  if (vaultFiles.length !== 1 || intent.media.length !== 1) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_MEDIA_INVALID',
      'Vault-file delivery must contain exactly one vault file and no other media.',
    )
  }
  if (intent.operation !== null || intent.channel?.trim().toLowerCase() !== 'linq') {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_INTENT_INVALID',
      'Vault-file delivery requires a standard Linq message intent.',
    )
  }
  return vaultFiles[0]
}

export function buildAssistantVaultFileSendApprovalRequest(
  intent: AssistantOutboxIntent,
): HostedActionApprovalRequest {
  const file = readAssistantVaultFileMedia(intent)
  if (!file) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_MEDIA_REQUIRED',
      'Vault-file approval requires one vault-file media descriptor.',
    )
  }
  return buildAssistantVaultFileSendApprovalRequestForTarget({
    channel: intent.channel,
    file,
    targetFingerprint: requireAssistantVaultFileSendTargetFingerprint(intent),
    threadIsDirect: intent.threadIsDirect,
  })
}

export function buildAssistantVaultFileSendApprovalRequestForTarget(input: {
  channel?: string | null
  file: AssistantVaultFileResponseMedia
  targetFingerprint?: string | null
  threadIsDirect?: boolean | null
}): HostedActionApprovalRequest {
  const targetFingerprint = normalizeNullableString(input.targetFingerprint)
  if (!targetFingerprint) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_TARGET_UNAVAILABLE',
      'Secure vault-file approval requires a concrete destination.',
    )
  }
  const channel = normalizeNullableString(input.channel)
  const actionIdentity = sha256Hex(JSON.stringify([
    'murph.vault-file-send-action.v2',
    input.file.ref,
    input.file.sha256,
    input.file.filename,
    input.file.contentType,
    input.file.sizeBytes,
    channel,
    targetFingerprint,
  ]))
  const actionFingerprint = sha256Hex(JSON.stringify([
    'murph.vault-file-send-approval.v2',
    actionIdentity,
    input.file.ref,
    input.file.sha256,
    input.file.filename,
    input.file.contentType,
    input.file.sizeBytes,
    channel,
    targetFingerprint,
  ]))

  return {
    actionFingerprint,
    actionId: `vault-file-send:${actionIdentity}`,
    actionKind: ASSISTANT_VAULT_FILE_SEND_ACTION_KIND,
    presentation: {
      body: `Murph will send “${input.file.filename}” (${formatByteCount(input.file.sizeBytes)}) to your current iMessage conversation. This approval applies only to this file and destination.`,
      title: 'Send a file from your vault?',
    },
    returnContactKind: resolveAssistantHostedReturnContactKind(channel, {
      threadIsDirect: input.threadIsDirect ?? null,
    }),
  }
}

export function resolveAssistantVaultFileSendTargetFingerprint(input: {
  actorId?: string | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliverySource?: AssistantOutboxIntent['deliverySource']
  explicitTarget?: string | null
  identityId?: string | null
  replyToMessageId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}): string | null {
  const persistedTarget = buildAssistantOutboxPersistedTarget({
    actorId: input.actorId ?? null,
    bindingDelivery: input.bindingDelivery === undefined
      ? undefined
      : input.bindingDelivery,
    channel: input.channel ?? null,
    deliverySource: null,
    explicitTarget: input.explicitTarget ?? null,
    identityId: input.identityId ?? null,
    replyToMessageId: null,
    threadId: input.threadId ?? null,
    threadIsDirect: input.threadIsDirect ?? null,
  })
  const bindingDeliveryTarget = persistedTarget.bindingDelivery
    ? normalizeNullableString(persistedTarget.bindingDelivery.target)
    : null
  if (
    !bindingDeliveryTarget
    && !normalizeNullableString(persistedTarget.explicitTarget)
  ) {
    return null
  }
  return hashAssistantOutboxTargetFingerprint(
    buildAssistantOutboxRawTargetIdentity(persistedTarget),
  )
}

function requireAssistantVaultFileSendTargetFingerprint(input: Parameters<
  typeof resolveAssistantVaultFileSendTargetFingerprint
>[0]): string {
  const targetFingerprint = resolveAssistantVaultFileSendTargetFingerprint(input)
  if (!targetFingerprint) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_TARGET_UNAVAILABLE',
      'Secure vault-file approval requires a concrete destination.',
    )
  }
  return targetFingerprint
}

export function applyAssistantVaultFileSendApprovalResult(input: {
  approval: HostedActionApprovalResult
  intent: AssistantOutboxIntent
  now: Date
}): AssistantOutboxIntent {
  readAssistantVaultFileMedia(input.intent)
  if (
    input.intent.status === 'sent'
    || input.intent.status === 'failed'
    || input.intent.status === 'abandoned'
  ) {
    return input.intent
  }

  const updatedAt = input.now.toISOString()
  switch (input.approval.status) {
    case 'approved':
      if (input.intent.status !== 'awaiting_approval') {
        return input.intent
      }
      return approveAssistantVaultFileSendIntent({
        approval: input.approval,
        intent: input.intent,
        updatedAt,
      })
    case 'pending':
      if (input.intent.status === 'sending') {
        throw new VaultCliError(
          'ASSISTANT_VAULT_FILE_APPROVAL_STATE_INVALID',
          'A sending vault-file intent must already be approved.',
        )
      }
      if (
        input.intent.status === 'awaiting_approval'
        && input.intent.nextAttemptAt === input.approval.expiresAt
        && input.intent.lastError === null
      ) {
        return input.intent
      }
      return assistantOutboxIntentSchema.parse({
        ...input.intent,
        lastError: null,
        nextAttemptAt: input.approval.expiresAt,
        status: 'awaiting_approval',
        updatedAt,
      })
    case 'denied':
    case 'expired':
      if (input.intent.status === 'sending') {
        throw new VaultCliError(
          'ASSISTANT_VAULT_FILE_APPROVAL_STATE_INVALID',
          'A sending vault-file intent cannot have a terminal refusal.',
        )
      }
      return assistantOutboxIntentSchema.parse({
        ...input.intent,
        lastError: {
          code: input.approval.status === 'denied'
            ? 'ASSISTANT_VAULT_FILE_APPROVAL_DENIED'
            : 'ASSISTANT_VAULT_FILE_APPROVAL_EXPIRED',
          message: input.approval.status === 'denied'
            ? 'Vault-file delivery was denied.'
            : 'Vault-file delivery approval expired.',
        },
        nextAttemptAt: null,
        status: 'abandoned',
        updatedAt,
      })
  }
}

function approveAssistantVaultFileSendIntent(input: {
  approval: Extract<HostedActionApprovalResult, { status: 'approved' }>
  intent: AssistantOutboxIntent
  updatedAt: string
}): AssistantOutboxIntent {
  if (!resolveAssistantVaultFileSendTargetFingerprint(input.intent)) {
    return assistantOutboxIntentSchema.parse({
      ...input.intent,
      lastError: {
        code: 'ASSISTANT_VAULT_FILE_TARGET_UNAVAILABLE',
        message: 'Approved vault-file delivery did not have a concrete destination.',
      },
      nextAttemptAt: null,
      status: 'abandoned',
      updatedAt: input.updatedAt,
    })
  }

  return assistantOutboxIntentSchema.parse({
    ...input.intent,
    media: input.intent.media.map((item) =>
      item.kind === 'vault_file'
        ? applyAssistantVaultFileApprovalToMedia({
            approval: input.approval,
            file: item,
          })
        : item
    ),
    lastError: null,
    nextAttemptAt: input.updatedAt,
    status: 'pending',
    updatedAt: input.updatedAt,
  })
}

export function deferAssistantVaultFileApprovalCheck(input: {
  intent: AssistantOutboxIntent
  now: Date
  retryAfterMs?: number
}): AssistantOutboxIntent {
  readAssistantVaultFileMedia(input.intent)
  if (
    input.intent.status === 'sent'
    || input.intent.status === 'failed'
    || input.intent.status === 'abandoned'
    || input.intent.status === 'sending'
  ) {
    return input.intent
  }

  const nextAttemptAt = new Date(
    input.now.getTime() + (input.retryAfterMs ?? 60_000),
  ).toISOString()
  const updatedAt = input.now.toISOString()
  return assistantOutboxIntentSchema.parse({
    ...input.intent,
    lastError: {
      code: 'ASSISTANT_VAULT_FILE_APPROVAL_UNAVAILABLE',
      message: 'Secure approval could not be checked yet.',
    },
    nextAttemptAt,
    status: 'awaiting_approval',
    updatedAt,
  })
}

async function readAssistantVaultFileSnapshot(input: {
  ref: string
  vaultRoot: string
}): Promise<{
  bytes: Uint8Array
  file: AssistantVaultFileResponseMedia
}> {
  const ref = normalizeVaultFileRef(input.ref)
  const absolutePath = await resolveAssistantVaultPath(
    input.vaultRoot,
    ref,
    'file path',
  )
  const metadata = await stat(absolutePath)
  if (!metadata.isFile()) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_NOT_REGULAR_FILE',
      'The requested vault path is not a regular file.',
    )
  }
  if (metadata.size <= 0 || metadata.size > assistantVaultFileMaxBytes) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_SIZE_UNSUPPORTED',
      `Vault files must be between 1 byte and ${assistantVaultFileMaxBytes} bytes.`,
    )
  }

  const bytes = await readFile(absolutePath)
  if (bytes.byteLength <= 0 || bytes.byteLength > assistantVaultFileMaxBytes) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_SIZE_UNSUPPORTED',
      `Vault files must be between 1 byte and ${assistantVaultFileMaxBytes} bytes.`,
    )
  }

  const filename = path.posix.basename(ref)
  return {
    bytes,
    file: {
      contentType: resolveAssistantVaultFileContentType(filename),
      filename,
      kind: 'vault_file',
      approvalGeneration: null,
      approvalId: null,
      ref,
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.byteLength,
    },
  }
}

function applyAssistantVaultFileApprovalToMedia(input: {
  approval: Extract<HostedActionApprovalResult, { status: 'approved' }>
  file: AssistantVaultFileResponseMedia
}): AssistantVaultFileResponseMedia {
  return {
    ...input.file,
    approvalGeneration: input.approval.approvalGeneration,
    approvalId: input.approval.approvalId,
  }
}

function normalizeVaultFileRef(value: string): string {
  const ref = value.trim().replace(/\\/gu, '/')
  const segments = ref.split('/')
  if (
    ref.length === 0
    || ref.length > 1024
    || ref.startsWith('/')
    || /^[A-Za-z]:/u.test(ref)
    || /[\u0000-\u001F\u007F]/u.test(ref)
    || segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..' || segment.startsWith('.'),
    )
  ) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_REF_INVALID',
      'Vault file refs must be normalized, non-hidden paths inside the vault.',
    )
  }
  return segments.join('/')
}

function resolveAssistantVaultFileContentType(filename: string): string {
  const extension = path.posix.extname(filename).toLowerCase()
  const contentType = ASSISTANT_VAULT_FILE_CONTENT_TYPES.get(extension)
  if (!contentType) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_TYPE_UNSUPPORTED',
      'This vault file type is not supported for secure delivery.',
    )
  }
  return contentType
}

function formatByteCount(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}
