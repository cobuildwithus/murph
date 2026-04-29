import { chmod, mkdir, writeFile } from 'node:fs/promises'
import {
  resolveAssistantInboxArtifactPath,
} from '@murphai/vault-usecases/assistant-vault-paths'
import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import type { InboxServices } from '@murphai/inbox-services'
import {
  inboxModelBundleResultSchema,
  inboxModelBundleSchema,
  type InboxModelAttachmentBundle,
  type InboxModelBundle,
  type InboxModelBundleResult,
  type InboxModelInputMode,
} from './inbox-model-contracts.js'
import {
  buildInboxModelAttachmentBundles,
  inferInboxMultimodalInputMode,
} from './inbox-multimodal.js'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import type { VaultServices } from '@murphai/vault-usecases/vault-services'

const DEFAULT_MAX_ROUTING_CHARS = 24000
const PRIVATE_ARTIFACT_DIRECTORY_MODE = 0o700
const PRIVATE_ARTIFACT_FILE_MODE = 0o600

export interface BuildInboxModelBundleInput {
  inboxServices: InboxServices
  requestId?: string | null
  captureId: string
  vault: string
  vaultServices?: VaultServices
  includeSensitiveBundle?: boolean
}

export async function buildInboxModelBundle(
  input: BuildInboxModelBundleInput,
): Promise<InboxModelBundle> {
  return (await prepareInboxModelSession(input)).bundle
}

export async function materializeInboxModelBundle(
  input: BuildInboxModelBundleInput,
): Promise<InboxModelBundleResult> {
  const { bundle } = await prepareInboxModelSession(input)
  const bundlePath = await writeAssistantArtifact(
    input.vault,
    input.captureId,
    'bundle.json',
    bundle,
  )

  return inboxModelBundleResultSchema.parse({
    vault: input.vault,
    captureId: input.captureId,
    bundlePath,
    bundle: input.includeSensitiveBundle === true ? bundle : null,
  })
}

async function prepareInboxModelSession(
  input: BuildInboxModelBundleInput,
): Promise<{
  bundle: InboxModelBundle
}> {
  const shown = await input.inboxServices.show({
    vault: input.vault,
    requestId: input.requestId ?? null,
    captureId: input.captureId,
  })
  const attachments = await buildInboxModelAttachmentBundles({
    attachments: shown.capture.attachments,
    captureId: shown.capture.captureId,
    captureEnvelopePath: shown.capture.envelopePath,
    vaultRoot: input.vault,
  })
  const preparedInputMode = inferInboxMultimodalInputMode(attachments)
  const routingText = clampText(
    renderRoutingText(shown.capture, attachments, preparedInputMode),
    DEFAULT_MAX_ROUTING_CHARS,
  ).text

  return {
    bundle: inboxModelBundleSchema.parse({
      schema: 'murph.inbox-model-bundle.v1',
      captureId: shown.capture.captureId,
      eventId: shown.capture.eventId,
      source: shown.capture.source,
      accountId: shown.capture.accountId ?? null,
      threadId: shown.capture.threadId,
      threadTitle: shown.capture.threadTitle ?? null,
      actorId: shown.capture.actorId ?? null,
      actorName: shown.capture.actorName ?? null,
      actorIsSelf: shown.capture.actorIsSelf,
      occurredAt: shown.capture.occurredAt,
      receivedAt: shown.capture.receivedAt ?? null,
      envelopePath: shown.capture.envelopePath,
      captureText: shown.capture.text ?? null,
      attachments,
      preparedInputMode,
      routingText,
    }),
  }
}

function renderRoutingText(
  capture: InboxShowResult['capture'],
  attachments: InboxModelAttachmentBundle[],
  preparedInputMode: InboxModelInputMode,
): string {
  const lines: string[] = [
    `Occurred at: ${capture.occurredAt}`,
    `Source: ${capture.source}`,
    `Thread type: ${capture.threadIsDirect ? 'direct' : 'group'}`,
    `Actor self: ${String(capture.actorIsSelf)}`,
    `Prepared input mode: ${preparedInputMode}`,
  ]

  const captureText = normalizeNullableString(capture.text)
  if (captureText) {
    lines.push('', 'Capture text:', captureText)
  }

  if (attachments.length > 0) {
    lines.push('', 'Attachment text bundle:')
    for (const attachment of attachments) {
      lines.push(
        '',
        `Attachment ${attachment.ordinal} (${attachment.kind})`,
        attachment.combinedText.length > 0 ? attachment.combinedText : 'No attachment text available.',
      )
    }
  }

  return lines.join('\n')
}

async function writeAssistantArtifact(
  vaultRoot: string,
  captureId: string,
  fileName: string,
  value: unknown,
): Promise<string> {
  const artifactPath = await resolveAssistantInboxArtifactPath(
    vaultRoot,
    captureId,
    fileName,
  )
  await mkdir(artifactPath.absoluteDirectory, {
    recursive: true,
    mode: PRIVATE_ARTIFACT_DIRECTORY_MODE,
  })
  await chmod(artifactPath.absoluteDirectory, PRIVATE_ARTIFACT_DIRECTORY_MODE)
  await writeFile(
    artifactPath.absolutePath,
    `${JSON.stringify(value, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: PRIVATE_ARTIFACT_FILE_MODE,
    },
  )
  await chmod(artifactPath.absolutePath, PRIVATE_ARTIFACT_FILE_MODE)
  return artifactPath.relativePath
}

function clampText(
  value: string,
  limit: number,
): {
  text: string
  truncated: boolean
} {
  const normalized = value.trim()
  if (normalized.length <= limit) {
    return {
      text: normalized,
      truncated: false,
    }
  }

  const suffix = `\n\n[truncated ${normalized.length - limit} characters]`
  const safeLimit = Math.max(0, limit - suffix.length)
  return {
    text: `${normalized.slice(0, safeLimit)}${suffix}`,
    truncated: true,
  }
}
