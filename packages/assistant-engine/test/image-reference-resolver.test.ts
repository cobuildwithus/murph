import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MAX_GENERATE_IMAGE_REFERENCE_BYTES,
  MAX_GENERATE_IMAGE_REFERENCE_TOTAL_BYTES,
  normalizeGenerateImageReferenceRef,
  resolveGenerateImageReferences,
  sniffGenerateImageReferenceMediaType,
} from '../src/assistant-codex/image-reference-resolver.js'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
])
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])

async function withTempVault<T>(fn: (vaultRoot: string) => Promise<T>): Promise<T> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-image-refs-'))
  try {
    return await fn(vaultRoot)
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, bytes)
}

describe('image-reference-resolver', () => {
  it('sniffs supported reference image formats by magic bytes', () => {
    expect(sniffGenerateImageReferenceMediaType(JPEG_BYTES)).toBe('image/jpeg')
    expect(sniffGenerateImageReferenceMediaType(PNG_BYTES)).toBe('image/png')
    expect(sniffGenerateImageReferenceMediaType(WEBP_BYTES)).toBe('image/webp')
    expect(sniffGenerateImageReferenceMediaType(GIF_BYTES)).toBeNull()
  })

  it('normalizes and rejects unsafe reference refs before filesystem access', () => {
    expect(normalizeGenerateImageReferenceRef(' raw/inbox/photo.png ')).toBe(
      'raw/inbox/photo.png',
    )

    for (const ref of [
      '',
      '/raw/inbox/photo.png',
      '../photo.png',
      'raw/../photo.png',
      'raw\\photo.png',
      'https://example.com/photo.png',
      'C:/photo.png',
      'raw/.hidden/photo.png',
    ]) {
      expect(() => normalizeGenerateImageReferenceRef(ref)).toThrow(
        /normalized, non-hidden vault-relative paths/u,
      )
    }
  })

  it('rejects vault refs outside the user-attached raw inbox prefix', () => {
    for (const ref of [
      'bank/private/passport.png',
      'derived/inbox/processed.png',
      'journal/photos/private.png',
      'raw/other/photo.png',
    ]) {
      expect(() => normalizeGenerateImageReferenceRef(ref)).toThrow(
        /user-attached inbox artifacts/u,
      )
    }
  })

  it('resolves supported vault image references with neutral filenames and hashes', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/front.png', PNG_BYTES)
      await writeVaultFile(vaultRoot, 'raw/inbox/style.jpg', JPEG_BYTES)
      await writeVaultFile(vaultRoot, 'raw/inbox/layout.webp', WEBP_BYTES)

      const references = await resolveGenerateImageReferences({
        authorizedReferenceImageRefs: new Set([
          'raw/inbox/front.png',
          'raw/inbox/style.jpg',
          'raw/inbox/layout.webp',
        ]),
        refs: ['raw/inbox/front.png', 'raw/inbox/style.jpg', 'raw/inbox/layout.webp'],
        vaultRoot,
      })

      expect(references).toHaveLength(3)
      expect(references.map((reference) => reference.filename)).toEqual([
        'reference-image-1.png',
        'reference-image-2.jpg',
        'reference-image-3.webp',
      ])
      expect(references.map((reference) => reference.mediaType)).toEqual([
        'image/png',
        'image/jpeg',
        'image/webp',
      ])
      expect(references[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(references[0]?.sourceRefSha256).toMatch(/^[a-f0-9]{64}$/u)
      expect(references[0]?.sourceRef).toBe('raw/inbox/front.png')
    })
  })

  it('calls hosted artifact materialization with normalized refs before reading', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/photo.png', PNG_BYTES)
      let materializedPaths: readonly string[] = []

      await resolveGenerateImageReferences({
        authorizedReferenceImageRefs: new Set(['raw/inbox/photo.png']),
        materializeWorkspaceArtifacts: async (relativePaths) => {
          materializedPaths = [...relativePaths]
          return {
            materializedArtifactPaths: new Set(relativePaths),
            missingArtifactPaths: new Set<string>(),
          }
        },
        refs: [' raw/inbox/photo.png '],
        vaultRoot,
      })

      expect(materializedPaths).toEqual(['raw/inbox/photo.png'])
    })
  })

  it('rejects missing hosted artifacts, unsupported bytes, and symlink escapes', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/not-image.png', GIF_BYTES)

      await expect(
        resolveGenerateImageReferences({
          authorizedReferenceImageRefs: new Set(['raw/inbox/not-image.png']),
          materializeWorkspaceArtifacts: async (relativePaths) => ({
            materializedArtifactPaths: new Set<string>(),
            missingArtifactPaths: new Set(relativePaths),
          }),
          refs: ['raw/inbox/not-image.png'],
          vaultRoot,
        }),
      ).rejects.toMatchObject({ code: 'ASSISTANT_IMAGE_REFERENCE_UNAVAILABLE' })

      await expect(
        resolveGenerateImageReferences({
          authorizedReferenceImageRefs: new Set(['raw/inbox/not-image.png']),
          refs: ['raw/inbox/not-image.png'],
          vaultRoot,
        }),
      ).rejects.toMatchObject({ code: 'ASSISTANT_IMAGE_REFERENCE_TYPE_UNSUPPORTED' })

      const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-image-outside-'))
      try {
        await writeFile(path.join(outsideRoot, 'outside.png'), PNG_BYTES)
        await mkdir(path.join(vaultRoot, 'raw', 'inbox'), { recursive: true })
        await symlink(
          path.join(outsideRoot, 'outside.png'),
          path.join(vaultRoot, 'raw', 'inbox', 'linked.png'),
        )

        await expect(
          resolveGenerateImageReferences({
            authorizedReferenceImageRefs: new Set(['raw/inbox/linked.png']),
            refs: ['raw/inbox/linked.png'],
            vaultRoot,
          }),
        ).rejects.toMatchObject({ code: 'ASSISTANT_PATH_OUTSIDE_VAULT' })
      } finally {
        await rm(outsideRoot, { force: true, recursive: true })
      }
    })
  })

  it('rejects files larger than the per-file budget proven safe for the hosted Worker proxy', async () => {
    expect(MAX_GENERATE_IMAGE_REFERENCE_BYTES).toBe(4 * 1024 * 1024)
    expect(MAX_GENERATE_IMAGE_REFERENCE_TOTAL_BYTES).toBe(16 * 1024 * 1024)

    await withTempVault(async (vaultRoot) => {
      const oversize = new Uint8Array(MAX_GENERATE_IMAGE_REFERENCE_BYTES + 1)
      oversize.set(PNG_BYTES, 0)
      await writeVaultFile(vaultRoot, 'raw/inbox/huge.png', oversize)

      await expect(
        resolveGenerateImageReferences({
          authorizedReferenceImageRefs: new Set(['raw/inbox/huge.png']),
          refs: ['raw/inbox/huge.png'],
          vaultRoot,
        }),
      ).rejects.toMatchObject({ code: 'ASSISTANT_IMAGE_REFERENCE_SIZE_UNSUPPORTED' })
    })
  })

  it('keeps the Murph product contract capped at four ordered references', async () => {
    await expect(
      resolveGenerateImageReferences({
        authorizedReferenceImageRefs: new Set([
          'raw/inbox/1.png',
          'raw/inbox/2.png',
          'raw/inbox/3.png',
          'raw/inbox/4.png',
          'raw/inbox/5.png',
        ]),
        refs: [
          'raw/inbox/1.png',
          'raw/inbox/2.png',
          'raw/inbox/3.png',
          'raw/inbox/4.png',
          'raw/inbox/5.png',
        ],
        vaultRoot: '/',
      }),
    ).rejects.toMatchObject({ code: 'ASSISTANT_IMAGE_REFERENCE_COUNT_UNSUPPORTED' })
  })

  it('fails closed when no per-turn authority allowlist is provided', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/photo.png', PNG_BYTES)

      await expect(
        resolveGenerateImageReferences({
          authorizedReferenceImageRefs: null,
          refs: ['raw/inbox/photo.png'],
          vaultRoot,
        }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_IMAGE_REFERENCE_AUTHORITY_UNAVAILABLE',
      })
    })
  })

  it('rejects refs that are not in the current-turn authority allowlist', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/stale.png', PNG_BYTES)

      await expect(
        resolveGenerateImageReferences({
          authorizedReferenceImageRefs: new Set(['raw/inbox/current.png']),
          refs: ['raw/inbox/stale.png'],
          vaultRoot,
        }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_IMAGE_REFERENCE_REF_UNAUTHORIZED',
      })
    })
  })
})
