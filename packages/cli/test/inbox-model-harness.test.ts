import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test as baseTest } from 'vitest'
import { materializeInboxModelBundle } from '../src/inbox-model-harness.ts'
import type { InboxServices } from '@murphai/inbox-services'
import type { VaultServices } from '@murphai/vault-usecases'
import { resolveAssistantStatePaths } from '@murphai/runtime-state/node'

const test = baseTest.sequential

interface StubVaultServicesOverrides {
  core?: Partial<VaultServices['core']>
  importers?: Partial<VaultServices['importers']>
  query?: Partial<VaultServices['query']>
}

function createStubVaultServices(
  overrides: StubVaultServicesOverrides = {},
): VaultServices {
  return {
    core: { ...(overrides.core ?? {}) } as VaultServices['core'],
    importers: { ...(overrides.importers ?? {}) } as VaultServices['importers'],
    query: { ...(overrides.query ?? {}) } as VaultServices['query'],
  }
}

function createStubInboxServices(showResult: Awaited<ReturnType<InboxServices['show']>>): InboxServices {
  return {
    init: async () => {
      throw new Error('not implemented')
    },
    bootstrap: async () => {
      throw new Error('not implemented')
    },
    setup: async () => {
      throw new Error('not implemented')
    },
    sourceAdd: async () => {
      throw new Error('not implemented')
    },
    sourceRemove: async () => {
      throw new Error('not implemented')
    },
    sourceSetEnabled: async () => {
      throw new Error('not implemented')
    },
    sourceList: async () => {
      throw new Error('not implemented')
    },
    doctor: async () => {
      throw new Error('not implemented')
    },
    status: async () => {
      throw new Error('not implemented')
    },
    backfill: async () => {
      throw new Error('not implemented')
    },
    run: async () => {
      throw new Error('not implemented')
    },
    stop: async () => {
      throw new Error('not implemented')
    },
    list: async () => {
      throw new Error('not implemented')
    },
    show: async () => showResult,
    search: async () => {
      throw new Error('not implemented')
    },
    preserveDocumentAttachments: async () => {
      throw new Error('not implemented')
    },
    promoteMeal: async () => {
      throw new Error('not implemented')
    },
    promoteDocument: async () => {
      throw new Error('not implemented')
    },
    promoteJournal: async () => {
      throw new Error('not implemented')
    },
    promoteExperimentNote: async () => {
      throw new Error('not implemented')
    },
    listAttachments: async () => {
      throw new Error('not implemented')
    },
    showAttachment: async () => {
      throw new Error('not implemented')
    },
    showAttachmentStatus: async () => {
      throw new Error('not implemented')
    },
    parse: async () => {
      throw new Error('not implemented')
    },
    requeue: async () => {
      throw new Error('not implemented')
    },
    parseAttachment: async () => {
      throw new Error('not implemented')
    },
    reparseAttachment: async () => {
      throw new Error('not implemented')
    },
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

test('materializeInboxModelBundle emits a text-only capture audit bundle', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-bundle-'))
  const derivedDirectory = path.join(vaultRoot, 'derived', 'inbox', 'cap_1', 'attachment-1')
  await mkdir(derivedDirectory, { recursive: true })
  await writeFile(
    path.join(derivedDirectory, 'plain.txt'),
    'Extracted plain text from the attachment.\n',
    'utf8',
  )
  await writeFile(
    path.join(derivedDirectory, 'notes.md'),
    '# Parsed Markdown\n\nLab values and follow-up notes.\n',
    'utf8',
  )
  await writeFile(
    path.join(derivedDirectory, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: 'derived/inbox/cap_1/attachment-1/plain.txt',
          markdownPath: 'derived/inbox/cap_1/attachment-1/notes.md',
          tablesPath: null,
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_1',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-1',
      threadId: 'thread-1',
      threadTitle: 'Care team',
      actorId: 'contact-1',
      actorName: 'Clinician',
      actorIsSelf: false,
      occurredAt: '2026-03-13T10:00:00.000Z',
      receivedAt: '2026-03-13T10:00:02.000Z',
      text: 'Please file this lab summary and note the follow-up plan.',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_1/envelope.json',
      eventId: 'evt_1',
      promotions: [],
      createdAt: '2026-03-13T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_1',
          ordinal: 1,
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'lab-summary.pdf',
          storedPath: 'raw/inbox/captures/cap_1/attachments/1/lab-summary.pdf',
          extractedText: 'CBC and lipid panel attached.',
          transcriptText: null,
          derivedPath: 'derived/inbox/cap_1/attachment-1/manifest.json',
          parserProviderId: 'text-file',
          parseState: 'succeeded',
        },
      ],
    },
  })
  const vaultServices = createStubVaultServices()

  try {
    const pathOnlyResult = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle',
      captureId: 'cap_1',
      vault: vaultRoot,
      vaultServices,
    })

    assert.equal(pathOnlyResult.bundle, null)

    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle',
      captureId: 'cap_1',
      vault: vaultRoot,
      vaultServices,
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.equal(result.bundle.schema, 'murph.inbox-model-bundle.v1')
    assert.equal(result.bundle.captureId, 'cap_1')
    assert.equal(result.bundle.preparedInputMode, 'text-only')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, false)
    assert.equal(result.bundle.attachments[0]?.routingImage.reason, 'not-image')
    assert.match(result.bundle.routingText, /Please file this lab summary/u)
    assert.match(
      result.bundle.routingText,
      /storedPath: raw\/inbox\/captures\/cap_1\/attachments\/1\/lab-summary\.pdf/u,
    )
    assert.doesNotMatch(result.bundle.routingText, /Extracted plain text from the attachment/u)
    assert.doesNotMatch(result.bundle.routingText, /Lab values and follow-up notes/u)
    assert.deepEqual(
      result.bundle.attachments[0]?.fragments.map((fragment) => fragment.kind),
      ['attachment_metadata'],
    )

    const persistedBundle = JSON.parse(
      await readFile(path.join(vaultRoot, result.bundlePath), 'utf8'),
    ) as {
      schema: string
    }

    assert.equal(persistedBundle.schema, 'murph.inbox-model-bundle.v1')
    assert.equal(
      (await stat(path.dirname(path.join(vaultRoot, result.bundlePath)))).mode & 0o777,
      0o700,
    )
    assert.equal(
      (await stat(path.join(vaultRoot, result.bundlePath))).mode & 0o777,
      0o600,
    )

    const repeatedResult = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle',
      captureId: 'cap_1',
      vault: vaultRoot,
      vaultServices,
      includeSensitiveBundle: true,
    })

    assert.equal(repeatedResult.bundlePath, result.bundlePath)
    assert.deepEqual(repeatedResult.bundle, result.bundle)
    assert.deepEqual(
      JSON.parse(
        await readFile(path.join(vaultRoot, repeatedResult.bundlePath), 'utf8'),
      ),
      persistedBundle,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle rejects malicious capture ids before writing bundle artifacts outside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-malicious-bundle-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-malicious-outside-'))
  const maliciousCaptureId = path.posix.join('..', '..', '..', path.basename(outsideRoot))

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: maliciousCaptureId,
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-malicious',
      threadId: 'thread-malicious',
      threadTitle: 'Care team',
      actorId: 'contact-unsafe',
      actorName: 'Unsafe',
      actorIsSelf: false,
      occurredAt: '2026-03-13T10:00:00.000Z',
      receivedAt: '2026-03-13T10:00:02.000Z',
      text: 'Do not write outside the vault.',
      attachmentCount: 0,
      envelopePath: 'raw/inbox/captures/cap_malicious/envelope.json',
      eventId: 'evt_malicious',
      promotions: [],
      createdAt: '2026-03-13T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [],
    },
  })

  try {
    await assert.rejects(
      () =>
        materializeInboxModelBundle({
          inboxServices,
          requestId: 'req_bundle_malicious',
          captureId: maliciousCaptureId,
          vault: vaultRoot,
          vaultServices: createStubVaultServices(),
        }),
      (error) => {
        assert.equal((error as { code?: string }).code, 'ASSISTANT_PATH_OUTSIDE_VAULT')
        return true
      },
    )

    assert.equal(
      await pathExists(path.join(outsideRoot, 'assistant', 'bundle.json')),
      false,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle marks supported meal photos as multimodal-ready routing inputs', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-photo-bundle-'))
  const imageDirectory = path.join(
    vaultRoot,
    'raw',
    'inbox',
    'captures',
    'cap_photo',
    'attachments',
    '1',
  )
  await mkdir(imageDirectory, { recursive: true })
  await writeFile(path.join(imageDirectory, 'meal.jpg'), Buffer.from([0xff, 0xd8, 0xff]))

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_photo',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-photo',
      threadId: 'thread-photo',
      threadTitle: 'Meal log',
      actorId: 'self',
      actorName: 'Me',
      actorIsSelf: true,
      occurredAt: '2026-03-13T18:00:00.000Z',
      receivedAt: '2026-03-13T18:00:02.000Z',
      text: 'Dinner',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_photo/envelope.json',
      eventId: 'evt_photo',
      promotions: [],
      createdAt: '2026-03-13T18:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_photo',
          ordinal: 1,
          kind: 'image',
          mime: 'image/jpeg',
          fileName: 'meal.jpg',
          storedPath: 'raw/inbox/captures/cap_photo/attachments/1/meal.jpg',
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parseState: 'pending',
        },
      ],
    },
  })

  try {
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle_photo',
      captureId: 'cap_photo',
      vault: vaultRoot,
      vaultServices: createStubVaultServices(),
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.equal(result.bundle.preparedInputMode, 'multimodal')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, true)
    assert.equal(result.bundle.attachments[0]?.routingImage.reason, 'supported-format')
    assert.equal(result.bundle.attachments[0]?.routingImage.mediaType, 'image/jpeg')
    assert.match(result.bundle.routingText, /routingImageEligible: true/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle keeps unsupported HEIC meal photos on the text-only path', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-heic-bundle-'))

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_heic',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-heic',
      threadId: 'thread-heic',
      threadTitle: 'Meal log',
      actorId: 'self',
      actorName: 'Me',
      actorIsSelf: true,
      occurredAt: '2026-03-13T18:00:00.000Z',
      receivedAt: '2026-03-13T18:00:02.000Z',
      text: 'Dinner',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_heic/envelope.json',
      eventId: 'evt_heic',
      promotions: [],
      createdAt: '2026-03-13T18:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_heic',
          ordinal: 1,
          kind: 'image',
          mime: 'image/heic',
          fileName: 'dinner.heic',
          storedPath: 'raw/inbox/captures/cap_heic/attachments/1/dinner.heic',
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parseState: 'pending',
        },
      ],
    },
  })

  try {
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle_heic',
      captureId: 'cap_heic',
      vault: vaultRoot,
      vaultServices: createStubVaultServices(),
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.equal(result.bundle.preparedInputMode, 'text-only')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, false)
    assert.equal(result.bundle.attachments[0]?.routingImage.reason, 'unsupported-format')
    assert.equal(result.bundle.attachments[0]?.routingImage.mediaType, 'image/heic')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle keeps parse-failed PDFs as stored-path metadata', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-pdf-fallback-bundle-'))

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_pdf_fallback',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-pdf-fallback',
      threadId: 'thread-pdf-fallback',
      threadTitle: 'Care team',
      actorId: 'contact-1',
      actorName: 'Clinician',
      actorIsSelf: false,
      occurredAt: '2026-03-15T10:00:00.000Z',
      receivedAt: '2026-03-15T10:00:02.000Z',
      text: 'Please route this scanned PDF.',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_pdf_fallback/envelope.json',
      eventId: 'evt_pdf_fallback',
      promotions: [],
      createdAt: '2026-03-15T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_pdf_fallback',
          ordinal: 1,
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'scanned-lab.pdf',
          storedPath: 'raw/inbox/captures/cap_pdf_fallback/attachments/1/scanned-lab.pdf',
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parseState: 'failed',
        },
      ],
    },
  })

  try {
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle_pdf_fallback',
      captureId: 'cap_pdf_fallback',
      vault: vaultRoot,
      vaultServices: createStubVaultServices(),
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.equal(result.bundle.preparedInputMode, 'text-only')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, false)
    assert.match(result.bundle.routingText, /Prepared input mode: text-only/u)
    assert.match(
      result.bundle.routingText,
      /storedPath: raw\/inbox\/captures\/cap_pdf_fallback\/attachments\/1\/scanned-lab\.pdf/u,
    )
    assert.doesNotMatch(result.bundle.routingText, /parseState: failed/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle ignores derived parser paths that escape the vault through symlinks', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-bundle-symlink-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-outside-'))
  const derivedDirectory = path.join(vaultRoot, 'derived', 'inbox', 'cap_2', 'attachment-1')
  const linkedPlainText = path.join(derivedDirectory, 'linked-plain.txt')
  await mkdir(derivedDirectory, { recursive: true })
  await writeFile(
    path.join(outsideRoot, 'secret.txt'),
    'outside-vault text should never enter the capture bundle',
    'utf8',
  )
  await symlink(path.join(outsideRoot, 'secret.txt'), linkedPlainText)
  await writeFile(
    path.join(derivedDirectory, 'notes.md'),
    '# Parsed Markdown\n\nIn-vault markdown still loads.\n',
    'utf8',
  )
  await writeFile(
    path.join(derivedDirectory, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: 'derived/inbox/cap_2/attachment-1/linked-plain.txt',
          markdownPath: 'derived/inbox/cap_2/attachment-1/notes.md',
          tablesPath: null,
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_2',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-2',
      threadId: 'thread-2',
      threadTitle: 'Care team',
      actorId: 'contact-1',
      actorName: 'Clinician',
      actorIsSelf: false,
      occurredAt: '2026-03-13T10:00:00.000Z',
      receivedAt: '2026-03-13T10:00:02.000Z',
      text: 'Please file this attachment safely.',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_2/envelope.json',
      eventId: 'evt_2',
      promotions: [],
      createdAt: '2026-03-13T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_2',
          ordinal: 1,
          kind: 'audio',
          mime: 'audio/mp4',
          fileName: 'voice-summary.m4a',
          storedPath: 'raw/inbox/captures/cap_2/attachments/1/voice-summary.m4a',
          extractedText: 'CBC and lipid panel attached.',
          transcriptText: null,
          derivedPath: 'derived/inbox/cap_2/attachment-1/manifest.json',
          parserProviderId: 'text-file',
          parseState: 'succeeded',
        },
      ],
    },
  })

  try {
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle_symlink',
      captureId: 'cap_2',
      vault: vaultRoot,
      vaultServices: createStubVaultServices(),
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.doesNotMatch(
      result.bundle.routingText,
      /outside-vault text should never enter the capture bundle/u,
    )
    assert.equal(
      result.bundle.attachments[0]?.fragments.some(
        (fragment) => fragment.kind === 'derived_plain_text',
      ),
      false,
    )
    assert.equal(
      result.bundle.attachments[0]?.fragments.some(
        (fragment) =>
          fragment.kind === 'derived_markdown' &&
          /In-vault markdown still loads/u.test(fragment.text),
      ),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle ignores derived parser paths that resolve outside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-bundle-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-outside-'))
  const derivedDirectory = path.join(vaultRoot, 'derived', 'inbox', 'cap_2', 'attachment-1')
  const outsideTextPath = path.join(outsideRoot, 'outside.txt')

  await mkdir(derivedDirectory, { recursive: true })
  await writeFile(outsideTextPath, 'This text should never be read into the bundle.\n', 'utf8')
  await writeFile(
    path.join(derivedDirectory, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: outsideTextPath,
          markdownPath: outsideTextPath,
          tablesPath: null,
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_2',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-2',
      threadId: 'thread-2',
      threadTitle: 'Care team',
      actorId: 'contact-2',
      actorName: 'Clinician',
      actorIsSelf: false,
      occurredAt: '2026-03-13T10:00:00.000Z',
      receivedAt: '2026-03-13T10:00:02.000Z',
      text: 'Please review this external file path.',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_2/envelope.json',
      eventId: 'evt_2',
      promotions: [],
      createdAt: '2026-03-13T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_2',
          ordinal: 1,
          kind: 'audio',
          mime: 'audio/mp4',
          fileName: 'unsafe.m4a',
          storedPath: 'raw/inbox/captures/cap_2/attachments/1/unsafe.m4a',
          extractedText: null,
          transcriptText: null,
          derivedPath: 'derived/inbox/cap_2/attachment-1/manifest.json',
          parserProviderId: 'text-file',
          parseState: 'succeeded',
        },
      ],
    },
  })

  try {
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle_outside',
      captureId: 'cap_2',
      vault: vaultRoot,
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.equal(result.bundle.attachments[0]?.fragments.length, 1)
    assert.equal(
      result.bundle.attachments[0]?.fragments.some((fragment) =>
        fragment.kind.startsWith('derived_'),
      ),
      false,
    )
    assert.doesNotMatch(
      result.bundle.routingText,
      /This text should never be read into the bundle/u,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle ignores manifest entries that point at in-vault bank content outside the attachment subtree', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-bundle-bank-path-'))
  const derivedDirectory = path.join(vaultRoot, 'derived', 'inbox', 'cap_3', 'attachment-1')
  await mkdir(derivedDirectory, { recursive: true })
  await mkdir(path.join(vaultRoot, 'bank'), { recursive: true })
  await writeFile(
    path.join(vaultRoot, 'bank', 'secret.md'),
    'bank secret text should never enter the capture bundle\n',
    'utf8',
  )
  await writeFile(
    path.join(derivedDirectory, 'notes.md'),
    '# Parsed Markdown\n\nAllowed attachment notes.\n',
    'utf8',
  )
  await writeFile(
    path.join(derivedDirectory, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: 'bank/secret.md',
          markdownPath: 'derived/inbox/cap_3/attachment-1/notes.md',
          tablesPath: null,
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_3',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-3',
      threadId: 'thread-3',
      threadTitle: 'Care team',
      actorId: 'contact-3',
      actorName: 'Clinician',
      actorIsSelf: false,
      occurredAt: '2026-03-13T10:00:00.000Z',
      receivedAt: '2026-03-13T10:00:02.000Z',
      text: 'Please route this document safely.',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_3/envelope.json',
      eventId: 'evt_3',
      promotions: [],
      createdAt: '2026-03-13T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_3',
          ordinal: 1,
          kind: 'audio',
          mime: 'audio/mp4',
          fileName: 'safe.m4a',
          storedPath: 'raw/inbox/captures/cap_3/attachments/1/safe.m4a',
          extractedText: null,
          transcriptText: null,
          derivedPath: 'derived/inbox/cap_3/attachment-1/manifest.json',
          parserProviderId: 'text-file',
          parseState: 'succeeded',
        },
      ],
    },
  })

  try {
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle_bank_path',
      captureId: 'cap_3',
      vault: vaultRoot,
      vaultServices: createStubVaultServices(),
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.doesNotMatch(result.bundle.routingText, /bank secret text should never enter/u)
    assert.equal(
      result.bundle.attachments[0]?.fragments.some(
        (fragment) =>
          fragment.kind === 'derived_plain_text' &&
          /bank secret text should never enter/u.test(fragment.text),
      ),
      false,
    )
    assert.equal(
      result.bundle.attachments[0]?.fragments.some(
        (fragment) =>
          fragment.kind === 'derived_markdown' &&
          /Allowed attachment notes\./u.test(fragment.text),
      ),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle ignores derived manifests from another capture subtree inside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-bundle-cross-capture-'))
  const otherDerivedDirectory = path.join(
    vaultRoot,
    'derived',
    'inbox',
    'cap_other',
    'attachment-1',
  )
  await mkdir(otherDerivedDirectory, { recursive: true })
  await writeFile(
    path.join(otherDerivedDirectory, 'plain.txt'),
    'other capture text should never enter this capture bundle\n',
    'utf8',
  )
  await writeFile(
    path.join(otherDerivedDirectory, 'notes.md'),
    '# Other Capture\n\nCross-capture text.\n',
    'utf8',
  )
  await writeFile(
    path.join(otherDerivedDirectory, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'murph.parser-manifest.v1',
        paths: {
          plainTextPath: 'derived/inbox/cap_other/attachment-1/plain.txt',
          markdownPath: 'derived/inbox/cap_other/attachment-1/notes.md',
          tablesPath: null,
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_4',
      source: 'telegram',
      accountId: 'bot',
      externalId: 'message-4',
      threadId: 'thread-4',
      threadTitle: 'Care team',
      actorId: 'contact-4',
      actorName: 'Clinician',
      actorIsSelf: false,
      occurredAt: '2026-03-13T10:00:00.000Z',
      receivedAt: '2026-03-13T10:00:02.000Z',
      text: 'Please keep this capture isolated.',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_4/envelope.json',
      eventId: 'evt_4',
      promotions: [],
      createdAt: '2026-03-13T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_4',
          ordinal: 1,
          kind: 'audio',
          mime: 'audio/mp4',
          fileName: 'isolated.m4a',
          storedPath: 'raw/inbox/captures/cap_4/attachments/1/isolated.m4a',
          extractedText: null,
          transcriptText: null,
          derivedPath: 'derived/inbox/cap_other/attachment-1/manifest.json',
          parserProviderId: 'text-file',
          parseState: 'succeeded',
        },
      ],
    },
  })

  try {
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle_cross_capture',
      captureId: 'cap_4',
      vault: vaultRoot,
      vaultServices: createStubVaultServices(),
      includeSensitiveBundle: true,
    })

    assert.ok(result.bundle)
    assert.equal(
      result.bundle.attachments[0]?.fragments.some((fragment) =>
        fragment.kind.startsWith('derived_'),
      ),
      false,
    )
    assert.doesNotMatch(result.bundle.routingText, /other capture text should never enter/u)
    assert.doesNotMatch(result.bundle.routingText, /Cross-capture text/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
