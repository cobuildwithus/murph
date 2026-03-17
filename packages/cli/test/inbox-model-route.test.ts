import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test, vi } from 'vitest'
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

function createStubInboxServices(
  promoteDocument: InboxCliServices['promoteDocument'],
): InboxCliServices {
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
    show: async (input) => ({
      vault: input.vault,
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
        text: 'Please route this document to canonical storage.',
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
            derivedPath: null,
            parserProviderId: 'text-file',
            parseState: 'succeeded',
          },
        ],
      },
    }),
    search: async () => {
      throw new Error('not implemented')
    },
    promoteMeal: async () => {
      throw new Error('not implemented')
    },
    promoteDocument,
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

test('routeInboxCaptureWithModel previews and applies deterministic plans without calling a live model backend', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'hb-inbox-model-route-'))
  const promoteDocument = vi.fn(async () => ({
    vault: vaultRoot,
    captureId: 'cap_1',
    target: 'document' as const,
    lookupId: 'evt_1',
    relatedId: 'doc_1',
    created: true,
  }))
  const inboxServices = createStubInboxServices(promoteDocument)

  routeHarnessMocks.generateAssistantObject.mockResolvedValue({
    schema: 'healthybob.assistant-plan.v1',
    summary: 'Promote the capture as a document.',
    rationale: 'The capture contains a stored document attachment and no meal signals.',
    actions: [
      {
        tool: 'inbox.promote.document',
        input: {
          captureId: 'cap_1',
        },
      },
    ],
  })

  try {
    const preview = await routeInboxCaptureWithModel({
      inboxServices,
      requestId: 'req_preview',
      captureId: 'cap_1',
      vault: vaultRoot,
      apply: false,
      modelSpec: {
        model: 'anthropic/claude-sonnet-4-5',
      },
    })

    assert.equal(preview.apply, false)
    assert.equal(preview.model.providerMode, 'gateway')
    assert.equal(preview.results[0]?.status, 'previewed')
    assert.equal(promoteDocument.mock.calls.length, 0)
    assert.equal(routeHarnessMocks.resolveAssistantLanguageModel.mock.calls.length, 1)
    assert.equal(routeHarnessMocks.generateAssistantObject.mock.calls.length, 1)
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
            captureId: 'cap_1',
          },
        },
      ],
    })

    const applied = await routeInboxCaptureWithModel({
      inboxServices,
      requestId: 'req_apply',
      captureId: 'cap_1',
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
