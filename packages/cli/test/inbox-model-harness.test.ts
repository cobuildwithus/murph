import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test, vi } from 'vitest'
import type { AssistantAskResult } from '../src/assistant-cli-contracts.js'
import { writeAssistantChatResultArtifacts } from '../src/assistant/automation/artifacts.js'
import {
  createDefaultAssistantToolCatalog,
  createInboxRoutingAssistantToolCatalog,
} from '../src/assistant-cli-tools.js'
import { materializeInboxModelBundle } from '../src/inbox-model-harness.js'
import type { InboxCliServices } from '../src/inbox-services.js'
import type { VaultCliServices } from '../src/vault-cli-services.js'

function createStubVaultServices(overrides: Partial<VaultCliServices> = {}): VaultCliServices {
  return {
    core: {} as VaultCliServices['core'],
    importers: {} as VaultCliServices['importers'],
    query: {} as VaultCliServices['query'],
    devices: {} as VaultCliServices['devices'],
    ...overrides,
  }
}

function createStubInboxServices(showResult: Awaited<ReturnType<InboxCliServices['show']>>): InboxCliServices {
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
    prompt: 'Reply to the capture.',
    response: 'Acknowledged.',
    session: {
      schema: 'healthybob.assistant-session.v2',
      sessionId: 'asst_session_1',
      provider: 'codex-cli',
      providerSessionId: null,
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-bundle-'))
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
        schema: 'healthybob.parser-manifest.v1',
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

    assert.equal(result.bundle.schema, 'healthybob.inbox-model-bundle.v1')
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
      result.bundle.tools.some((tool) => tool.name === 'vault.regimen.stop'),
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

    assert.equal(persistedBundle.schema, 'healthybob.inbox-model-bundle.v1')
    assert.equal(
      persistedBundle.tools.some((tool) => tool.name === 'inbox.promote.document'),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('materializeInboxModelBundle rejects malicious capture ids before writing bundle artifacts outside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-malicious-bundle-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-malicious-outside-'))
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-photo-bundle-'))
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-assistant-chat-malicious-vault-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'hb-assistant-chat-malicious-outside-'))
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-heic-bundle-'))

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

test('materializeInboxModelBundle ignores derived parser paths that escape the vault through symlinks', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-bundle-symlink-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-outside-'))
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
        schema: 'healthybob.parser-manifest.v1',
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

test('createInboxRoutingAssistantToolCatalog excludes stateful write tools and rejects file paths outside the vault', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-assistant-routing-tools-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'hb-assistant-routing-outside-'))
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
    } as unknown as VaultCliServices['importers'],
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

    assert.equal(catalog.hasTool('vault.regimen.stop'), false)

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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-bundle-'))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-outside-'))
  const derivedDirectory = path.join(vaultRoot, 'derived', 'inbox', 'cap_2', 'attachment-1')
  const outsideTextPath = path.join(outsideRoot, 'outside.txt')

  await mkdir(derivedDirectory, { recursive: true })
  await writeFile(outsideTextPath, 'This text should never be read into the bundle.\n', 'utf8')
  await writeFile(
    path.join(derivedDirectory, 'manifest.json'),
    JSON.stringify(
      {
        schema: 'healthybob.parser-manifest.v1',
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

test('createDefaultAssistantToolCatalog exposes recipe and food query and write tools', () => {
  const catalog = createDefaultAssistantToolCatalog({
    vault: '/tmp/healthybob-vault',
    vaultServices: createStubVaultServices(),
  })

  assert.equal(catalog.hasTool('vault.recipe.show'), true)
  assert.equal(catalog.hasTool('vault.recipe.list'), true)
  assert.equal(catalog.hasTool('vault.recipe.upsert'), true)
  assert.equal(catalog.hasTool('vault.food.show'), true)
  assert.equal(catalog.hasTool('vault.food.list'), true)
  assert.equal(catalog.hasTool('vault.food.upsert'), true)
})

test('createDefaultAssistantToolCatalog recipe upsert writes payload files and calls the recipe service with inputFile', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-assistant-recipe-tools-'))
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
    } as VaultCliServices['core'],
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
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-assistant-food-tools-'))
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
    } as VaultCliServices['core'],
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

test('createDefaultAssistantToolCatalog health upserts write payload files and call the goal service with input', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-assistant-tools-'))
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
    } as VaultCliServices['core'],
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
