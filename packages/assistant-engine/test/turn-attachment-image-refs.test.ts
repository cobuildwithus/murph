import { describe, expect, it } from 'vitest'

import type { AssistantInputAttachmentEvidenceItem } from '../src/assistant/automation.js'
import { authorizeReferenceImageEvidence } from '../src/assistant-codex/turn-attachment-image-refs.js'

const SHA256_FIXTURE =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function buildAttachment(
  overrides: Partial<AssistantInputAttachmentEvidenceItem>,
): AssistantInputAttachmentEvidenceItem {
  return {
    byteSize: 1024,
    derived: null,
    descriptorAttachmentId: 'a-1',
    fileName: 'photo.jpg',
    inlineFragments: [],
    kind: 'image',
    mime: 'image/jpeg',
    ordinal: 1,
    parseState: null,
    raw: {
      byteSize: 1024,
      kind: 'vault-relative-file',
      mediaType: 'image/jpeg',
      path: 'raw/inbox/photo.jpg',
      sha256: SHA256_FIXTURE,
    },
    sourceAttachmentId: 'src-1',
    ...overrides,
  }
}

describe('authorizeReferenceImageEvidence', () => {
  it('authorizes canonical JPEG/PNG/WebP attachments', () => {
    expect(authorizeReferenceImageEvidence(buildAttachment({}))).toEqual({
      rawPath: 'raw/inbox/photo.jpg',
      sha256: SHA256_FIXTURE,
    })
    expect(
      authorizeReferenceImageEvidence(
        buildAttachment({
          fileName: 'shot.png',
          mime: 'image/png',
          raw: {
            byteSize: 1024,
            kind: 'vault-relative-file',
            mediaType: 'image/png',
            path: 'raw/inbox/shot.png',
            sha256: SHA256_FIXTURE,
          },
        }),
      ),
    ).toMatchObject({ rawPath: 'raw/inbox/shot.png' })
    expect(
      authorizeReferenceImageEvidence(
        buildAttachment({
          fileName: 'layout.webp',
          mime: 'image/webp',
          raw: {
            byteSize: 1024,
            kind: 'vault-relative-file',
            mediaType: 'image/webp',
            path: 'raw/inbox/layout.webp',
            sha256: SHA256_FIXTURE,
          },
        }),
      ),
    ).toMatchObject({ rawPath: 'raw/inbox/layout.webp' })
  })

  it('authorizes attachments with legacy or generic MIME but supported extension', () => {
    // image/jpg, image/pjpeg, image/x-png are realistic upload/mail MIME shapes
    // that the routing-vision eligibility normalizer already accepts.
    for (const mime of ['image/jpg', 'image/pjpeg', 'image/x-png', 'application/octet-stream']) {
      const ext = mime === 'image/x-png' ? 'png' : 'jpg'
      const result = authorizeReferenceImageEvidence(
        buildAttachment({
          fileName: `photo.${ext}`,
          mime,
          raw: {
            byteSize: 1024,
            kind: 'vault-relative-file',
            mediaType: mime,
            path: `raw/inbox/photo.${ext}`,
            sha256: SHA256_FIXTURE,
          },
        }),
      )
      expect(result, `mime ${mime}`).toMatchObject({
        rawPath: `raw/inbox/photo.${ext}`,
      })
    }
  })

  it('rejects GIF even though routing-vision treats it as eligible', () => {
    expect(
      authorizeReferenceImageEvidence(
        buildAttachment({
          fileName: 'reaction.gif',
          mime: 'image/gif',
          raw: {
            byteSize: 1024,
            kind: 'vault-relative-file',
            mediaType: 'image/gif',
            path: 'raw/inbox/reaction.gif',
            sha256: SHA256_FIXTURE,
          },
        }),
      ),
    ).toBeNull()
  })

  it('rejects non-image kinds, missing raw paths, and missing sha256', () => {
    expect(
      authorizeReferenceImageEvidence(buildAttachment({ kind: 'document' })),
    ).toBeNull()
    expect(
      authorizeReferenceImageEvidence(buildAttachment({ raw: null })),
    ).toBeNull()
    expect(
      authorizeReferenceImageEvidence(
        buildAttachment({
          raw: {
            byteSize: 1024,
            kind: 'vault-relative-file',
            mediaType: 'image/jpeg',
            path: 'raw/inbox/photo.jpg',
            sha256: null,
          },
        }),
      ),
    ).toBeNull()
  })
})
