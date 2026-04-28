import { constants as fsConstants } from 'node:fs'
import { access, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface CodexAppServerImageInput {
  bytes?: Uint8Array | Buffer
  mimeType?: string | null
  path?: string
}

export async function materializeCodexImagePaths(input: {
  images?: readonly CodexAppServerImageInput[] | null
  tempRoot: string
}): Promise<string[]> {
  const imageInputs = input.images ?? []
  const imagePaths: string[] = []

  for (const [index, image] of imageInputs.entries()) {
    imagePaths.push(
      await materializeCodexImagePath({
        image,
        index,
        tempRoot: input.tempRoot,
      }),
    )
  }

  return imagePaths
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
