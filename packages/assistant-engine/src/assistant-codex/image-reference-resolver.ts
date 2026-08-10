import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  RAW_CAPTURES_DIRECTORY,
  RAW_INBOX_DIRECTORY,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveAssistantVaultPath } from '@murphai/vault-usecases/assistant-vault-paths'

import type {
  AssistantWorkspaceArtifactMaterializer,
} from '../assistant/execution-context.js'

// Reference authority is structural. Vault refs must live in a vault family
// whose only writers are the inbound-attachment pipeline (raw/inbox/**) or the
// canonical capture surface (raw/captures/**). raw/inbox holds user-sent media;
// raw/captures holds canonical trusted captures and may include Murph-generated
// images. Membership in either owner-written family proves reference provenance,
// not action consent; the consuming tool still owns intent and effect authority.
// Confidentiality
// across relationships is owned by vault separation (each 1:1 and each group
// is its own runtime and vault), not by this check; this check blocks DIRECT
// reference of document scans (raw/documents/**), bank/, derived/, and other
// non-media vault files by a confused or injected model. The only non-vault
// family is skill-assets/**, which resolves to product-shipped read-only
// content under the installed assistant-engine package's skills/shared/
// directory. That family carries no user data and no consent question; it is
// Murph's own canonical character art, served from the package rather than
// the vault. This remains a misreference guardrail, not a wall against
// deliberate re-materialization: the agent holds shell and capture authority
// inside its own vault, so no within-vault path check can stop it from copying
// bytes into an authorized family — just as it can already read any vault file
// into its own provider-bound context. Do not "harden" this by coupling
// capture or other product surfaces to image authority; the hard boundary
// lives at the vault seam.
const AUTHORIZED_REFERENCE_IMAGE_PATH_PREFIXES = [
  `${RAW_INBOX_DIRECTORY}/`,
  `${RAW_CAPTURES_DIRECTORY}/`,
] as const
const SKILL_ASSET_REFERENCE_IMAGE_PATH_PREFIX = 'skill-assets/' as const
const SKILL_ASSET_SHARED_DIRECTORY = 'shared'

export const MAX_GENERATE_IMAGE_REFERENCE_COUNT = 16
// The per-file cap matches the generated-image output cap so a saved
// raw/captures/** generated image can be reused as an exact reference. The
// aggregate cap remains sized for the hosted runner Worker proxy budget:
// createHostedRunnerUpstreamRequest currently buffers the request body through
// ArrayBuffer + a new Request copy, so a single hosted call could hold the
// multipart body twice in memory. Keep HOSTED_OPENAI_IMAGES_EDITS_MAX_BODY_BYTES
// in sync above this total plus multipart overhead.
export const MAX_GENERATE_IMAGE_REFERENCE_BYTES = 10 * 1024 * 1024
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
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  refs: readonly string[]
  skillsRoot?: string | null
  vaultRoot: string
}): Promise<ResolvedGenerateImageReference[]> {
  const refs = input.refs.map(normalizeGenerateImageReferenceRef)
  const skillsRoot = input.skillsRoot?.trim() ?? ''
  if (refs.length === 0) {
    return []
  }
  if (refs.length > MAX_GENERATE_IMAGE_REFERENCE_COUNT) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_COUNT_UNSUPPORTED',
      `Image generation supports at most ${MAX_GENERATE_IMAGE_REFERENCE_COUNT} reference images.`,
    )
  }

  const refFamilies = refs.map((ref) => {
    if (isVaultReferenceImageRef(ref)) {
      return 'vault' as const
    }
    if (isSkillAssetReferenceImageRef(ref)) {
      if (!skillsRoot) {
        throw new VaultCliError(
          'ASSISTANT_IMAGE_REFERENCE_SKILLS_ROOT_UNAVAILABLE',
          'Skill asset image references require an assistant skills root.',
        )
      }
      return 'skill-asset' as const
    }
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_REF_UNAUTHORIZED',
      'Image references must live under raw/inbox/**, raw/captures/**, or skill-assets/**.',
    )
  })
  const vaultRefs = refs.filter((ref) => isVaultReferenceImageRef(ref))
  const vaultRoot = input.vaultRoot.trim()

  if (vaultRefs.length > 0 && !vaultRoot) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_VAULT_UNAVAILABLE',
      'Image references require a vault root.',
    )
  }

  if (vaultRefs.length > 0) {
    const materialization = await input.materializeWorkspaceArtifacts?.(vaultRefs)
    const missingRefs = materialization
      ? vaultRefs.filter((ref) => materialization.missingArtifactPaths.has(ref))
      : []
    if (missingRefs.length > 0) {
      throw new VaultCliError(
        'ASSISTANT_IMAGE_REFERENCE_UNAVAILABLE',
        'One or more image references are unavailable in the workspace.',
      )
    }
  }

  const resolved: ResolvedGenerateImageReference[] = []
  let totalBytes = 0
  for (const [index, ref] of refs.entries()) {
    const absolutePath = refFamilies[index] === 'skill-asset'
      ? await resolveSkillAssetReferencePath(skillsRoot, ref)
      : await resolveAssistantVaultPath(
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

export function isVaultReferenceImageRef(ref: string): boolean {
  return AUTHORIZED_REFERENCE_IMAGE_PATH_PREFIXES.some(
    (prefix) => ref.startsWith(prefix),
  )
}

function isSkillAssetReferenceImageRef(ref: string): boolean {
  return ref.startsWith(SKILL_ASSET_REFERENCE_IMAGE_PATH_PREFIX)
}

async function resolveSkillAssetReferencePath(
  skillsRoot: string,
  ref: string,
): Promise<string> {
  const sharedRoot = path.resolve(skillsRoot, SKILL_ASSET_SHARED_DIRECTORY)
  const absolutePath = path.resolve(
    sharedRoot,
    ref.slice(SKILL_ASSET_REFERENCE_IMAGE_PATH_PREFIX.length),
  )
  assertPathWithinSkillAssetSharedRoot(sharedRoot, absolutePath, ref)

  const [canonicalSharedRoot, canonicalPath] = await Promise.all([
    realpath(sharedRoot),
    realpath(absolutePath),
  ])
  assertPathWithinSkillAssetSharedRoot(canonicalSharedRoot, canonicalPath, ref)

  return canonicalPath
}

function assertPathWithinSkillAssetSharedRoot(
  sharedRoot: string,
  absolutePath: string,
  ref: string,
): void {
  const relativeToSharedRoot = path.relative(sharedRoot, absolutePath)

  if (
    relativeToSharedRoot === '..' ||
    relativeToSharedRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToSharedRoot)
  ) {
    throw new VaultCliError(
      'ASSISTANT_IMAGE_REFERENCE_SKILL_ASSET_OUTSIDE_ROOT',
      `Skill asset image reference "${ref}" resolves outside the assistant skills shared root.`,
    )
  }
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
