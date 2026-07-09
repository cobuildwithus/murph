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

async function withTempSkillsRoot<T>(
  fn: (skillsRoot: string) => Promise<T>,
): Promise<T> {
  const skillsRoot = await mkdtemp(path.join(tmpdir(), 'murph-skill-assets-'))
  try {
    return await fn(skillsRoot)
  } finally {
    await rm(skillsRoot, { force: true, recursive: true })
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

async function writeSkillAssetFile(
  skillsRoot: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const absolutePath = path.join(skillsRoot, 'shared', relativePath)
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
      'skill-assets/../photo.png',
      'skill-assets/.hidden/photo.png',
    ]) {
      expect(() => normalizeGenerateImageReferenceRef(ref)).toThrow(
        /normalized, non-hidden vault-relative paths/u,
      )
    }
  })

  it('resolves supported vault image references with neutral filenames and hashes', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/front.png', PNG_BYTES)
      await writeVaultFile(vaultRoot, 'raw/inbox/style.jpg', JPEG_BYTES)
      await writeVaultFile(vaultRoot, 'raw/inbox/layout.webp', WEBP_BYTES)

      const references = await resolveGenerateImageReferences({
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

  it('resolves captured media so pinned challenge photos stay referenceable across turns', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(
        vaultRoot,
        'raw/captures/2026/07/challenge-sleep/intro-zach.jpg',
        JPEG_BYTES,
      )

      const references = await resolveGenerateImageReferences({
        refs: ['raw/captures/2026/07/challenge-sleep/intro-zach.jpg'],
        vaultRoot,
      })

      expect(references).toHaveLength(1)
      expect(references[0]?.mediaType).toBe('image/jpeg')
    })
  })

  it('resolves package skill asset image references from the shared skills root', async () => {
    await withTempVault(async (vaultRoot) => {
      await withTempSkillsRoot(async (skillsRoot) => {
        await writeSkillAssetFile(skillsRoot, 'murph-character-sheet-v1.png', PNG_BYTES)

        const references = await resolveGenerateImageReferences({
          refs: ['skill-assets/murph-character-sheet-v1.png'],
          skillsRoot,
          vaultRoot,
        })

        expect(references).toHaveLength(1)
        expect(references[0]).toMatchObject({
          filename: 'reference-image-1.png',
          mediaType: 'image/png',
          sourceRef: 'skill-assets/murph-character-sheet-v1.png',
        })
      })
    })
  })

  it('rejects refs outside the pipeline-written media families', async () => {
    await withTempVault(async (vaultRoot) => {
      for (const ref of [
        'raw/documents/2026/records/scan.png',
        'raw/workouts/2026/03/bench.jpg',
        'bank/memory-photo.png',
        'derived/knowledge/pages/page-image.png',
        'journal/2026-07-06/photo.png',
        'exports/photo.png',
        'skill-asset/murph-character-sheet-v1.png',
        'skill-assets2/murph-character-sheet-v1.png',
      ]) {
        await writeVaultFile(vaultRoot, ref, PNG_BYTES)
        await expect(
          resolveGenerateImageReferences({ refs: [ref], vaultRoot }),
        ).rejects.toMatchObject({
          code: 'ASSISTANT_IMAGE_REFERENCE_REF_UNAUTHORIZED',
        })
      }
    })
  })

  it('requires an assistant skills root for skill asset references', async () => {
    await withTempVault(async (vaultRoot) => {
      await expect(
        resolveGenerateImageReferences({
          refs: ['skill-assets/murph-character-sheet-v1.png'],
          vaultRoot,
        }),
      ).rejects.toMatchObject({
        code: 'ASSISTANT_IMAGE_REFERENCE_SKILLS_ROOT_UNAVAILABLE',
      })
    })
  })

  it('calls hosted artifact materialization with normalized refs before reading', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/photo.png', PNG_BYTES)
      let materializedPaths: readonly string[] = []

      await resolveGenerateImageReferences({
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

  it('does not materialize skill asset references while preserving mixed input order', async () => {
    await withTempVault(async (vaultRoot) => {
      await withTempSkillsRoot(async (skillsRoot) => {
        await writeVaultFile(vaultRoot, 'raw/inbox/style.jpg', JPEG_BYTES)
        await writeSkillAssetFile(skillsRoot, 'murph-character-sheet-v1.png', PNG_BYTES)
        await writeSkillAssetFile(skillsRoot, 'pose.webp', WEBP_BYTES)
        let materializedPaths: readonly string[] = []

        const references = await resolveGenerateImageReferences({
          materializeWorkspaceArtifacts: async (relativePaths) => {
            materializedPaths = [...relativePaths]
            return {
              materializedArtifactPaths: new Set(relativePaths),
              missingArtifactPaths: new Set<string>(),
            }
          },
          refs: [
            'skill-assets/murph-character-sheet-v1.png',
            'raw/inbox/style.jpg',
            'skill-assets/pose.webp',
          ],
          skillsRoot,
          vaultRoot,
        })

        expect(materializedPaths).toEqual(['raw/inbox/style.jpg'])
        expect(references.map((reference) => reference.filename)).toEqual([
          'reference-image-1.png',
          'reference-image-2.jpg',
          'reference-image-3.webp',
        ])
        expect(references.map((reference) => reference.sourceRef)).toEqual([
          'skill-assets/murph-character-sheet-v1.png',
          'raw/inbox/style.jpg',
          'skill-assets/pose.webp',
        ])
      })
    })
  })

  it('resolves duplicate skill asset refs the same way duplicate vault refs resolve', async () => {
    await withTempVault(async (vaultRoot) => {
      await withTempSkillsRoot(async (skillsRoot) => {
        await writeSkillAssetFile(skillsRoot, 'murph-character-sheet-v1.png', PNG_BYTES)

        const references = await resolveGenerateImageReferences({
          refs: [
            'skill-assets/murph-character-sheet-v1.png',
            'skill-assets/murph-character-sheet-v1.png',
          ],
          skillsRoot,
          vaultRoot,
        })

        expect(references.map((reference) => reference.filename)).toEqual([
          'reference-image-1.png',
          'reference-image-2.png',
        ])
        expect(references.map((reference) => reference.sourceRef)).toEqual([
          'skill-assets/murph-character-sheet-v1.png',
          'skill-assets/murph-character-sheet-v1.png',
        ])
        expect(references[0]?.sha256).toBe(references[1]?.sha256)
      })
    })
  })

  it('rejects missing hosted artifacts, unsupported bytes, and symlink escapes', async () => {
    await withTempVault(async (vaultRoot) => {
      await writeVaultFile(vaultRoot, 'raw/inbox/not-image.png', GIF_BYTES)

      await expect(
        resolveGenerateImageReferences({
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
            refs: ['raw/inbox/linked.png'],
            vaultRoot,
          }),
        ).rejects.toMatchObject({ code: 'ASSISTANT_PATH_OUTSIDE_VAULT' })
      } finally {
        await rm(outsideRoot, { force: true, recursive: true })
      }
    })
  })

  it('rejects files larger than the per-file budget while allowing generated-image-sized refs', async () => {
    expect(MAX_GENERATE_IMAGE_REFERENCE_BYTES).toBe(10 * 1024 * 1024)
    expect(MAX_GENERATE_IMAGE_REFERENCE_TOTAL_BYTES).toBe(32 * 1024 * 1024)

    await withTempVault(async (vaultRoot) => {
      const generatedSized = new Uint8Array(3 * 1024 * 1024)
      generatedSized.set(PNG_BYTES, 0)
      await writeVaultFile(vaultRoot, 'raw/captures/2026/07/generated/ref.png', generatedSized)

      await expect(
        resolveGenerateImageReferences({
          refs: ['raw/captures/2026/07/generated/ref.png'],
          vaultRoot,
        }),
      ).resolves.toMatchObject([
        {
          mediaType: 'image/png',
          sourceRef: 'raw/captures/2026/07/generated/ref.png',
        },
      ])

      const oversize = new Uint8Array(MAX_GENERATE_IMAGE_REFERENCE_BYTES + 1)
      oversize.set(PNG_BYTES, 0)
      await writeVaultFile(vaultRoot, 'raw/inbox/huge.png', oversize)

      await expect(
        resolveGenerateImageReferences({
          refs: ['raw/inbox/huge.png'],
          vaultRoot,
        }),
      ).rejects.toMatchObject({ code: 'ASSISTANT_IMAGE_REFERENCE_SIZE_UNSUPPORTED' })
    })
  })

  it('keeps the Murph product contract capped at sixteen ordered references', async () => {
    const seventeenRefs = [
      ...Array.from(
        { length: 15 },
        (_value, index) => `raw/inbox/${index + 1}.png`,
      ),
      'skill-assets/murph-character-sheet-v1.png',
      'skill-assets/pose.webp',
    ]
    await expect(
      resolveGenerateImageReferences({
        refs: seventeenRefs,
        skillsRoot: '/',
        vaultRoot: '/',
      }),
    ).rejects.toMatchObject({ code: 'ASSISTANT_IMAGE_REFERENCE_COUNT_UNSUPPORTED' })
  })

  it('counts vault and skill asset bytes against the same aggregate budget', async () => {
    await withTempVault(async (vaultRoot) => {
      await withTempSkillsRoot(async (skillsRoot) => {
        const nineMegabytePng = new Uint8Array(9 * 1024 * 1024)
        nineMegabytePng.set(PNG_BYTES, 0)
        await writeVaultFile(vaultRoot, 'raw/inbox/one.png', nineMegabytePng)
        await writeVaultFile(vaultRoot, 'raw/inbox/two.png', nineMegabytePng)
        await writeSkillAssetFile(skillsRoot, 'three.png', nineMegabytePng)
        await writeSkillAssetFile(skillsRoot, 'four.png', nineMegabytePng)

        await expect(
          resolveGenerateImageReferences({
            refs: [
              'raw/inbox/one.png',
              'skill-assets/three.png',
              'raw/inbox/two.png',
              'skill-assets/four.png',
            ],
            skillsRoot,
            vaultRoot,
          }),
        ).rejects.toMatchObject({
          code: 'ASSISTANT_IMAGE_REFERENCE_SIZE_UNSUPPORTED',
        })
      })
    })
  })
})
