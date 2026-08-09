import { createHash } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, open, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type {
  HostedActionApprovalObservation,
  HostedActionApprovalRequest,
  HostedActionApprovalResult,
} from '@murphai/hosted-execution/action-approval'
import {
  buildHostedActionApprovalCycleOwnerKey,
  parseHostedActionApprovalCycleOwnerKey,
} from '@murphai/hosted-execution/action-approval'
import {
  assistantOutboxIntentSchema,
  assistantVaultFileMaxBytes,
  assistantVaultImageMaxBytes,
  type AssistantOutboxIntent,
  type AssistantTurnTrigger,
  type AssistantVaultFileResponseMedia,
  type AssistantVaultImageResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isNormalizedAssistantVaultFileRef,
} from '@murphai/runtime-state/assistant-generated-deliveries'
import {
  adoptAssistantStateFile,
  adoptAssistantStateFileIntoExclusiveName,
} from '@murphai/runtime-state/node/assistant-state-fs'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'
import { readMaterializedExportPackReceipt } from '@murphai/vault-usecases/export-packs'

import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
} from './outbox.js'
import {
  buildAssistantOutboxPersistedTarget,
  buildAssistantOutboxRawTargetIdentity,
  hashAssistantOutboxTargetFingerprint,
} from './outbox/intents.js'
import { isMissingFileError, normalizeNullableString } from './shared.js'
import { resolveAssistantStatePaths } from './store.js'
import {
  resolveAssistantHostedReturnContactKind,
} from './return-contact-kind.js'
import {
  buildAssistantGeneratedDeliveryOwnedRef,
  isAssistantGeneratedDeliveryRef,
  resolveSupportedAssistantVaultFileContentType,
} from './generated-delivery-files.js'

export const ASSISTANT_VAULT_FILE_SEND_ACTION_KIND = 'vault.file.send.v1'

const ASSISTANT_VAULT_FILE_APPROVAL_FALLBACK_LEAD_MS = 10 * 60 * 1_000

export interface AssistantActionApprovalPort {
  read(input: HostedActionApprovalRequest): Promise<HostedActionApprovalObservation>
  request(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>
}

export type AssistantVaultFileSendRequestResult =
  & {
    filename: string
  }
  & HostedActionApprovalResult

export async function requestAssistantVaultFileSend(input: {
  actionApprovalPort: AssistantActionApprovalPort
  actorId?: string | null
  answeredMailboxItemIds?: readonly string[] | null
  bindingDelivery?: AssistantOutboxIntent['bindingDelivery']
  channel?: string | null
  deliverySource?: AssistantOutboxIntent['deliverySource']
  deliveryTransportIdempotent?: boolean
  explicitTarget?: string | null
  identityId?: string | null
  ref: string
  retireExportPackIds?: readonly string[]
  replyToMessageId?: string | null
  sessionId: string
  threadId?: string | null
  threadIsDirect?: boolean | null
  toolCallId?: string | null
  turnId: string
  turnTrigger?: AssistantTurnTrigger | null
  vault: string
}): Promise<AssistantVaultFileSendRequestResult> {
  const targetFingerprint = requireAssistantVaultFileSendTargetFingerprint(input)
  const normalizedRef = normalizeVaultFileRef(input.ref)
  const generatedDelivery = isAssistantGeneratedDeliveryRef(normalizedRef)
    ? buildAssistantGeneratedDeliveryIdentity({
        ref: normalizedRef,
        sessionId: input.sessionId,
        toolCallId: normalizeNullableString(input.toolCallId),
        turnId: input.turnId,
      })
    : null
  const mediaRef = generatedDelivery?.ownedRef ?? normalizedRef
  const retireExportPackIds = normalizeRetireExportPackIds({
    generatedDelivery,
    packIds: input.retireExportPackIds,
  })
  if (
    generatedDelivery !== null
    && await hasActivePriorTurnGeneratedVaultFileSendForTarget({
      actionApprovalPort: input.actionApprovalPort,
      candidateRef: mediaRef,
      intents: await listExistingAssistantOutboxIntents(input.vault),
      targetFingerprint,
      turnId: input.turnId,
    })
  ) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_SEND_ALREADY_ACTIVE',
      'A vault-file delivery for this conversation is already active. Let the '
        + 'runtime finish that exact send before preparing another one.',
    )
  }
  if (generatedDelivery !== null) {
    await consumeAssistantGeneratedDeliveryStagingRef({
      ...generatedDelivery,
      ref: normalizedRef,
      vaultRoot: input.vault,
    })
  }
  const resolvedFile = await resolveAssistantVaultFileResponseMedia({
    ...(generatedDelivery === null
      ? {}
      : { displayFilename: generatedDelivery.displayFilename }),
    ref: mediaRef,
    vaultRoot: input.vault,
  })
  const retireExportPacks = retireExportPackIds
    ? (await Promise.allSettled(
        retireExportPackIds.map((packId) =>
          readMaterializedExportPackReceipt(input.vault, packId)
        ),
      )).flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    : []
  const file: AssistantVaultFileResponseMedia = retireExportPacks.length > 0
    ? { ...resolvedFile, retireExportPacks }
    : resolvedFile
  const approval = await input.actionApprovalPort.request(
    buildAssistantVaultFileSendApprovalRequestForTarget({
      channel: input.channel ?? null,
      file,
      targetFingerprint,
      threadIsDirect: input.threadIsDirect ?? null,
    }),
  )

  if (approval.status === 'pending') {
    const deliveryIdempotencyKey = buildAssistantVaultFileDeliveryIdempotencyKey({
      approvalId: approval.approvalId,
      expiresAt: approval.expiresAt,
    })
    await createAssistantOutboxIntent({
      actorId: input.actorId ?? null,
      answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
      bindingDelivery: input.bindingDelivery,
      channel: input.channel ?? null,
      dedupeToken: deliveryIdempotencyKey,
      deliveryIdempotencyKey,
      deliverySource: input.deliverySource ?? null,
      deliveryTransportIdempotent: input.deliveryTransportIdempotent,
      explicitTarget: input.explicitTarget ?? null,
      identityId: input.identityId ?? null,
      initialState: {
        nextAttemptAt: buildAssistantVaultFileApprovalFallbackWakeAt(
          approval.expiresAt,
        ),
        status: 'awaiting_approval',
      },
      media: [file],
      message: file.filename,
      replyToMessageId: input.replyToMessageId ?? null,
      sessionId: input.sessionId,
      threadId: input.threadId ?? null,
      threadIsDirect: input.threadIsDirect ?? null,
      turnId: input.turnId,
      turnTrigger: input.turnTrigger ?? null,
      vault: input.vault,
    })
  }

  return {
    approvalId: approval.approvalId,
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

function normalizeRetireExportPackIds(input: {
  generatedDelivery: { displayFilename: string; ownedRef: string } | null
  packIds?: readonly string[]
}): string[] | null {
  if (input.packIds === undefined) {
    return null
  }
  if (
    input.generatedDelivery === null
    || resolveSupportedAssistantVaultFileContentType(
      input.generatedDelivery.displayFilename,
    ) !== 'application/zip'
    || input.packIds.length < 1
    || input.packIds.length > 20
    || input.packIds.some((packId) => !/^[A-Za-z0-9_-]+$/u.test(packId))
    || new Set(input.packIds).size !== input.packIds.length
  ) {
    throw new VaultCliError(
      'ASSISTANT_EXPORT_PACK_RETIREMENT_INVALID',
      'Export-pack retirement requires an assistant-generated ZIP.',
    )
  }
  return [...input.packIds]
}

export function buildAssistantVaultFileDeliveryIdempotencyKey(input: {
  approvalId: string
  expiresAt: string
}): string {
  return buildHostedActionApprovalCycleOwnerKey(input)
}

export function buildAssistantVaultFileApprovalFallbackWakeAt(
  expiresAt: string,
): string {
  return new Date(
    Date.parse(expiresAt) - ASSISTANT_VAULT_FILE_APPROVAL_FALLBACK_LEAD_MS,
  ).toISOString()
}

export async function resolveAssistantVaultFileResponseMedia(input: {
  displayFilename?: string
  ref: string
  vaultRoot: string
}): Promise<AssistantVaultFileResponseMedia> {
  return (await readAssistantVaultFileSnapshot(input)).file
}

// Consuming the model-selected staging file into a deterministic per-tool-call
// name happens before hashing or approval. The owned ref is keyed on the call
// identity, so distinct sends reusing one friendly name never collide and an
// exact re-delivery of the same call idempotently re-adopts its own bytes.
// Accepted limitation (see agent-docs/references/hosted-runtime-protocol.md):
// the key is attempt-scoped, so a model in-turn recovery after a pre-persist
// failure arrives as a new provider call with a new toolCallId and does not
// recover the earlier owned file, which is then pruned as unclaimed. The
// exposed bytes are a regenerable one-time artifact only; the persisted-outbox
// retry path is unaffected.
function buildAssistantGeneratedDeliveryIdentity(input: {
  ref: string
  sessionId: string
  toolCallId: string | null
  turnId: string
}): { displayFilename: string; ownedRef: string } {
  const displayFilename = path.posix.basename(input.ref)
  resolveAssistantVaultFileContentType(displayFilename)
  if (input.toolCallId === null) {
    throw new VaultCliError(
      'ASSISTANT_GENERATED_DELIVERY_IDENTITY_REQUIRED',
      'Generated delivery files require a provider tool-call identity before '
        + 'they can be sent.',
    )
  }
  const ownedRef = buildAssistantGeneratedDeliveryOwnedRef({
    displayFilename,
    ref: input.ref,
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    turnId: input.turnId,
  })
  return { displayFilename, ownedRef }
}

async function consumeAssistantGeneratedDeliveryStagingRef(input: {
  displayFilename: string
  ownedRef: string
  ref: string
  vaultRoot: string
}): Promise<void> {
  const sourcePath = await resolveAssistantVaultPath(
    input.vaultRoot,
    input.ref,
    'file path',
  )
  const targetPath = await resolveAssistantVaultPath(
    input.vaultRoot,
    input.ownedRef,
    'file path',
  )
  await adoptAssistantGeneratedDeliveryIntoStableName({
    sourcePath,
    targetPath,
  })
}

async function adoptAssistantGeneratedDeliveryIntoStableName(input: {
  sourcePath: string
  targetPath: string
}): Promise<void> {
  await adoptAssistantStateFileIntoExclusiveName(
    input.sourcePath,
    input.targetPath,
  )
}

export async function readVerifiedAssistantVaultFileBytes(input: {
  file: AssistantVaultFileResponseMedia
  vaultRoot: string
}): Promise<Uint8Array> {
  const snapshot = await readAssistantVaultFileSnapshot({
    displayFilename: input.file.filename,
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

export async function readVerifiedAssistantVaultImageBytes(input: {
  image: AssistantVaultImageResponseMedia
  vaultRoot: string
}): Promise<Uint8Array> {
  const snapshot = await readAssistantVaultBytesSnapshot({
    maxBytes: assistantVaultImageMaxBytes,
    ref: input.image.ref,
    vaultRoot: input.vaultRoot,
  })
  const contentType = detectAssistantVaultImageContentType(snapshot.bytes)
  if (
    sha256Hex(snapshot.bytes) !== input.image.sha256
    || snapshot.bytes.byteLength !== input.image.sizeBytes
    || snapshot.filename !== input.image.filename
    || contentType !== input.image.contentType
  ) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_IMAGE_CHANGED_AFTER_CAPTURE',
      'The private image changed after capture and was not sent.',
    )
  }
  return snapshot.bytes
}

export async function resolveAssistantVaultImageResponseMedia(input: {
  alt?: string | null
  ref: string
  source?: string | null
  vaultRoot: string
}): Promise<AssistantVaultImageResponseMedia> {
  const snapshot = await readAssistantVaultBytesSnapshot({
    maxBytes: assistantVaultImageMaxBytes,
    ref: input.ref,
    vaultRoot: input.vaultRoot,
  })
  const contentType = detectAssistantVaultImageContentType(snapshot.bytes)
  if (!contentType) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_IMAGE_TYPE_UNSUPPORTED',
      'The selected private image is not a supported image file.',
    )
  }
  return {
    alt: input.alt ?? null,
    contentType,
    filename: snapshot.filename,
    kind: 'vault_image',
    ref: snapshot.ref,
    sha256: sha256Hex(snapshot.bytes),
    sizeBytes: snapshot.bytes.byteLength,
    source: input.source ?? null,
  }
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
  const returnContactKind = resolveAssistantHostedReturnContactKind(channel, {
    threadIsDirect: input.threadIsDirect ?? null,
  })
  const actionIdentity = sha256Hex(JSON.stringify([
    'murph.vault-file-send-action.v3',
    input.file.ref,
    input.file.sha256,
    input.file.filename,
    input.file.contentType,
    input.file.sizeBytes,
    channel,
    targetFingerprint,
    returnContactKind,
  ]))
  const actionFingerprint = sha256Hex(JSON.stringify([
    'murph.vault-file-send-approval.v3',
    actionIdentity,
    input.file.ref,
    input.file.sha256,
    input.file.filename,
    input.file.contentType,
    input.file.sizeBytes,
    channel,
    targetFingerprint,
    returnContactKind,
  ]))

  return {
    actionFingerprint,
    actionId: `vault-file-send:${actionIdentity}`,
    actionKind: ASSISTANT_VAULT_FILE_SEND_ACTION_KIND,
    presentation: {
      body: `Murph will send “${input.file.filename}” (${formatByteCount(input.file.sizeBytes)}) to your current iMessage conversation. This approval applies only to this file and destination.`,
      title: 'Send a file from your vault?',
    },
    returnContactKind,
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
    buildAssistantOutboxRawTargetIdentity({
      actorId: null,
      bindingDelivery: persistedTarget.bindingDelivery,
      channel: persistedTarget.channel,
      deliverySource: null,
      explicitTarget: persistedTarget.explicitTarget,
      identityId: null,
      replyToMessageId: null,
      threadId: null,
    }),
  )
}

export async function hasActivePriorTurnGeneratedVaultFileSendForTarget(input: {
  actionApprovalPort: AssistantActionApprovalPort
  candidateRef: string
  intents: readonly AssistantOutboxIntent[]
  targetFingerprint: string
  turnId: string
}): Promise<boolean> {
  const targetFingerprint = normalizeNullableString(input.targetFingerprint)
  if (!targetFingerprint) {
    return false
  }
  if (!isAssistantGeneratedDeliveryRef(input.candidateRef)) {
    return false
  }
  const matchingIntents = input.intents.filter((intent) => {
    const vaultFiles = intent.media
      .filter((media) => media.kind === 'vault_file')
      .filter((media) => isAssistantGeneratedDeliveryRef(media.ref))
    const isExactRefRetry = vaultFiles.length === 1
      && vaultFiles[0]?.ref === input.candidateRef
    return intent.status !== 'sent'
      && intent.status !== 'failed'
      && intent.status !== 'abandoned'
      && intent.turnId !== input.turnId
      && vaultFiles.length > 0
      && !isExactRefRetry
      && resolveAssistantVaultFileSendTargetFingerprint(intent)
        === targetFingerprint
  })
  for (const intent of matchingIntents) {
    if (intent.status !== 'awaiting_approval') {
      return true
    }
    const expectedCycle = parseHostedActionApprovalCycleOwnerKey(
      intent.deliveryIdempotencyKey,
    )
    if (!expectedCycle) {
      continue
    }
    const approval = await input.actionApprovalPort.read(
      buildAssistantVaultFileSendApprovalRequest(intent),
    )
    if (
      approval.status === 'approved'
      && approval.approvalId === expectedCycle.approvalId
      && approval.cycleOwnerKey === expectedCycle.ownerKey
    ) {
      return true
    }
  }
  return false
}

async function listExistingAssistantOutboxIntents(
  vault: string,
): Promise<AssistantOutboxIntent[]> {
  const { outboxDirectory } = resolveAssistantStatePaths(vault)
  try {
    if (!(await lstat(outboxDirectory)).isDirectory()) {
      return []
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
  return listAssistantOutboxIntents(vault)
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
      code: 'ASSISTANT_VAULT_FILE_APPROVAL_CHECK_DEFERRED',
      diagnosticContext: {
        assistantDeliveryFailureClass: 'blocked',
        assistantDeliveryResumeTrigger: 'approval_state_change',
        retryable: false,
      },
      message: 'Secure vault-file approval could not be checked yet.',
    },
    nextAttemptAt,
    status: 'awaiting_approval',
    updatedAt,
  })
}

async function readAssistantVaultFileSnapshot(input: {
  displayFilename?: string
  ref: string
  vaultRoot: string
}): Promise<{
  bytes: Uint8Array
  file: AssistantVaultFileResponseMedia
}> {
  const snapshot = await readAssistantVaultBytesSnapshot({
    maxBytes: assistantVaultFileMaxBytes,
    ref: input.ref,
    vaultRoot: input.vaultRoot,
  })
  return {
    bytes: snapshot.bytes,
    file: {
      contentType: resolveAssistantVaultFileContentType(snapshot.filename),
      filename: input.displayFilename ?? snapshot.filename,
      kind: 'vault_file',
      approvalGeneration: null,
      approvalId: null,
      ref: snapshot.ref,
      sha256: sha256Hex(snapshot.bytes),
      sizeBytes: snapshot.bytes.byteLength,
    },
  }
}

async function readAssistantVaultBytesSnapshot(input: {
  maxBytes: number
  ref: string
  vaultRoot: string
}): Promise<{
  bytes: Uint8Array
  filename: string
  ref: string
}> {
  const ref = normalizeVaultFileRef(input.ref)
  const absolutePath = await resolveAssistantVaultPath(
    input.vaultRoot,
    ref,
    'file path',
  )
  let metadata: Stats
  let bytes: Uint8Array
  if (isAssistantGeneratedDeliveryRef(ref)) {
    const snapshot = await readAdoptedAssistantGeneratedDeliveryFile({
      absolutePath,
      ref,
      vaultRoot: input.vaultRoot,
    })
    metadata = snapshot.metadata
    bytes = snapshot.bytes
  } else {
    metadata = await stat(absolutePath)
    assertAssistantVaultFileMetadataSupported(metadata, input.maxBytes)
    bytes = await readFile(absolutePath)
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > input.maxBytes) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_SIZE_UNSUPPORTED',
      `Vault files must be between 1 byte and ${input.maxBytes} bytes.`,
    )
  }

  const filename = path.posix.basename(ref)
  return {
    bytes,
    filename,
    ref,
  }
}

async function readAdoptedAssistantGeneratedDeliveryFile(input: {
  absolutePath: string
  ref: string
  vaultRoot: string
}): Promise<{
  bytes: Uint8Array
  metadata: Stats
}> {
  await adoptAssistantStateFile(input.absolutePath)
  const fileHandle = await open(
    input.absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const openedMetadata = await fileHandle.stat()
    assertAssistantVaultFileMetadataSupported(openedMetadata)
    assertAdoptedAssistantGeneratedDeliveryMetadata(openedMetadata)
    await assertAssistantGeneratedDeliveryPathMatchesHandle({
      ...input,
      handleMetadata: openedMetadata,
    })

    const bytes = await fileHandle.readFile()
    const readMetadata = await fileHandle.stat()
    if (!assistantVaultFileStatsMatch(openedMetadata, readMetadata)) {
      throw assistantVaultFileChangedDuringReadError()
    }
    assertAdoptedAssistantGeneratedDeliveryMetadata(readMetadata)
    await assertAssistantGeneratedDeliveryPathMatchesHandle({
      ...input,
      handleMetadata: readMetadata,
    })
    return {
      bytes,
      metadata: readMetadata,
    }
  } finally {
    await fileHandle.close()
  }
}

async function assertAssistantGeneratedDeliveryPathMatchesHandle(input: {
  absolutePath: string
  handleMetadata: Stats
  ref: string
  vaultRoot: string
}): Promise<void> {
  const resolvedPath = await resolveAssistantVaultPath(
    input.vaultRoot,
    input.ref,
    'file path',
  )
  if (resolvedPath !== input.absolutePath) {
    throw assistantVaultFileChangedDuringReadError()
  }
  const pathMetadata = await lstat(resolvedPath)
  if (
    pathMetadata.isSymbolicLink()
    || !pathMetadata.isFile()
    || !assistantVaultFileIdentityMatches(input.handleMetadata, pathMetadata)
  ) {
    throw assistantVaultFileChangedDuringReadError()
  }
  assertAdoptedAssistantGeneratedDeliveryMetadata(pathMetadata)
}

function assertAssistantVaultFileMetadataSupported(
  metadata: Stats,
  maxBytes = assistantVaultFileMaxBytes,
): void {
  if (!metadata.isFile()) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_NOT_REGULAR_FILE',
      'The requested vault path is not a regular file.',
    )
  }
  if (metadata.size <= 0 || metadata.size > maxBytes) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_SIZE_UNSUPPORTED',
      `Vault files must be between 1 byte and ${maxBytes} bytes.`,
    )
  }
}

function assertAdoptedAssistantGeneratedDeliveryMetadata(metadata: Stats): void {
  if ((metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_PERMISSIONS_UNSAFE',
      'The generated delivery file ownership or permissions changed before it could be read.',
    )
  }
}

function assistantVaultFileIdentityMatches(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function assistantVaultFileStatsMatch(left: Stats, right: Stats): boolean {
  return (
    assistantVaultFileIdentityMatches(left, right)
    && left.mode === right.mode
    && left.size === right.size
    && left.nlink === right.nlink
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
  )
}

function assistantVaultFileChangedDuringReadError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_VAULT_FILE_CHANGED_DURING_READ',
    'The generated delivery file changed while it was being prepared.',
  )
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
  if (
    ref.length === 0
    || ref.length > 1024
    || !isNormalizedAssistantVaultFileRef(ref)
  ) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_REF_INVALID',
      'Vault file refs must be normalized supported paths inside the vault.',
    )
  }
  return ref
}

function resolveAssistantVaultFileContentType(filename: string): string {
  const contentType = resolveSupportedAssistantVaultFileContentType(filename)
  if (!contentType) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_FILE_TYPE_UNSUPPORTED',
      'This vault file type is not supported for secure delivery.',
    )
  }
  return contentType
}

function detectAssistantVaultImageContentType(
  bytes: Uint8Array,
): AssistantVaultImageResponseMedia['contentType'] | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
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
