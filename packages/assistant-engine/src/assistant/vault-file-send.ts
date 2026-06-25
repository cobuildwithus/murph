import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type {
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
  HostedActionApprovalReturnContactKind,
} from '@murphai/hosted-execution/action-approval'
import {
  assistantOutboxIntentSchema,
  assistantVaultFileMaxBytes,
  type AssistantOutboxIntent,
  type AssistantTurnTrigger,
  type AssistantVaultFileResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import {
  createAssistantVaultFileSendOutboxIntent,
  saveAssistantOutboxIntentIfUnchanged,
  type AssistantOutboxCreateIntentInput,
} from './outbox.js'

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
    filename: string
    intentId: string
  }
  & HostedActionApprovalResult

export async function requestAssistantVaultFileSend(input: {
  actionApprovalPort: AssistantActionApprovalPort
  actorId?: string | null
  bindingDelivery?: AssistantOutboxCreateIntentInput['bindingDelivery']
  channel?: string | null
  deliveryIdempotencyKey: string
  deliverySource?: AssistantOutboxCreateIntentInput['deliverySource']
  explicitTarget?: string | null
  identityId?: string | null
  ref: string
  replyToMessageId?: string | null
  sessionId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  turnId: string
  turnTrigger?: AssistantTurnTrigger | null
  vault: string
}): Promise<AssistantVaultFileSendRequestResult> {
  const file = await resolveAssistantVaultFileResponseMedia({
    ref: input.ref,
    vaultRoot: input.vault,
  })
  const deliveryIdempotencyKey = buildAssistantVaultFileDeliveryIdempotencyKey({
    baseKey: input.deliveryIdempotencyKey,
    file,
  })
  const intent = await createAssistantVaultFileSendOutboxIntent({
    actorId: input.actorId ?? null,
    bindingDelivery: input.bindingDelivery ?? null,
    channel: input.channel ?? null,
    dedupeToken: deliveryIdempotencyKey,
    deliveryIdempotencyKey,
    deliverySource: input.deliverySource ?? null,
    deliveryTransportIdempotent: true,
    explicitTarget: input.explicitTarget ?? null,
    file,
    identityId: input.identityId ?? null,
    message: `Attached: ${file.filename}`,
    replyToMessageId: input.replyToMessageId ?? null,
    sessionId: input.sessionId,
    subject: null,
    threadId: input.threadId ?? null,
    threadIsDirect: input.threadIsDirect ?? null,
    turnId: input.turnId,
    turnTrigger: input.turnTrigger ?? null,
    vault: input.vault,
  })
  const approval = await input.actionApprovalPort.request(
    buildAssistantVaultFileSendApprovalRequest(intent),
  )
  const nextIntent = applyAssistantVaultFileSendApprovalResult({
    approval,
    intent,
    now: new Date(),
  })
  if (nextIntent !== intent) {
    await saveAssistantOutboxIntentIfUnchanged({
      expectedDedupeKey: intent.dedupeKey,
      expectedStatus: intent.status,
      expectedUpdatedAt: intent.updatedAt,
      intent: nextIntent,
      vault: input.vault,
    })
  }

  return {
    approvalId: approval.approvalId,
    filename: file.filename,
    intentId: intent.intentId,
    ...(approval.status === 'pending'
      ? {
          approvalUrl: approval.approvalUrl,
          expiresAt: approval.expiresAt,
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
  const actionFingerprint = sha256Hex(JSON.stringify([
    'murph.vault-file-send-approval.v1',
    intent.intentId,
    intent.dedupeKey,
    intent.deliveryIdempotencyKey,
    file.ref,
    file.sha256,
    file.filename,
    file.contentType,
    file.sizeBytes,
    intent.message,
    intent.subject,
    intent.channel,
    intent.targetFingerprint,
  ]))

  return {
    actionFingerprint,
    actionId: intent.intentId,
    actionKind: ASSISTANT_VAULT_FILE_SEND_ACTION_KIND,
    presentation: {
      body: `Murph will send “${file.filename}” (${formatByteCount(file.sizeBytes)}) to your current iMessage conversation. This approval applies only to this file and destination.`,
      title: 'Send a file from your vault?',
    },
    returnContactKind: resolveAssistantVaultFileSendReturnContactKind(intent.channel),
  }
}

function resolveAssistantVaultFileSendReturnContactKind(
  channel: string | null | undefined,
): HostedActionApprovalReturnContactKind | null {
  switch (channel?.trim().toLowerCase()) {
    case 'linq':
      return 'text'
    case 'telegram':
      return 'telegram'
    case 'email':
      return 'email'
    default:
      return null
  }
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
      return assistantOutboxIntentSchema.parse({
        ...input.intent,
        lastError: null,
        nextAttemptAt: updatedAt,
        status: 'pending',
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

function buildAssistantVaultFileDeliveryIdempotencyKey(input: {
  baseKey: string
  file: AssistantVaultFileResponseMedia
}): string {
  const baseKey = input.baseKey.trim()
  if (!baseKey) {
    throw new VaultCliError(
      'ASSISTANT_HOSTED_DELIVERY_IDEMPOTENCY_KEY_REQUIRED',
      'Secure vault-file delivery requires a deterministic hosted delivery id.',
    )
  }
  return `vault-file:${sha256Hex(JSON.stringify([
    'murph.vault-file-delivery-id.v1',
    baseKey,
    input.file.ref,
    input.file.sha256,
  ]))}`
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
      ref,
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.byteLength,
    },
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
