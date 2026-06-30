import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import type {
  AssistantWorkspaceArtifactMaterializer,
} from '../assistant/execution-context.js'

export const MAX_GENERATE_IMAGE_REFERENCE_COUNT = 16
// Sized so the maximum 16-image total stays inside the hosted runner Worker
// proxy budget. createHostedRunnerUpstreamRequest currently buffers the request
// body through ArrayBuffer + a new Request copy, so a single hosted call could
// hold the multipart body twice in memory. Keep the per-file and total caps
// small enough that 2x the total fits comfortably inside one Worker request,
// and keep HOSTED_OPENAI_IMAGES_EDITS_MAX_BODY_BYTES in sync above this total
// plus multipart overhead.
export const MAX_GENERATE_IMAGE_REFERENCE_BYTES = 2 * 1024 * 1024
export const MAX_GENERATE_IMAGE_REFERENCE_TOTAL_BYTES = 32 * 1024 * 1024

export type GenerateImageReferenceMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'

export interface ResolvedGenerateImageReference {
  bytes: Uint8Array
  filename: string
  mediaType: GenerateImageReferenceMediaType
  sha256: string
  sourceRef: string
  sourceRefSha256: string
}

export async function resolveGenerateImageReferences(input: {
  authorizedReferenceImageRefs:
    | ReadonlyMap<string, { sha256: string }>
    | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  refs: readonly string[]
  vaultRoot: string
}): Promise<ResolvedGenerateImageReference[]> {
  const vaultRoot = input.vaultRoot.trim()
  if (!vaultRoot) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_VAULT_UNAVAILABLE',
      'Image references require a vault root.',
    )
  }

  const refs = input.refs.map(normalizeGenerateImageReferenceRef)
  if (refs.length === 0) {
    return []
  }
  if (refs.length > MAX_GENERATE_IMAGE_REFERENCE_COUNT) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_COUNT_UNSUPPORTED',
      `Image generation supports at most ${MAX_GENERATE_IMAGE_REFERENCE_COUNT} reference images.`,
    )
  }

  // Per-turn authority: refs must be a subset of the image attachments the
  // upstream pipeline accepted for this exact turn, AND the bytes on disk must
  // still hash to the sha256 the evidence recorded. Vault-state pre-existence
  // (an old materialized inbox image) is not authority on its own; neither is
  // a path that was authorized earlier in the turn but whose bytes were
  // mutated before tool execution. Fail closed when the caller did not compute
  // an allowlist for this turn, when a requested ref is not in the allowlist,
  // or (later, after read) when the computed sha256 mismatches.
  const authorizedRefs = input.authorizedReferenceImageRefs
  if (!authorizedRefs) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_AUTHORITY_UNAVAILABLE',
      'Image references require per-turn attachment authority.',
    )
  }
  for (const ref of refs) {
    if (!authorizedRefs.has(ref)) {
      throw new VaultCliError(
        'ASSISTANT_IMAGE_REFERENCE_REF_UNAUTHORIZED',
        'Image references must point at attachments accepted for this turn.',
      )
    }
  }

  const materialization = await input.materializeWorkspaceArtifacts?.(refs)
  const missingRefs = materialization
    ? refs.filter((ref) => materialization.missingArtifactPaths.has(ref))
    : []
  if (missingRefs.length > 0) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_UNAVAILABLE',
      'One or more image references are unavailable in the workspace.',
    )
  }

  const resolved: ResolvedGenerateImageReference[] = []
  let totalBytes = 0
  for (const [index, ref] of refs.entries()) {
    const absolutePath = await resolveAssistantVaultPath(
      vaultRoot,
      ref,
      'file path',
    )
    const fileStats = await stat(absolutePath)
    if (!fileStats.isFile()) {
      throw new VaultCliError(
        'ASSISTANT_IMAGE_REFERENCE_NOT_REGULAR_FILE',
        'Image references must be regular files.',
      )
    }
    if (
      fileStats.size <= 0 ||
      fileStats.size > MAX_GENERATE_IMAGE_REFERENCE_BYTES ||
      totalBytes + fileStats.size > MAX_GENERATE_IMAGE_REFERENCE_TOTAL_BYTES
    ) {
      throw new VaultCliError(
        'ASSISTANT_IMAGE_REFERENCE_SIZE_UNSUPPORTED',
        'Image reference files exceed the image generation input budget.',
      )
    }

    const bytes = await readFile(absolutePath)
    const mediaType = sniffGenerateImageReferenceMediaType(bytes)
    if (!mediaType) {
      throw new VaultCliError(
        'ASSISTANT_IMAGE_REFERENCE_TYPE_UNSUPPORTED',
        'Image references must be JPG, PNG, or WebP files.',
      )
    }
    if (
      bytes.byteLength <= 0 ||
      bytes.byteLength > MAX_GENERATE_IMAGE_REFERENCE_BYTES ||
      totalBytes + bytes.byteLength > MAX_GENERATE_IMAGE_REFERENCE_TOTAL_BYTES
    ) {
      throw new VaultCliError(
        'ASSISTANT_IMAGE_REFERENCE_SIZE_UNSUPPORTED',
        'Image reference files exceed the image generation input budget.',
      )
    }

    const bytesSha256 = sha256Hex(bytes)
    const expectedSha256 = authorizedRefs.get(ref)?.sha256
    if (!expectedSha256 || expectedSha256.toLowerCase() !== bytesSha256.toLowerCase()) {
      throw new VaultCliError(
        'ASSISTANT_IMAGE_REFERENCE_BYTES_UNAUTHORIZED',
        'Image reference bytes do not match the attachment evidence accepted for this turn.',
      )
    }

    totalBytes += bytes.byteLength
    resolved.push({
      bytes,
      filename: buildNeutralReferenceFilename(index, mediaType),
      mediaType,
      sha256: bytesSha256,
      sourceRef: ref,
      sourceRefSha256: sha256Hex(ref),
    })
  }

  return resolved
}

export function normalizeGenerateImageReferenceRef(value: string): string {
  const ref = value.trim()
  const segments = ref.split('/')
  if (
    ref.length === 0 ||
    ref.length > 1024 ||
    ref.startsWith('/') ||
    ref.includes('\\') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(ref) ||
    /[\u0000-\u001F\u007F]/u.test(ref) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.'),
    )
  ) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_REF_INVALID',
      'Image reference refs must be normalized, non-hidden vault-relative paths.',
    )
  }
  return segments.join('/')
}

export function sniffGenerateImageReferenceMediaType(
  bytes: Uint8Array,
): GenerateImageReferenceMediaType | null {
  if (
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {
    return 'image/jpeg'
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

function buildNeutralReferenceFilename(
  index: number,
  mediaType: GenerateImageReferenceMediaType,
): string {
  return `reference-image-${index + 1}.${referenceFileExtension(mediaType)}`
}

function referenceFileExtension(mediaType: GenerateImageReferenceMediaType): string {
  switch (mediaType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
  }
}

function sha256Hex(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}
