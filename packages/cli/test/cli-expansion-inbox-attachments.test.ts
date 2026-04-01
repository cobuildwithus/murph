import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { openSqliteRuntimeDatabase } from '@murphai/runtime-state/node'
import { createIntegratedInboxServices } from '@murphai/assistant-core/inbox-services'
import { createVaultCli } from '../src/vault-cli.js'
import { createUnwiredVaultServices } from '@murphai/assistant-core/vault-services'
import { requireData, type CliEnvelope } from './cli-test-helpers.js'

const builtCoreRuntimeUrl = new URL('../../core/dist/index.js', import.meta.url).href
const builtInboxRuntimeUrl = new URL('../../inboxd/dist/index.js', import.meta.url).href

async function makeVaultFixture(prefix: string): Promise<{
  homeRoot: string
  photoPath: string
  vaultRoot: string
}> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), `${prefix}-vault-`))
  const homeRoot = await mkdtemp(path.join(tmpdir(), `${prefix}-home-`))
  const photoPath = path.join(vaultRoot, 'meal-photo.jpg')
  const messagesDbPath = path.join(homeRoot, 'Library', 'Messages', 'chat.db')

  const coreRuntime = await loadBuiltCoreRuntime()
  await coreRuntime.initializeVault({
    vaultRoot,
    createdAt: '2026-03-13T12:00:00.000Z',
  })
  await writeFile(photoPath, 'photo', 'utf8')
  await mkdir(path.dirname(messagesDbPath), { recursive: true })
  const messagesDb = openSqliteRuntimeDatabase(messagesDbPath, {
    create: true,
    foreignKeys: false,
  })
  messagesDb.close()

  return {
    homeRoot,
    photoPath,
    vaultRoot,
  }
}

async function loadBuiltCoreRuntime() {
  return (await import(builtCoreRuntimeUrl)) as {
    createExperiment(input: {
      vaultRoot: string
      slug: string
      title?: string
      startedOn?: string
      hypothesis?: string
      status?: string
    }): Promise<{
      experiment: {
        id: string
        relativePath: string
        slug: string
      }
    }>
    initializeVault(input: {
      vaultRoot: string
      createdAt: string
    }): Promise<void>
  }
}

async function loadBuiltInboxRuntime() {
  return (await import(builtInboxRuntimeUrl)) as {
    openInboxRuntime(input: { vaultRoot: string }): Promise<{
      close(): void
      getCapture(captureId: string): {
        captureId: string
        eventId: string
        attachments: Array<{
          attachmentId?: string | null
          derivedPath?: string | null
          extractedText?: string | null
          parseState?: string | null
        }>
      } | null
      claimNextAttachmentParseJob(filters?: {
        captureId?: string
        attachmentId?: string
      }): {
        jobId: string
        attachmentId: string
        captureId: string
        attempts: number
      } | null
      completeAttachmentParseJob(input: {
        jobId: string
        attempt: number
        providerId: string
        resultPath: string
        extractedText?: string | null
      }): unknown
    }>
  }
}

async function runInProcessInboxCli<TData>(
  args: string[],
  inboxServices: ReturnType<typeof createIntegratedInboxServices>,
): Promise<CliEnvelope<TData>> {
  const cli = createVaultCli(createUnwiredVaultServices(), inboxServices)
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

function createFakeImessageDriver(input: {
  photoPath: string
  attachments?: Array<{
    guid: string
    fileName: string
    path: string
    mimeType: string
  }>
  text?: string
}) {
  return {
    async listChats() {
      return [{ guid: 'chat-1', displayName: 'Breakfast', participantCount: 2 }]
    },
    async getMessages() {
      return [
        {
          guid: 'im-1',
          text: input.text ?? 'Toast and eggs',
          date: '2026-03-13T08:00:00.000Z',
          dateRead: '2026-03-13T08:00:10.000Z',
          chatGuid: 'chat-1',
          handleId: 'friend',
          displayName: 'Friend',
          isFromMe: false,
          attachments:
            input.attachments ?? [
              {
                guid: 'att-1',
                fileName: 'meal-photo.jpg',
                path: input.photoPath,
                mimeType: 'image/jpeg',
              },
            ],
        },
      ]
    },
  }
}

function createFakeParsersModule() {
  return {
    async createConfiguredParserRegistry() {
      return {
        doctor: {} as never,
        registry: {},
      }
    },
    createInboxParserService(input: { runtime: unknown }) {
      return {
        async drain(filters?: { attachmentId?: string; captureId?: string }) {
          const runtime = input.runtime as {
            claimNextAttachmentParseJob(filters?: {
              attachmentId?: string
              captureId?: string
            }): {
              jobId: string
              attachmentId: string
              captureId: string
              attempts: number
            } | null
            completeAttachmentParseJob(input: {
              jobId: string
              attempt: number
              providerId: string
              resultPath: string
              extractedText?: string | null
            }): unknown
          }
          const job = runtime.claimNextAttachmentParseJob(filters)
          if (!job) {
            return []
          }

          runtime.completeAttachmentParseJob({
            jobId: job.jobId,
            attempt: job.attempts,
            providerId: 'fake-parser',
            resultPath: 'derived/inbox/parse-result.json',
            extractedText: 'Parsed attachment text',
          })

          return [
            {
              status: 'succeeded' as const,
              job: {
                captureId: job.captureId,
                attachmentId: job.attachmentId,
              },
              providerId: 'fake-parser',
              manifestPath: 'derived/inbox/parse-result.json',
            },
          ]
        },
      }
    },
    async discoverParserToolchain() {
      throw new Error('not used in this test')
    },
    async writeParserToolchainConfig() {
      throw new Error('not used in this test')
    },
  }
}

async function initializeImessageSource(input: {
  services: ReturnType<typeof createIntegratedInboxServices>
  vaultRoot: string
}) {
  await input.services.init({
    vault: input.vaultRoot,
    requestId: null,
  })
  await input.services.sourceAdd({
    vault: input.vaultRoot,
    requestId: null,
    source: 'imessage',
    id: 'imessage:self',
    account: 'self',
    includeOwn: true,
  })
}

async function captureSingleCapture(input: {
  services: ReturnType<typeof createIntegratedInboxServices>
  vaultRoot: string
}) {
  const listed = await input.services.list({
    vault: input.vaultRoot,
    requestId: null,
    limit: 10,
  })
  const captureId = listed.items[0]?.captureId
  assert.ok(captureId)
  const shown = await input.services.show({
    vault: input.vaultRoot,
    requestId: null,
    captureId,
  })
  return shown.capture
}

test.sequential(
  'inbox attachment commands expose stored metadata, parse status, and requeue support',
  async () => {
    const fixture = await makeVaultFixture('murph-inbox-attachments')
    const pdfPath = path.join(fixture.vaultRoot, 'lab-result.pdf')
    const services = createIntegratedInboxServices({
      enableJournalPromotion: true,
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime as never,
      loadInboxModule: loadBuiltInboxRuntime as never,
      loadParsersModule: async () => createFakeParsersModule() as never,
      loadImessageDriver: async () =>
        createFakeImessageDriver({
          photoPath: fixture.photoPath,
          attachments: [
            {
              guid: 'att-1',
              fileName: 'lab-result.pdf',
              path: pdfPath,
              mimeType: 'application/pdf',
            },
          ],
        }),
    })

    try {
      await writeFile(pdfPath, 'pdf', 'utf8')
      await initializeImessageSource({
        services,
        vaultRoot: fixture.vaultRoot,
      })
      await services.backfill({
        vault: fixture.vaultRoot,
        requestId: null,
        sourceId: 'imessage:self',
      })
      const capture = await captureSingleCapture({
        services,
        vaultRoot: fixture.vaultRoot,
      })
      const attachmentId = capture.attachments[0]?.attachmentId
      assert.ok(attachmentId)

      const inboxRuntime = await loadBuiltInboxRuntime()
      const runtime = await inboxRuntime.openInboxRuntime({
        vaultRoot: fixture.vaultRoot,
      })
      try {
        const pendingJob = runtime.claimNextAttachmentParseJob({ attachmentId })
        assert.ok(pendingJob)
        runtime.completeAttachmentParseJob({
          jobId: pendingJob.jobId,
          attempt: pendingJob.attempts,
          providerId: 'fake-image-parser',
          resultPath: 'derived/inbox/manifest.json',
          extractedText: 'Glucose 88 mg/dL',
        })
      } finally {
        runtime.close()
      }

      const listed = requireData(
        await runInProcessInboxCli<{
          captureId: string
          attachmentCount: number
          attachments: Array<{
            attachmentId: string | null
            parseState: string | null
            derivedPath: string | null
          }>
        }>(
          ['inbox', 'attachment', 'list', capture.captureId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(listed.captureId, capture.captureId)
      assert.equal(listed.attachmentCount, 1)
      assert.equal(listed.attachments[0]?.attachmentId, attachmentId)
      assert.equal(listed.attachments[0]?.parseState, 'succeeded')

      const shown = requireData(
        await runInProcessInboxCli<{
          captureId: string
          attachment: {
            attachmentId: string | null
            derivedPath: string | null
            extractedText: string | null
          }
        }>(
          ['inbox', 'attachment', 'show', attachmentId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(shown.captureId, capture.captureId)
      assert.equal(shown.attachment.attachmentId, attachmentId)
      assert.equal(shown.attachment.derivedPath, 'derived/inbox/manifest.json')
      assert.equal(shown.attachment.extractedText, 'Glucose 88 mg/dL')

      const status = requireData(
        await runInProcessInboxCli<{
          attachmentId: string
          currentState: string | null
          parseable: boolean
          jobs: Array<{
            state: string
            resultPath: string | null
          }>
        }>(
          ['inbox', 'attachment', 'show-status', attachmentId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(status.attachmentId, attachmentId)
      assert.equal(status.parseable, true)
      assert.equal(status.currentState, 'succeeded')
      assert.equal(status.jobs[0]?.state, 'succeeded')
      assert.equal(status.jobs[0]?.resultPath, 'derived/inbox/manifest.json')

      const parsed = requireData(
        await runInProcessInboxCli<{
          attachmentId: string
          attempted: number
          succeeded: number
          failed: number
          currentState: string | null
          jobs: Array<{
            state: string
          }>
          results: Array<{
            attachmentId: string
          }>
        }>(
          ['inbox', 'attachment', 'parse', attachmentId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(parsed.attachmentId, attachmentId)
      assert.equal(parsed.attempted, 0)
      assert.equal(parsed.succeeded, 0)
      assert.equal(parsed.failed, 0)
      assert.equal(parsed.currentState, 'succeeded')
      assert.equal(parsed.jobs[0]?.state, 'succeeded')
      assert.equal(parsed.results.length, 0)

      const reparsed = requireData(
        await runInProcessInboxCli<{
          attachmentId: string
          requeuedJobs: number
          currentState: string | null
          jobs: Array<{
            state: string
          }>
        }>(
          ['inbox', 'attachment', 'reparse', attachmentId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(reparsed.attachmentId, attachmentId)
      assert.equal(reparsed.requeuedJobs, 1)
      assert.equal(reparsed.currentState, 'pending')
      assert.equal(reparsed.jobs[0]?.state, 'pending')

      const parsedAfterRequeue = requireData(
        await runInProcessInboxCli<{
          attachmentId: string
          attempted: number
          succeeded: number
          failed: number
          currentState: string | null
          results: Array<{
            providerId: string | null
            manifestPath: string | null
          }>
        }>(
          ['inbox', 'attachment', 'parse', attachmentId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(parsedAfterRequeue.attachmentId, attachmentId)
      assert.equal(parsedAfterRequeue.attempted, 1)
      assert.equal(parsedAfterRequeue.succeeded, 1)
      assert.equal(parsedAfterRequeue.failed, 0)
      assert.equal(parsedAfterRequeue.currentState, 'succeeded')
      assert.equal(parsedAfterRequeue.results[0]?.providerId, 'fake-parser')
      assert.equal(
        parsedAfterRequeue.results[0]?.manifestPath,
        'derived/inbox/parse-result.json',
      )
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'inbox journal and experiment-note promotions are idempotent',
  async () => {
    const fixture = await makeVaultFixture('murph-inbox-journal-promotion')
    const services = createIntegratedInboxServices({
      enableJournalPromotion: true,
      getHomeDirectory: () => fixture.homeRoot,
      getPlatform: () => 'darwin',
      loadCoreModule: loadBuiltCoreRuntime as never,
      loadInboxModule: loadBuiltInboxRuntime as never,
      loadImessageDriver: async () =>
        createFakeImessageDriver({
          photoPath: fixture.photoPath,
          text: 'Breakfast note from inbox',
        }),
    })

    try {
      const coreRuntime = await loadBuiltCoreRuntime()
      const experiment = await coreRuntime.createExperiment({
        vaultRoot: fixture.vaultRoot,
        slug: 'Focus Sprint',
        title: 'Focus Sprint',
        startedOn: '2026-03-13',
      })

      await initializeImessageSource({
        services,
        vaultRoot: fixture.vaultRoot,
      })
      await services.backfill({
        vault: fixture.vaultRoot,
        requestId: null,
        sourceId: 'imessage:self',
      })
      const capture = await captureSingleCapture({
        services,
        vaultRoot: fixture.vaultRoot,
      })

      const firstPromotion = requireData(
        await runInProcessInboxCli<{
          target: string
          lookupId: string
          relatedId: string
          journalPath: string
          created: boolean
          appended: boolean
          linked: boolean
        }>(
          ['inbox', 'promote', 'journal', capture.captureId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(firstPromotion.target, 'journal')
      assert.equal(firstPromotion.lookupId, 'journal:2026-03-13')
      assert.equal(firstPromotion.relatedId, capture.eventId)
      assert.equal(firstPromotion.journalPath, 'journal/2026/2026-03-13.md')
      assert.equal(firstPromotion.created, true)
      assert.equal(firstPromotion.appended, true)
      assert.equal(firstPromotion.linked, true)

      const journalPath = path.join(fixture.vaultRoot, firstPromotion.journalPath)
      const firstJournal = await readFile(journalPath, 'utf8')
      assert.match(firstJournal, /eventIds:\n  - evt_/)
      assert.match(firstJournal, /## Inbox Captures/)
      assert.match(firstJournal, /<!-- inbox-capture:cap_/)
      assert.match(firstJournal, /Breakfast note from inbox/)

      const secondPromotion = requireData(
        await runInProcessInboxCli<{
          created: boolean
          appended: boolean
          linked: boolean
        }>(
          ['inbox', 'promote', 'journal', capture.captureId, '--vault', fixture.vaultRoot],
          services,
        ),
      )
      assert.equal(secondPromotion.created, false)
      assert.equal(secondPromotion.appended, false)
      assert.equal(secondPromotion.linked, false)

      const secondJournal = await readFile(journalPath, 'utf8')
      assert.equal(
        secondJournal.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1,
        1,
      )

      const firstExperimentNote = requireData(
        await runInProcessInboxCli<{
          target: string
          lookupId: string
          relatedId: string
          experimentPath: string
          experimentSlug: string
          appended: boolean
        }>(
          [
            'inbox',
            'promote',
            'experiment-note',
            capture.captureId,
            '--vault',
            fixture.vaultRoot,
          ],
          services,
        ),
      )
      assert.equal(firstExperimentNote.target, 'experiment-note')
      assert.equal(firstExperimentNote.lookupId, experiment.experiment.id)
      assert.equal(firstExperimentNote.relatedId, capture.eventId)
      assert.equal(
        firstExperimentNote.experimentPath,
        experiment.experiment.relativePath,
      )
      assert.equal(firstExperimentNote.experimentSlug, 'focus-sprint')
      assert.equal(firstExperimentNote.appended, true)

      const experimentMarkdown = await readFile(
        path.join(fixture.vaultRoot, experiment.experiment.relativePath),
        'utf8',
      )
      assert.match(experimentMarkdown, /## Inbox Experiment Notes/u)
      assert.match(experimentMarkdown, /<!-- inbox-experiment-notes:start -->/u)
      assert.match(experimentMarkdown, /<!-- inbox-capture:cap_/u)
      assert.match(experimentMarkdown, /Breakfast note from inbox/u)

      const secondExperimentNote = requireData(
        await runInProcessInboxCli<{
          appended: boolean
          lookupId: string
        }>(
          [
            'inbox',
            'promote',
            'experiment-note',
            capture.captureId,
            '--vault',
            fixture.vaultRoot,
          ],
          services,
        ),
      )
      assert.equal(secondExperimentNote.lookupId, experiment.experiment.id)
      assert.equal(secondExperimentNote.appended, false)

      const secondExperimentMarkdown = await readFile(
        path.join(fixture.vaultRoot, experiment.experiment.relativePath),
        'utf8',
      )
      assert.equal(
        secondExperimentMarkdown.split(`<!-- inbox-capture:${capture.captureId} -->`).length - 1,
        1,
      )
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
      await rm(fixture.homeRoot, { recursive: true, force: true })
    }
  },
)
