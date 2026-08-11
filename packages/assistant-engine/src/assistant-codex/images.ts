import { constants as fsConstants } from 'node:fs'
import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  OPENAI_CODEX_MODEL_PROVIDER_ID,
} from '@murphai/operator-config/assistant/target-runtime'

import type {
  AssistantModelImageDetail,
  AssistantModelImagePart,
  AssistantUserMessageContentPart,
} from '../assistant/content-types.js'

export interface CodexAppServerImageInput {
  bytes?: Uint8Array | Buffer
  detail?: AssistantModelImageDetail
  mimeType?: string | null
  path?: string
}

export interface CodexAppServerPreparedImageInput {
  detail?: AssistantModelImageDetail
  path: string
}

const CODEX_ORIGINAL_IMAGE_DETAIL_PROVIDER_IDS = new Set<string>([
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  OPENAI_CODEX_MODEL_PROVIDER_ID,
])

export function extractCodexAppServerUserMessageImages(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): readonly CodexAppServerImageInput[] | undefined {
  const images = (userMessageContent ?? []).flatMap((part) =>
    part.type === 'image' ? [toCodexAppServerImageInput(part)] : [],
  )

  return images.length > 0 ? images : undefined
}

export function normalizeCodexAppServerImageDetails(input: {
  images?: readonly CodexAppServerImageInput[] | null
  modelProvider?: string | null
  turnKind: 'initial' | 'steer'
}): readonly CodexAppServerImageInput[] | undefined {
  const images = input.images ?? []
  if (images.length === 0) {
    return undefined
  }

  const originalDetailSupported =
    input.turnKind === 'initial' &&
    images.length === 1 &&
    CODEX_ORIGINAL_IMAGE_DETAIL_PROVIDER_IDS.has(
      normalizeNullableString(input.modelProvider) ?? '',
    )

  return images.map((image) =>
    image.detail === 'original' && !originalDetailSupported
      ? { ...image, detail: 'high' }
      : image,
  )
}

export async function materializeCodexImages(input: {
  images?: readonly CodexAppServerImageInput[] | null
  tempRoot: string
}): Promise<CodexAppServerPreparedImageInput[]> {
  const imageInputs = input.images ?? []
  const preparedImages: CodexAppServerPreparedImageInput[] = []

  for (const [index, image] of imageInputs.entries()) {
    preparedImages.push({
      ...(image.detail ? { detail: image.detail } : {}),
      path: await materializeCodexImagePath({
        image,
        index,
        tempRoot: input.tempRoot,
      }),
    })
  }

  return preparedImages
}

function toCodexAppServerImageInput(
  input: AssistantModelImagePart,
): CodexAppServerImageInput {
  const imageMetadata = {
    ...(input.detail ? { detail: input.detail } : {}),
    mimeType: input.mimeType ?? input.mediaType ?? null,
  }

  if (typeof input.image === 'string') {
    if (input.image.startsWith('data:')) {
      return {
        bytes: decodeCodexDataUrlToBytes(input.image),
        ...imageMetadata,
      }
    }

    return {
      path: input.image,
      ...imageMetadata,
    }
  }

  if (input.image instanceof URL) {
    if (input.image.protocol === 'data:') {
      return {
        bytes: decodeCodexDataUrlToBytes(input.image.href),
        ...imageMetadata,
      }
    }

    if (input.image.protocol === 'file:') {
      return {
        path: fileURLToPath(input.image),
        ...imageMetadata,
      }
    }

    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      `Codex app-server image input does not support URL scheme "${input.image.protocol}".`,
    )
  }

  if (input.image instanceof ArrayBuffer) {
    return {
      bytes: new Uint8Array(input.image),
      ...imageMetadata,
    }
  }

  return {
    bytes: input.image,
    ...imageMetadata,
  }
}

function decodeCodexDataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:([^,]*?),(.*)$/su.exec(dataUrl)
  if (!match) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      'Codex app-server image input data URL is malformed.',
    )
  }

  const metadata = match[1] ?? ''
  const payload = match[2] ?? ''
  const metadataParts = metadata
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (metadataParts.includes('base64')) {
    return Uint8Array.from(Buffer.from(payload, 'base64'))
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_IMAGE_INVALID',
    'Codex app-server image input data URLs must use base64 encoding.',
  )
}

async function materializeCodexImagePath(input: {
  image: CodexAppServerImageInput
  index: number
  tempRoot: string
}): Promise<string> {
  const inferredMimeType = normalizeNullableString(input.image.mimeType)
  const normalizedPath = normalizeNullableString(input.image.path)
  if (normalizedPath) {
    return resolveReadableCodexImagePath(normalizedPath)
  }

  const bytes = input.image.bytes
  if (!bytes) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      'Codex app-server image input requires either bytes or a readable path.',
    )
  }

  return writeCodexImageBytes({
    bytes: Buffer.from(bytes),
    index: input.index,
    mimeType: inferredMimeType,
    tempRoot: input.tempRoot,
  })
}

async function writeCodexImageBytes(input: {
  bytes: Buffer
  index: number
  mimeType: string | null
  tempRoot: string
}): Promise<string> {
  const filePath = path.join(
    input.tempRoot,
    `image-${input.index + 1}${resolveCodexImageExtension(input.mimeType)}`,
  )
  await writeFile(filePath, input.bytes)
  return filePath
}

async function resolveReadableCodexImagePath(candidatePath: string): Promise<string> {
  const resolvedPath = path.resolve(candidatePath)

  try {
    await access(resolvedPath, fsConstants.R_OK)
  } catch {
    throw new VaultCliError(
      'ASSISTANT_CODEX_IMAGE_INVALID',
      'Codex app-server image input path is not readable.',
    )
  }

  return resolvedPath
}

function resolveCodexImageExtension(mimeType: string | null): string {
  switch (mimeType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    case 'image/heic':
      return '.heic'
    case 'image/heif':
      return '.heif'
    case 'image/bmp':
      return '.bmp'
    case 'image/tiff':
      return '.tiff'
    default:
      return '.img'
  }
}
