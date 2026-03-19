import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, test, vi } from 'vitest'
import type { InboxShowResult } from '../src/inbox-cli-contracts.js'
import type { InboxCliServices } from '../src/inbox-services.js'

const routeHarnessMocks = vi.hoisted(() => ({
  generateAssistantObject: vi.fn(),
  resolveAssistantLanguageModel: vi.fn(() => ({ provider: 'mock-model' })),
}))

vi.mock('../src/model-harness.js', async () => {
  const actual = await vi.importActual<typeof import('../src/model-harness.js')>(
    '../src/model-harness.js',
  )

  return {
    ...actual,
    generateAssistantObject: routeHarnessMocks.generateAssistantObject,
    resolveAssistantLanguageModel: routeHarnessMocks.resolveAssistantLanguageModel,
  }
})

import { routeInboxCaptureWithModel } from '../src/inbox-model-harness.js'

afterEach(() => {
  routeHarnessMocks.generateAssistantObject.mockReset()
  routeHarnessMocks.resolveAssistantLanguageModel.mockClear()
  routeHarnessMocks.resolveAssistantLanguageModel.mockReturnValue({
    provider: 'mock-model',
  })
})

function createStubInboxServices(input: {
  promoteDocument?: InboxCliServices['promoteDocument']
  promoteMeal?: InboxCliServices['promoteMeal']
  showResult: InboxShowResult
}): InboxCliServices {
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
    show: async () => input.showResult,
    search: async () => {
      throw new Error('not implemented')
    },
    promoteMeal:
      input.promoteMeal ??
      (async () => {
        throw new Error('not implemented')
      }),
    promoteDocument:
      input.promoteDocument ??
      (async () => {
        throw new Error('not implemented')
      }),
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

function createDocumentShowResult(vaultRoot: string): InboxShowResult {
  return {
    vault: vaultRoot,
    capture: {
      captureId: 'cap_doc',
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
      text: 'Please route this document to canonical storage.',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_doc/envelope.json',
      eventId: 'evt_doc',
      promotions: [],
      createdAt: '2026-03-13T10:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_doc',
          ordinal: 1,
          kind: 'document',
          mime: 'application/pdf',
          fileName: 'lab-summary.pdf',
          storedPath: 'raw/inbox/captures/cap_doc/attachments/1/lab-summary.pdf',
          extractedText: 'CBC and lipid panel attached.',
          transcriptText: null,
          derivedPath: null,
          parserProviderId: 'text-file',
          parseState: 'succeeded',
        },
      ],
    },
  }
}

function createImageShowResult(vaultRoot: string, mime: string, fileName: string): InboxShowResult {
  return {
    vault: vaultRoot,
    capture: {
      captureId: 'cap_photo',
      source: 'imessage',
      accountId: 'self',
      externalId: 'message-2',
      threadId: 'thread-2',
      threadTitle: 'Meal log',
      actorId: 'self',
      actorName: 'Me',
      actorIsSelf: true,
      occurredAt: '2026-03-14T18:00:00.000Z',
      receivedAt: '2026-03-14T18:00:02.000Z',
      text: 'Dinner',
      attachmentCount: 1,
      envelopePath: 'raw/inbox/captures/cap_photo/envelope.json',
      eventId: 'evt_photo',
      promotions: [],
      createdAt: '2026-03-14T18:00:02.000Z',
      threadIsDirect: true,
      attachments: [
        {
          attachmentId: 'att_photo',
          ordinal: 1,
          kind: 'image',
          mime,
          fileName,
          storedPath: `raw/inbox/captures/cap_photo/attachments/1/${fileName}`,
          extractedText: null,
          transcriptText: null,
          derivedPath: null,
          parserProviderId: null,
          parseState: 'pending',
        },
      ],
    },
  }
}

test('routeInboxCaptureWithModel previews and applies text-only document plans without calling a live model backend', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-route-doc-'))
  const promoteDocument = vi.fn(async () => ({
    vault: vaultRoot,
    captureId: 'cap_doc',
    target: 'document' as const,
    lookupId: 'evt_doc',
    relatedId: 'doc_1',
    created: true,
  }))
  const inboxServices = createStubInboxServices({
    promoteDocument,
    showResult: createDocumentShowResult(vaultRoot),
  })

  routeHarnessMocks.generateAssistantObject.mockResolvedValue({
    schema: 'healthybob.assistant-plan.v1',
    summary: 'Promote the capture as a document.',
    rationale: 'The capture contains a stored document attachment and no meal signals.',
    actions: [
      {
        tool: 'inbox.promote.document',
        input: {
          captureId: 'cap_doc',
        },
      },
    ],
  })

  try {
    const preview = await routeInboxCaptureWithModel({
      inboxServices,
      requestId: 'req_preview',
      captureId: 'cap_doc',
      vault: vaultRoot,
      apply: false,
      modelSpec: {
        model: 'anthropic/claude-sonnet-4-5',
      },
    })

    assert.equal(preview.apply, false)
    assert.equal(preview.model.providerMode, 'gateway')
    assert.equal(preview.preparedInputMode, 'text-only')
    assert.equal(preview.inputMode, 'text-only')
    assert.equal(preview.fallbackError, null)
    assert.equal(preview.results[0]?.status, 'previewed')
    assert.equal(promoteDocument.mock.calls.length, 0)
    assert.equal(routeHarnessMocks.resolveAssistantLanguageModel.mock.calls.length, 1)
    assert.equal(routeHarnessMocks.generateAssistantObject.mock.calls.length, 1)
    assert.equal(
      routeHarnessMocks.generateAssistantObject.mock.calls[0]?.[0]?.messages,
      undefined,
    )
    assert.equal(
      JSON.parse(await readFile(path.join(vaultRoot, preview.planPath), 'utf8')).schema,
      'healthybob.assistant-plan.v1',
    )
    assert.equal(
      JSON.parse(await readFile(path.join(vaultRoot, preview.resultPath!), 'utf8')).apply,
      false,
    )

    routeHarnessMocks.generateAssistantObject.mockResolvedValueOnce({
      schema: 'healthybob.assistant-plan.v1',
      summary: 'Promote the capture as a document.',
      rationale: 'The capture contains a stored document attachment and no meal signals.',
      actions: [
        {
          tool: 'inbox.promote.document',
          input: {
            captureId: 'cap_doc',
          },
        },
      ],
    })

    const applied = await routeInboxCaptureWithModel({
      inboxServices,
      requestId: 'req_apply',
      captureId: 'cap_doc',
      vault: vaultRoot,
      apply: true,
      modelSpec: {
        model: 'local-model',
        baseUrl: 'http://127.0.0.1:11434/v1',
      },
    })

    assert.equal(applied.apply, true)
    assert.equal(applied.model.providerMode, 'openai-compatible')
    assert.equal(applied.results[0]?.status, 'succeeded')
    assert.equal(promoteDocument.mock.calls.length, 1)
    assert.equal(
      JSON.parse(await readFile(path.join(vaultRoot, applied.resultPath!), 'utf8')).apply,
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('routeInboxCaptureWithModel forwards supported image bytes as multimodal routing evidence', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-route-photo-'))
  const imageDirectory = path.join(
    vaultRoot,
    'raw',
    'inbox',
    'captures',
    'cap_photo',
    'attachments',
    '1',
  )
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00])
  await mkdir(imageDirectory, { recursive: true })
  await writeFile(path.join(imageDirectory, 'meal.jpg'), imageBytes)

  const inboxServices = createStubInboxServices({
    showResult: createImageShowResult(vaultRoot, 'image/jpeg', 'meal.jpg'),
  })

  routeHarnessMocks.generateAssistantObject.mockResolvedValue({
    schema: 'healthybob.assistant-plan.v1',
    summary: 'Promote the capture as a meal.',
    rationale: 'The image is a self-authored meal photo.',
    actions: [
      {
        tool: 'inbox.promote.meal',
        input: {
          captureId: 'cap_photo',
        },
      },
    ],
  })

  try {
    const preview = await routeInboxCaptureWithModel({
      inboxServices,
      requestId: 'req_meal_preview',
      captureId: 'cap_photo',
      vault: vaultRoot,
      apply: false,
      modelSpec: {
        model: 'anthropic/claude-sonnet-4-5',
      },
    })

    assert.equal(preview.preparedInputMode, 'multimodal')
    assert.equal(preview.inputMode, 'multimodal')
    assert.equal(preview.fallbackError, null)

    const generationInput = routeHarnessMocks.generateAssistantObject.mock.calls[0]?.[0] as {
      messages?: Array<{
        content?: Array<{
          type: string
          image?: unknown
          text?: string
          mediaType?: string
          mimeType?: string
        }>
      }>
    }
    const content = generationInput.messages?.[0]?.content ?? []
    const imagePart = content.find((part) => part.type === 'image')

    assert.ok(imagePart)
    assert.equal(Buffer.isBuffer(imagePart.image), true)
    assert.deepEqual(imagePart.image, imageBytes)
    assert.equal(imagePart.mediaType, 'image/jpeg')
    assert.equal(imagePart.mimeType, 'image/jpeg')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('routeInboxCaptureWithModel falls back to text-only when a provider rejects multimodal image input', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-route-fallback-'))
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
    showResult: createImageShowResult(vaultRoot, 'image/jpeg', 'meal.jpg'),
  })

  routeHarnessMocks.generateAssistantObject
    .mockRejectedValueOnce(new Error('The selected model does not support image input.'))
    .mockResolvedValueOnce({
      schema: 'healthybob.assistant-plan.v1',
      summary: 'Promote the capture as a meal.',
      rationale: 'The capture text and metadata still indicate a meal photo.',
      actions: [
        {
          tool: 'inbox.promote.meal',
          input: {
            captureId: 'cap_photo',
          },
        },
      ],
    })

  try {
    const preview = await routeInboxCaptureWithModel({
      inboxServices,
      requestId: 'req_fallback_preview',
      captureId: 'cap_photo',
      vault: vaultRoot,
      apply: false,
      modelSpec: {
        model: 'anthropic/claude-sonnet-4-5',
      },
    })

    assert.equal(routeHarnessMocks.generateAssistantObject.mock.calls.length, 2)
    assert.equal(preview.preparedInputMode, 'multimodal')
    assert.equal(preview.inputMode, 'text-only')
    assert.equal(preview.fallbackError, 'The selected model does not support image input.')
    assert.ok(routeHarnessMocks.generateAssistantObject.mock.calls[0]?.[0]?.messages)
    assert.equal(
      routeHarnessMocks.generateAssistantObject.mock.calls[1]?.[0]?.messages,
      undefined,
    )
    assert.equal(
      typeof routeHarnessMocks.generateAssistantObject.mock.calls[1]?.[0]?.prompt,
      'string',
    )

    const persistedResult = JSON.parse(
      await readFile(path.join(vaultRoot, preview.resultPath!), 'utf8'),
    ) as {
      inputMode: string
      fallbackError: string | null
    }

    assert.equal(persistedResult.inputMode, 'text-only')
    assert.equal(
      persistedResult.fallbackError,
      'The selected model does not support image input.',
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('routeInboxCaptureWithModel falls back to text-only when eligible routing images cannot be loaded', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-route-missing-image-'))

  const inboxServices = createStubInboxServices({
    showResult: createImageShowResult(vaultRoot, 'image/jpeg', 'missing.jpg'),
  })

  routeHarnessMocks.generateAssistantObject.mockResolvedValue({
    schema: 'healthybob.assistant-plan.v1',
    summary: 'Promote the capture as a meal.',
    rationale: 'The capture text still indicates a meal photo.',
    actions: [
      {
        tool: 'inbox.promote.meal',
        input: {
          captureId: 'cap_photo',
        },
      },
    ],
  })

  try {
    const preview = await routeInboxCaptureWithModel({
      inboxServices,
      requestId: 'req_missing_image_preview',
      captureId: 'cap_photo',
      vault: vaultRoot,
      apply: false,
      modelSpec: {
        model: 'anthropic/claude-sonnet-4-5',
      },
    })

    assert.equal(routeHarnessMocks.generateAssistantObject.mock.calls.length, 1)
    assert.equal(preview.preparedInputMode, 'multimodal')
    assert.equal(preview.inputMode, 'text-only')
    assert.match(
      preview.fallbackError ?? '',
      /Falling back to text-only routing because image evidence could not be loaded/u,
    )
    assert.equal(
      routeHarnessMocks.generateAssistantObject.mock.calls[0]?.[0]?.messages,
      undefined,
    )
    assert.equal(
      typeof routeHarnessMocks.generateAssistantObject.mock.calls[0]?.[0]?.prompt,
      'string',
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
