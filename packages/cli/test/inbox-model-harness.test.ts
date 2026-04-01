import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test as baseTest, vi } from 'vitest'
import {
  initializeVault,
  upsertFood,
  upsertProtocolItem,
} from '@murphai/core'
import type { AssistantAskResult } from '@murphai/assistant-core/assistant-cli-contracts'
import { writeAssistantChatResultArtifacts } from '@murphai/assistant-core/assistant/automation/artifacts'
import {
  createDefaultAssistantToolCatalog,
  createInboxRoutingAssistantToolCatalog,
} from '@murphai/assistant-core/assistant-cli-tools'
import { materializeInboxModelBundle } from '@murphai/assistant-core/inbox-model-harness'
import type { InboxServices } from '@murphai/assistant-core/inbox-services'
import type { VaultServices } from '@murphai/assistant-core/vault-services'

const test = baseTest.sequential

function createStubVaultServices(overrides: Partial<VaultServices> = {}): VaultServices {
  return {
    core: {} as VaultServices['core'],
    importers: {} as VaultServices['importers'],
    query: {} as VaultServices['query'],
    devices: {} as VaultServices['devices'],
    ...overrides,
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

function createStubAssistantResult(vault: string): AssistantAskResult {
  return {
    vault,
    status: 'completed',
    prompt: 'Reply to the capture.',
    response: 'Acknowledged.',
    session: {
      schema: 'murph.assistant-session.v3',
      sessionId: 'asst_session_1',
      provider: 'codex-cli',
      providerOptions: {
        model: 'gpt-5.4',
        reasoningEffort: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
        baseUrl: undefined,
        apiKeyEnv: undefined,
        providerName: undefined,
      },
      providerBinding: null,
      alias: null,
      binding: {
        conversationKey: null,
        channel: null,
        identityId: null,
        actorId: null,
        threadId: null,
        threadIsDirect: null,
        delivery: null,
      },
      createdAt: '2026-03-13T10:00:00.000Z',
      updatedAt: '2026-03-13T10:00:00.000Z',
      lastTurnAt: '2026-03-13T10:00:00.000Z',
      turnCount: 1,
    },
    delivery: null,
    deliveryDeferred: false,
    deliveryIntentId: null,
    deliveryError: null,
    blocked: null,
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

test('materializeInboxModelBundle emits a text-only routing bundle with write-capable tools', async () => {
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
      source: 'imessage',
      accountId: 'self',
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
    const result = await materializeInboxModelBundle({
      inboxServices,
      requestId: 'req_bundle',
      captureId: 'cap_1',
      vault: vaultRoot,
      vaultServices,
    })

    assert.equal(result.bundle.schema, 'murph.inbox-model-bundle.v1')
    assert.equal(result.bundle.captureId, 'cap_1')
    assert.equal(result.bundle.preparedInputMode, 'text-only')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, false)
    assert.equal(result.bundle.attachments[0]?.routingImage.reason, 'not-image')
    assert.equal(
      result.bundle.tools.some((tool) => tool.name === 'inbox.promote.document'),
      true,
    )
    assert.equal(
      result.bundle.tools.some((tool) => tool.name === 'vault.document.import'),
      true,
    )
    assert.equal(
      result.bundle.tools.some((tool) => tool.name === 'vault.goal.upsert'),
      true,
    )
    assert.equal(
      result.bundle.tools.some((tool) => tool.name === 'vault.recipe.upsert'),
      true,
    )
    assert.equal(
      result.bundle.tools.some((tool) => tool.name === 'vault.food.upsert'),
      true,
    )
    assert.equal(
      result.bundle.tools.some((tool) => tool.name === 'vault.show'),
      false,
    )
    assert.equal(
      result.bundle.tools.some((tool) => tool.name === 'vault.protocol.stop'),
      false,
    )
    assert.match(result.bundle.routingText, /Please file this lab summary/u)
    assert.match(result.bundle.routingText, /Extracted plain text from the attachment/u)
    assert.match(result.bundle.routingText, /Lab values and follow-up notes/u)
    assert.doesNotMatch(result.bundle.routingText, /Tool reminders:/u)

    const persistedBundle = JSON.parse(
      await readFile(path.join(vaultRoot, result.bundlePath), 'utf8'),
    ) as {
      schema: string
      tools: Array<{ name: string }>
    }

    assert.equal(persistedBundle.schema, 'murph.inbox-model-bundle.v1')
    assert.equal(
      persistedBundle.tools.some((tool) => tool.name === 'inbox.promote.document'),
      true,
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
      source: 'imessage',
      accountId: 'self',
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
      source: 'imessage',
      accountId: 'self',
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
          parserProviderId: null,
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
    })

    assert.equal(result.bundle.preparedInputMode, 'multimodal')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, true)
    assert.equal(result.bundle.attachments[0]?.routingImage.reason, 'supported-format')
    assert.equal(result.bundle.attachments[0]?.routingImage.mediaType, 'image/jpeg')
    assert.match(result.bundle.routingText, /routingImageEligible: true/u)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('writeAssistantChatResultArtifacts rejects malicious capture ids before writing chat artifacts outside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-chat-malicious-vault-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-chat-malicious-outside-'))
  const maliciousCaptureId = path.posix.join('..', '..', '..', path.basename(outsideRoot))

  try {
    await assert.rejects(
      () =>
        writeAssistantChatResultArtifacts({
          captureIds: [maliciousCaptureId],
          respondedAt: '2026-03-13T10:05:00.000Z',
          result: createStubAssistantResult(vaultRoot),
          vault: vaultRoot,
        }),
      (error) => {
        assert.equal((error as { code?: string }).code, 'ASSISTANT_PATH_OUTSIDE_VAULT')
        return true
      },
    )

    assert.equal(
      await pathExists(path.join(outsideRoot, 'assistant', 'chat-result.json')),
      false,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle keeps unsupported HEIC meal photos on the text-only path', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-heic-bundle-'))

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_heic',
      source: 'imessage',
      accountId: 'self',
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
          parserProviderId: null,
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
    })

    assert.equal(result.bundle.preparedInputMode, 'text-only')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, false)
    assert.equal(result.bundle.attachments[0]?.routingImage.reason, 'unsupported-format')
    assert.equal(result.bundle.attachments[0]?.routingImage.mediaType, 'image/heic')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle marks parse-failed PDFs with no text as multimodal fallback candidates', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-inbox-model-pdf-fallback-bundle-'))

  const inboxServices = createStubInboxServices({
    vault: vaultRoot,
    capture: {
      captureId: 'cap_pdf_fallback',
      source: 'imessage',
      accountId: 'self',
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
          parserProviderId: 'pdftotext',
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
    })

    assert.equal(result.bundle.preparedInputMode, 'multimodal')
    assert.equal(result.bundle.attachments[0]?.routingImage.eligible, false)
    assert.match(result.bundle.routingText, /Prepared input mode: multimodal/u)
    assert.match(result.bundle.routingText, /parseState: failed/u)
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
    'outside-vault text should never enter the routing bundle',
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
      source: 'imessage',
      accountId: 'self',
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
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'lab-summary.pdf',
          storedPath: 'raw/inbox/captures/cap_2/attachments/1/lab-summary.pdf',
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
    })

    assert.doesNotMatch(
      result.bundle.routingText,
      /outside-vault text should never enter the routing bundle/u,
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

test('createInboxRoutingAssistantToolCatalog excludes assistant runtime tools and rejects file paths outside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-routing-tools-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-routing-outside-'))
  const importDocument = vi.fn(async () => ({
    vault: vaultRoot,
    lookupId: 'doc_1',
    documentId: 'doc_1',
    created: true,
    path: 'raw/documents/doc_1.pdf',
  }))
  const vaultServices = createStubVaultServices({
    importers: {
      importDocument,
    } as unknown as VaultServices['importers'],
  })

  try {
    await mkdir(path.join(vaultRoot, 'raw', 'inbox', 'captures', 'cap_1', 'attachments', '1'), {
      recursive: true,
    })
    await writeFile(path.join(outsideRoot, 'outside.pdf'), 'outside vault document', 'utf8')
    await symlink(
      path.join(outsideRoot, 'outside.pdf'),
      path.join(vaultRoot, 'raw', 'inbox', 'captures', 'cap_1', 'attachments', '1', 'linked.pdf'),
    )

    const catalog = createInboxRoutingAssistantToolCatalog({
      requestId: 'req_route',
      vault: vaultRoot,
      vaultServices,
    })

    assert.equal(catalog.hasTool('assistant.state.show'), false)
    assert.equal(catalog.hasTool('assistant.memory.search'), false)
    assert.equal(catalog.hasTool('assistant.cron.list'), false)
    assert.equal(catalog.hasTool('assistant.selfTarget.list'), false)
    assert.equal(catalog.hasTool('vault.fs.readText'), false)
    assert.equal(catalog.hasTool('vault.protocol.stop'), false)

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.document.import',
          input: {
            file: '../outside.pdf',
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'failed')
    assert.equal(results[0]?.errorCode, 'ASSISTANT_PATH_OUTSIDE_VAULT')
    assert.equal(importDocument.mock.calls.length, 0)

    const symlinkResults = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.document.import',
          input: {
            file: 'raw/inbox/captures/cap_1/attachments/1/linked.pdf',
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(symlinkResults[0]?.status, 'failed')
    assert.equal(symlinkResults[0]?.errorCode, 'ASSISTANT_PATH_OUTSIDE_VAULT')
    assert.equal(importDocument.mock.calls.length, 0)
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
      source: 'imessage',
      accountId: 'self',
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
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'unsafe.pdf',
          storedPath: 'raw/inbox/captures/cap_2/attachments/1/unsafe.pdf',
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
    })

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
    'bank secret text should never enter the routing bundle\n',
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
      source: 'imessage',
      accountId: 'self',
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
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'safe.pdf',
          storedPath: 'raw/inbox/captures/cap_3/attachments/1/safe.pdf',
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
    })

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
    'other capture text should never enter this routing bundle\n',
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
      source: 'imessage',
      accountId: 'self',
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
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'isolated.pdf',
          storedPath: 'raw/inbox/captures/cap_4/attachments/1/isolated.pdf',
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
    })

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

test('createDefaultAssistantToolCatalog exposes assistant runtime, recipe, and food tools', () => {
  const catalog = createDefaultAssistantToolCatalog({
    vault: '/tmp/murph-vault',
    vaultServices: createStubVaultServices(),
  })

  assert.equal(catalog.hasTool('assistant.state.show'), true)
  assert.equal(catalog.hasTool('assistant.memory.search'), true)
  assert.equal(catalog.hasTool('assistant.cron.list'), true)
  assert.equal(catalog.hasTool('assistant.selfTarget.list'), true)
  assert.equal(catalog.hasTool('vault.fs.readText'), true)
  assert.equal(catalog.hasTool('vault.recipe.show'), true)
  assert.equal(catalog.hasTool('vault.recipe.list'), true)
  assert.equal(catalog.hasTool('vault.recipe.upsert'), true)
  assert.equal(catalog.hasTool('vault.food.show'), true)
  assert.equal(catalog.hasTool('vault.food.list'), true)
  assert.equal(catalog.hasTool('vault.food.upsert'), true)
  assert.equal(catalog.hasTool('vault.share.createLink'), true)
})

test('createDefaultAssistantToolCatalog can bind a bounded text-read-only profile', () => {
  const catalog = createDefaultAssistantToolCatalog(
    {
      vault: '/tmp/murph-vault',
      vaultServices: createStubVaultServices(),
    },
    {
      includeAssistantRuntimeTools: false,
      includeQueryTools: false,
      includeStatefulWriteTools: false,
      includeVaultTextReadTool: true,
      includeVaultWriteTools: false,
    },
  )

  assert.equal(catalog.hasTool('vault.fs.readText'), true)
  assert.equal(catalog.hasTool('assistant.state.show'), false)
  assert.equal(catalog.hasTool('assistant.memory.search'), false)
  assert.equal(catalog.hasTool('assistant.cron.list'), false)
  assert.equal(catalog.hasTool('assistant.selfTarget.list'), false)
  assert.equal(catalog.hasTool('vault.show'), false)
  assert.equal(catalog.hasTool('vault.journal.append'), false)
  assert.equal(catalog.hasTool('vault.recipe.upsert'), false)
  assert.equal(catalog.hasTool('vault.share.createLink'), false)
})

test('createDefaultAssistantToolCatalog vault.fs.readText enforces bounded UTF-8 reads inside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-read-text-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-read-text-outside-'))
  const largeText = `${'A'.repeat(9_000)}${'B'.repeat(9_000)}${'C'.repeat(2_000)}`

  try {
    await mkdir(path.join(vaultRoot, 'notes'), { recursive: true })
    await writeFile(
      path.join(vaultRoot, 'notes', 'sample.md'),
      `${'A'.repeat(40)}\n${'B'.repeat(40)}`,
      'utf8',
    )
    await writeFile(path.join(vaultRoot, 'notes', 'large.txt'), largeText, 'utf8')
    await writeFile(
      path.join(vaultRoot, 'notes', 'invalid.txt'),
      Buffer.from([0xc3, 0x28]),
    )
    await writeFile(path.join(outsideRoot, 'outside.txt'), 'outside vault text', 'utf8')
    await symlink(
      path.join(outsideRoot, 'outside.txt'),
      path.join(vaultRoot, 'notes', 'linked.txt'),
    )

    const catalog = createDefaultAssistantToolCatalog({
      requestId: 'req_text_read',
      vault: vaultRoot,
      vaultServices: createStubVaultServices(),
    })

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.fs.readText',
          input: {
            path: 'notes/sample.md',
            maxChars: 32,
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'succeeded')
    const readResult = results[0]?.result as {
      path: string
      text: string
      totalChars: number
      truncated: boolean
    }
    assert.equal(readResult.path, 'notes/sample.md')
    assert.equal(readResult.totalChars, 81)
    assert.equal(readResult.truncated, true)
    assert.match(readResult.text, /^A{32}\n\n\[truncated 49 characters\]$/u)

    const largeResults = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.fs.readText',
          input: {
            path: 'notes/large.txt',
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(largeResults[0]?.status, 'succeeded')
    const largeReadResult = largeResults[0]?.result as {
      path: string
      text: string
      totalChars: number
      truncated: boolean
    }
    assert.equal(largeReadResult.path, 'notes/large.txt')
    assert.equal(largeReadResult.totalChars, largeText.length)
    assert.equal(largeReadResult.truncated, true)
    assert.equal(largeReadResult.text.length, 8_030)
    assert.equal(largeReadResult.text.startsWith('A'.repeat(8_000)), true)
    assert.match(largeReadResult.text, /\[truncated 12000 characters\]$/u)

    const outsideResults = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.fs.readText',
          input: {
            path: '../outside.txt',
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(outsideResults[0]?.status, 'failed')
    assert.equal(outsideResults[0]?.errorCode, 'ASSISTANT_PATH_OUTSIDE_VAULT')

    const symlinkResults = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.fs.readText',
          input: {
            path: 'notes/linked.txt',
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(symlinkResults[0]?.status, 'failed')
    assert.equal(symlinkResults[0]?.errorCode, 'ASSISTANT_PATH_OUTSIDE_VAULT')

    const invalidResults = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.fs.readText',
          input: {
            path: 'notes/invalid.txt',
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(invalidResults[0]?.status, 'failed')
    assert.equal(invalidResults[0]?.errorCode, 'ASSISTANT_TOOL_FILE_NOT_TEXT')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
})

test('createDefaultAssistantToolCatalog recipe upsert writes payload files and calls the recipe service with inputFile', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-recipe-tools-'))
  let recordedCall:
    | {
        inputFile: string
        requestId: string | null
        vault: string
      }
    | undefined

  const vaultServices = createStubVaultServices({
    core: {
      upsertRecipe: async (input) => {
        recordedCall = input
        return {
          vault: input.vault,
          lookupId: 'rcp_1',
          recipeId: 'rcp_1',
          created: true,
          path: 'bank/recipes/sheet-pan-salmon-bowls.md',
        }
      },
    } as VaultServices['core'],
  })

  try {
    const catalog = createDefaultAssistantToolCatalog(
      {
        requestId: 'req_recipe',
        vault: vaultRoot,
        vaultServices,
      },
      { includeQueryTools: false },
    )

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.recipe.upsert',
          input: {
            payload: {
              title: 'Sheet Pan Salmon Bowls',
              status: 'saved',
              ingredients: ['2 salmon fillets', '2 cups cooked rice'],
            },
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'succeeded')
    assert.ok(recordedCall)
    assert.equal(recordedCall?.vault, vaultRoot)
    assert.equal(recordedCall?.requestId, 'req_recipe')
    assert.match(recordedCall?.inputFile ?? '', /derived\/assistant\/payloads/u)

    const persistedPayload = JSON.parse(
      await readFile(recordedCall!.inputFile, 'utf8'),
    ) as {
      title: string
      status: string
      ingredients: string[]
    }

    assert.deepEqual(persistedPayload, {
      title: 'Sheet Pan Salmon Bowls',
      status: 'saved',
      ingredients: ['2 salmon fillets', '2 cups cooked rice'],
    })
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('createDefaultAssistantToolCatalog food upsert writes payload files and calls the food service with inputFile', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-food-tools-'))
  let recordedCall:
    | {
        inputFile: string
        requestId: string | null
        vault: string
      }
    | undefined

  const vaultServices = createStubVaultServices({
    core: {
      upsertFood: async (input) => {
        recordedCall = input
        return {
          vault: input.vault,
          lookupId: 'food_1',
          foodId: 'food_1',
          created: true,
          path: 'bank/foods/regular-acai-bowl.md',
        }
      },
    } as VaultServices['core'],
  })

  try {
    const catalog = createDefaultAssistantToolCatalog(
      {
        requestId: 'req_food',
        vault: vaultRoot,
        vaultServices,
      },
      { includeQueryTools: false },
    )

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.food.upsert',
          input: {
            payload: {
              title: 'Regular Acai Bowl',
              status: 'active',
              vendor: 'Neighborhood Acai Bar',
            },
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'succeeded')
    assert.ok(recordedCall)
    assert.equal(recordedCall?.vault, vaultRoot)
    assert.equal(recordedCall?.requestId, 'req_food')
    assert.match(recordedCall?.inputFile ?? '', /derived\/assistant\/payloads/u)

    const persistedPayload = JSON.parse(
      await readFile(recordedCall!.inputFile, 'utf8'),
    ) as {
      title: string
      status: string
      vendor: string
    }

    assert.deepEqual(persistedPayload, {
      title: 'Regular Acai Bowl',
      status: 'active',
      vendor: 'Neighborhood Acai Bar',
    })
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('createDefaultAssistantToolCatalog share-link tool exports attached protocols and posts the hosted request', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-share-tools-'))
  const originalBaseUrl = process.env.HOSTED_SHARE_API_BASE_URL
  const originalToken = process.env.HOSTED_SHARE_INTERNAL_TOKEN
  const originalFetch = global.fetch
  let recordedRequest:
    | {
        body: Record<string, unknown>
        headers: Headers
        url: string
      }
    | undefined

  process.env.HOSTED_SHARE_API_BASE_URL = 'https://share.example.test'
  process.env.HOSTED_SHARE_INTERNAL_TOKEN = 'share-token'
  global.fetch = vi.fn(async (input, init) => {
    recordedRequest = {
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: new Headers(init?.headers),
      url: String(input),
    }

    return new Response(
      JSON.stringify({
        shareCode: 'share_123',
        shareUrl: 'https://share.example.test/share/share_123',
        url: 'https://share.example.test/share/share_123',
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      },
    )
  }) as typeof global.fetch

  try {
    await initializeVault({ vaultRoot })
    const creatine = await upsertProtocolItem({
      vaultRoot,
      title: 'Creatine monohydrate',
      kind: 'supplement',
      group: 'supplement',
      startedOn: '2026-03-01',
      schedule: 'daily',
    })
    await upsertFood({
      vaultRoot,
      title: 'Morning Smoothie',
      kind: 'smoothie',
      attachedProtocolIds: [creatine.record.entity.protocolId],
    })

    const catalog = createDefaultAssistantToolCatalog(
      {
        requestId: 'req_share',
        vault: vaultRoot,
        vaultServices: createStubVaultServices(),
      },
      { includeQueryTools: false },
    )

    assert.equal(catalog.hasTool('vault.share.createLink'), true)

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.share.createLink',
          input: {
            foods: [{ slug: 'morning-smoothie' }],
            includeAttachedProtocols: true,
            logMeal: {
              food: { slug: 'morning-smoothie' },
            },
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'succeeded')
    assert.equal(recordedRequest?.url, 'https://share.example.test/api/hosted-share/internal/create')
    assert.equal(recordedRequest?.headers.get('authorization'), 'Bearer share-token')
    assert.equal(recordedRequest?.body.shareCode, undefined)
    assert.equal(recordedRequest?.body.senderMemberId, null)
    assert.equal((recordedRequest?.body.pack as { title?: string })?.title, 'Morning Smoothie')
    assert.equal(
      Array.isArray((recordedRequest?.body.pack as { entities?: unknown[] })?.entities),
      true,
    )
    assert.equal(
      ((recordedRequest?.body.pack as {
        entities?: Array<{ kind: string; payload?: { attachedProtocolRefs?: string[] } }>
      })?.entities ?? []).some(
        (entity) =>
          entity.kind === 'food'
          && Array.isArray(entity.payload?.attachedProtocolRefs)
          && entity.payload.attachedProtocolRefs.length === 1,
      ),
      true,
    )
    assert.deepEqual(results[0]?.result, {
      shareCode: 'share_123',
      shareUrl: 'https://share.example.test/share/share_123',
      url: 'https://share.example.test/share/share_123',
    })
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.HOSTED_SHARE_API_BASE_URL
    } else {
      process.env.HOSTED_SHARE_API_BASE_URL = originalBaseUrl
    }

    if (originalToken === undefined) {
      delete process.env.HOSTED_SHARE_INTERNAL_TOKEN
    } else {
      process.env.HOSTED_SHARE_INTERNAL_TOKEN = originalToken
    }

    global.fetch = originalFetch
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('createDefaultAssistantToolCatalog share-link tool uses hosted sender identity from execution context', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-share-tools-hosted-'))
  const originalBaseUrl = process.env.HOSTED_SHARE_API_BASE_URL
  const originalToken = process.env.HOSTED_SHARE_INTERNAL_TOKEN
  const originalFetch = global.fetch
  let recordedRequest:
    | {
        body: Record<string, unknown>
        headers: Headers
        url: string
      }
    | undefined

  process.env.HOSTED_SHARE_API_BASE_URL = 'https://share.example.test'
  process.env.HOSTED_SHARE_INTERNAL_TOKEN = 'share-token'
  global.fetch = vi.fn(async (input, init) => {
    recordedRequest = {
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      headers: new Headers(init?.headers),
      url: String(input),
    }

    return new Response(
      JSON.stringify({
        shareCode: 'share_456',
        shareUrl: 'https://share.example.test/share/share_456',
        url: 'https://share.example.test/share/share_456',
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 200,
      },
    )
  }) as typeof global.fetch

  try {
    await initializeVault({ vaultRoot })
    await upsertFood({
      vaultRoot,
      title: 'Morning Smoothie',
      kind: 'smoothie',
    })

    const catalog = createDefaultAssistantToolCatalog(
      {
        executionContext: {
          hosted: {
            memberId: 'member_123',
            userEnvKeys: ['OPENAI_API_KEY'],
          },
        },
        requestId: 'req_share_hosted',
        vault: vaultRoot,
        vaultServices: createStubVaultServices(),
      },
      { includeQueryTools: false },
    )

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.share.createLink',
          input: {
            foods: [{ slug: 'morning-smoothie' }],
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'succeeded')
    assert.equal(recordedRequest?.body.senderMemberId, 'member_123')
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.HOSTED_SHARE_API_BASE_URL
    } else {
      process.env.HOSTED_SHARE_API_BASE_URL = originalBaseUrl
    }

    if (originalToken === undefined) {
      delete process.env.HOSTED_SHARE_INTERNAL_TOKEN
    } else {
      process.env.HOSTED_SHARE_INTERNAL_TOKEN = originalToken
    }

    global.fetch = originalFetch
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('createDefaultAssistantToolCatalog share-link tool surfaces hosted API errors', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-share-tools-error-'))
  const originalBaseUrl = process.env.HOSTED_SHARE_API_BASE_URL
  const originalToken = process.env.HOSTED_SHARE_INTERNAL_TOKEN
  const originalFetch = global.fetch

  process.env.HOSTED_SHARE_API_BASE_URL = 'https://share.example.test'
  process.env.HOSTED_SHARE_INTERNAL_TOKEN = 'share-token'
  global.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        error: {
          message: 'Hosted share link creation failed upstream.',
        },
      }),
      {
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
        status: 502,
      },
    ),
  ) as typeof global.fetch

  try {
    await initializeVault({ vaultRoot })
    await upsertFood({
      vaultRoot,
      title: 'Morning Smoothie',
      kind: 'smoothie',
    })

    const catalog = createDefaultAssistantToolCatalog(
      {
        requestId: 'req_share_error',
        vault: vaultRoot,
        vaultServices: createStubVaultServices(),
      },
      { includeQueryTools: false },
    )

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.share.createLink',
          input: {
            foods: [{ slug: 'morning-smoothie' }],
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'failed')
    assert.equal(results[0]?.errorCode, 'ASSISTANT_TOOL_EXECUTION_FAILED')
    assert.match(results[0]?.errorMessage ?? '', /Hosted share link creation failed upstream\./u)
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.HOSTED_SHARE_API_BASE_URL
    } else {
      process.env.HOSTED_SHARE_API_BASE_URL = originalBaseUrl
    }

    if (originalToken === undefined) {
      delete process.env.HOSTED_SHARE_INTERNAL_TOKEN
    } else {
      process.env.HOSTED_SHARE_INTERNAL_TOKEN = originalToken
    }

    global.fetch = originalFetch
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('createDefaultAssistantToolCatalog health upserts write payload files and call the goal service with input', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-tools-'))
  let recordedCall:
    | {
        input: string
        requestId: string | null
        vault: string
      }
    | undefined

  const vaultServices = createStubVaultServices({
    core: {
      upsertGoal: async (input) => {
        recordedCall = input
        return {
          vault: input.vault,
          lookupId: 'goal_1',
          goalId: 'goal_1',
          created: true,
          path: 'bank/goals/goal_1.md',
        }
      },
    } as VaultServices['core'],
  })

  try {
    const catalog = createDefaultAssistantToolCatalog(
      {
        requestId: 'req_goal',
        vault: vaultRoot,
        vaultServices,
      },
      { includeQueryTools: false },
    )

    const results = await catalog.executeCalls({
      calls: [
        {
          tool: 'vault.goal.upsert',
          input: {
            payload: {
              title: 'Walk daily',
              status: 'active',
            },
          },
        },
      ],
      mode: 'apply',
    })

    assert.equal(results[0]?.status, 'succeeded')
    assert.ok(recordedCall)
    assert.equal(recordedCall?.vault, vaultRoot)
    assert.equal(recordedCall?.requestId, 'req_goal')
    assert.match(recordedCall?.input ?? '', /derived\/assistant\/payloads/u)

    const persistedPayload = JSON.parse(
      await readFile(recordedCall!.input, 'utf8'),
    ) as {
      title: string
      status: string
    }

    assert.deepEqual(persistedPayload, {
      title: 'Walk daily',
      status: 'active',
    })
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
