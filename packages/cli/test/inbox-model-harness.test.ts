import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'vitest'
import { createDefaultAssistantToolCatalog } from '../src/assistant-cli-tools.js'
import { materializeInboxModelBundle } from '../src/inbox-model-harness.js'
import type { InboxCliServices } from '../src/inbox-services.js'
import type { VaultCliServices } from '../src/vault-cli-services.js'

function createStubVaultServices(overrides: Partial<VaultCliServices> = {}): VaultCliServices {
  return {
    core: {} as VaultCliServices['core'],
    importers: {} as VaultCliServices['importers'],
    query: {} as VaultCliServices['query'],
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
      raw: {},
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
      result.bundle.tools.some((tool) => tool.name === 'vault.show'),
      false,
    )
    assert.match(result.bundle.routingText, /Please file this lab summary/u)
    assert.match(result.bundle.routingText, /Extracted plain text from the attachment/u)
    assert.match(result.bundle.routingText, /Lab values and follow-up notes/u)

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
