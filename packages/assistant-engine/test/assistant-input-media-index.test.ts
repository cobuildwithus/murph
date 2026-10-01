import { access, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  listAssistantConversationMediaInputEvents,
  readAssistantInputEvent,
  resolveAssistantInputEventPath,
  resolveAssistantInputEventsDirectory,
  retireAssistantInputEventContent,
  updateAssistantInputAttachmentEvidence,
  upsertAssistantInputEvent,
  type AssistantInputConversationRef,
  type AssistantInputEventRecord,
} from '../src/assistant/input-store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile), readdir: vi.fn(actual.readdir), rename: vi.fn(actual.rename) }
})

const tempRoots: string[] = []
const RECEIVED_AT = '2026-06-01T00:00:00.000Z'
const START = Date.parse(RECEIVED_AT)
const DAY = 86_400_000
const DIRECT: AssistantInputConversationRef = {
  source: 'telegram', accountId: 'synthetic-account', actorId: 'synthetic-participant',
  actorIsSelf: false, threadId: 'synthetic-thread', threadIsDirect: true,
}

type Paths = ReturnType<typeof resolveAssistantStatePaths>

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('assistant conversation media input index', () => {
  it('builds missing conversation indexes from canonical inputs in one scan', async () => {
    const paths = await createPaths()
    const group = { ...DIRECT, threadId: 'synthetic-group', threadIsDirect: false }
    const image = await createMedia(paths, 'cold-image')
    const video = await createMedia(paths, 'cold-video', { conversation: group, kind: 'video' })
    await createInput(paths, 'cold-text')
    await expect(access(indexFile(paths))).rejects.toMatchObject({ code: 'ENOENT' })
    vi.mocked(readdir).mockClear()

    const listed = await listMedia(paths, [DIRECT, group, DIRECT])

    expect(ids(listed.events)).toEqual(ids([image, video]))
    expect(canonicalDirectoryReads(paths)).toHaveLength(1)
    await expect(access(indexFile(paths))).resolves.toBeUndefined()
  })

  it('reuses an empty index and adds newly available media without scanning unrelated text', async () => {
    const paths = await createPaths()
    const first = await createInput(paths, 'new-first')
    const unrelated = await createInput(paths, 'new-unrelated')
    expect((await listMedia(paths)).events).toEqual([])
    await attachMedia(paths, first)
    const second = await createMedia(paths, 'new-second', { kind: 'video' })
    vi.mocked(readFile).mockClear()
    vi.mocked(readdir).mockClear()

    const listed = await listMedia(paths)

    expect(ids(listed.events)).toEqual(ids([first, second]))
    expect(canonicalDirectoryReads(paths)).toEqual([])
    expect(vi.mocked(readFile).mock.calls.some(([file]) =>
      String(file) === resolveAssistantInputEventPath({ inputId: unrelated.inputId, paths }),
    )).toBe(false)
  })

  it('does not publish a partial index when attachment updates precede the first lookup', async () => {
    const paths = await createPaths()
    const legacy = await createMedia(paths, 'legacy-media')
    const newer = await createMedia(paths, 'newer-media')
    await attachMedia(paths, newer)
    await expect(access(indexFile(paths))).rejects.toMatchObject({ code: 'ENOENT' })

    expect(ids((await listMedia(paths)).events)).toEqual(ids([legacy, newer]))
  })

  it('rebuilds a missing or corrupt index from all retained canonical media', async () => {
    const paths = await createPaths()
    const first = await createMedia(paths, 'rebuild-first')
    await listMedia(paths)
    const indexPath = indexFile(paths)
    await writeFile(indexPath, '{invalid-json')
    vi.mocked(readdir).mockClear()

    expect(ids((await listMedia(paths)).events)).toEqual([first.inputId])
    expect(canonicalDirectoryReads(paths)).toHaveLength(1)
    await rm(indexPath)
    const second = await createMedia(paths, 'rebuild-second')
    await expect(access(indexFile(paths))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(ids((await listMedia(paths)).events)).toEqual(ids([first, second]))
  })

  it('isolates direct conversations by source, account, actor, thread, session, and audience', async () => {
    const paths = await createPaths()
    const current = { ...DIRECT, sessionId: 'synthetic-session' }
    const matching = await createMedia(paths, 'scope-matching', { conversation: current })
    const otherScopes: AssistantInputConversationRef[] = [
      { ...current, source: 'linq' },
      { ...current, accountId: 'other-account' },
      { ...current, actorId: 'other-participant' },
      { ...current, threadId: 'other-thread' },
      { ...current, sessionId: 'other-session' },
      { ...current, sessionId: null },
      { ...current, threadIsDirect: false },
      { ...current, threadIsDirect: null },
      { ...current, actorIsSelf: true },
    ]
    for (const [ordinal, conversation] of otherScopes.entries()) {
      await createMedia(paths, `scope-other-${ordinal}`, { conversation })
    }

    expect(ids((await listMedia(paths, [current, current])).events)).toEqual([matching.inputId])
    expect(ids((await listMedia(paths, [current])).events)).toEqual([matching.inputId])
    for (const conversation of otherScopes) await listMedia(paths, [conversation])
    expect((await readdir(paths.stateDirectory)).filter((name) => name.startsWith('input-media')))
      .toEqual(['input-media.json'])
  })

  it('includes other group participants once while excluding self-authored and other-room media', async () => {
    const paths = await createPaths()
    const group = { ...DIRECT, threadIsDirect: false }
    const first = await createMedia(paths, 'group-first', { conversation: group })
    const secondParticipant = { ...group, actorId: 'other-participant' }
    const second = await createMedia(paths, 'group-second', { conversation: secondParticipant })
    await createMedia(paths, 'group-self', { conversation: { ...group, actorIsSelf: true } })
    await createMedia(paths, 'group-other', { conversation: { ...group, threadId: 'other-group' } })

    expect(ids((await listMedia(paths, [group, secondParticipant, group])).events))
      .toEqual(ids([first, second]))
    await expect(access(indexFile(paths))).resolves.toBeUndefined()
  })

  it('treats absent and null session IDs as the same scope and rejects incomplete conversations', async () => {
    const paths = await createPaths()
    const media = await createMedia(paths, 'null-session')
    expect(ids((await listMedia(paths, [{ ...DIRECT, sessionId: null }])).events))
      .toEqual([media.inputId])

    expect((await listMedia(paths, [null, { ...DIRECT, source: null },
      { ...DIRECT, threadId: null }, { ...DIRECT, threadIsDirect: null }])).events).toEqual([])
  })

  it.each([['image', 90], ['video', 30]] as const)(
    'retains %s authority after text retirement, then excludes it at the %s-day deadline',
    async (kind, lifetimeDays) => {
      const paths = await createPaths()
      const media = await createMedia(paths, `retirement-${kind}`, { kind })
      await listMedia(paths)
      await retireAssistantInputEventContent({
        inputId: media.inputId, now: new Date(START + 14 * DAY), vault: paths.absoluteVaultRoot,
      })
      const retained = await listMedia(paths, [DIRECT], START + lifetimeDays * DAY - 1)
      expect(ids(retained.events)).toEqual([media.inputId])
      expect(retained.events[0]?.content.text).toBeNull()
      expect(retained.events[0]?.attachmentEvidence.attachments[0]?.raw).not.toBeNull()

      expect((await listMedia(paths, [DIRECT], START + lifetimeDays * DAY)).events).toEqual([])
    },
  )

  it('keeps a multi-attachment event until its last retained media expires', async () => {
    const paths = await createPaths()
    const media = await createInput(paths, 'mixed-lifetimes')
    await attachMedia(paths, media, ['video', 'image'])
    expect(ids((await listMedia(paths, [DIRECT], START + 30 * DAY)).events)).toEqual([media.inputId])
    expect((await listMedia(paths, [DIRECT], START + 90 * DAY)).events).toEqual([])
  })

  it('revalidates canonical evidence after an indexed attachment becomes unavailable', async () => {
    const paths = await createPaths()
    const media = await createMedia(paths, 'removed-evidence')
    await listMedia(paths)
    await updateAssistantInputAttachmentEvidence({
      inputId: media.inputId, vault: paths.absoluteVaultRoot, now: new Date(START + DAY),
      attachmentEvidence: { attachments: [], optionalInboxCaptureId: null,
        reasonCode: 'attachment.evidence_unavailable', source: 'manual', status: 'failed', updatedAt: null },
    })

    expect((await listMedia(paths)).events).toEqual([])
    expect((await readAssistantInputEvent({ inputId: media.inputId, paths }))?.attachmentEvidence.status)
      .toBe('failed')
  })

  it.each(['malformed', 'missing'] as const)('skips a %s canonical candidate while preserving healthy media', async (failure) => {
    const paths = await createPaths()
    const broken = await createMedia(paths, 'broken-candidate')
    const healthy = await createMedia(paths, 'healthy-candidate')
    await listMedia(paths)
    const eventPath = resolveAssistantInputEventPath({ inputId: broken.inputId, paths })
    if (failure === 'malformed') await writeFile(eventPath, '{invalid-json')
    else await rm(eventPath)
    vi.mocked(readdir).mockClear()

    expect(ids((await listMedia(paths)).events)).toEqual([healthy.inputId])
    expect(canonicalDirectoryReads(paths)).toEqual([])
  })

  it('does not trust an indexed candidate from another conversation', async () => {
    const paths = await createPaths()
    const allowed = await createMedia(paths, 'allowed-candidate')
    const other = await createMedia(paths, 'other-conversation-candidate', {
      conversation: { ...DIRECT, threadId: 'other-thread' },
    })
    await listMedia(paths)
    const envelope = JSON.parse(await readFile(indexFile(paths), 'utf8')) as {
      value: Record<string, Record<string, number>>
    }
    const candidates = Object.values(envelope.value).find((entries) => allowed.inputId in entries)
    expect(candidates).toBeDefined()
    candidates![other.inputId] = START + 90 * DAY
    await writeFile(indexFile(paths), JSON.stringify(envelope))

    expect(ids((await listMedia(paths)).events)).toEqual([allowed.inputId])
  })

  it('preserves canonical image lifetime when a shorter-lived replacement fails to publish', async () => {
    const paths = await createPaths()
    const image = await createMedia(paths, 'failed-replacement')
    await listMedia(paths)
    const eventPath = resolveAssistantInputEventPath({ inputId: image.inputId, paths })
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to) === eventPath) {
        throw Object.assign(new Error('Synthetic canonical publish failure'), { code: 'EIO' })
      }
      return actual.rename(from, to)
    })
    try {
      await expect(attachMedia(paths, image, ['video'])).rejects.toThrow('Synthetic canonical publish failure')
    } finally {
      vi.mocked(rename).mockImplementation(actual.rename)
    }

    const retained = await listMedia(paths, [DIRECT], START + 60 * DAY)
    expect(ids(retained.events)).toEqual([image.inputId])
    expect(retained.events[0]?.attachmentEvidence.attachments[0]?.kind).toBe('image')
  })

  it('returns every retained media event beyond the general input-list default limit', async () => {
    const paths = await createPaths()
    const events: AssistantInputEventRecord[] = []
    for (let index = 0; index < 101; index += 1) {
      events.push(await createMedia(paths, `complete-media-${index}`))
    }

    expect(ids((await listMedia(paths)).events)).toEqual(ids(events))
    expect(ids((await listMedia(paths)).events)).toEqual(ids(events))
  })

  it('keeps the index inside the canonical state root when a caller redirects stateDirectory', async () => {
    const paths = await createPaths()
    const media = await createMedia(paths, 'redirected-state-directory')
    const outsideDirectory = path.join(path.dirname(paths.absoluteVaultRoot), 'synthetic-outside-state')
    await mkdir(outsideDirectory)

    const listed = await listAssistantConversationMediaInputEvents({
      conversations: [DIRECT], now: new Date(START + DAY),
      paths: { ...paths, stateDirectory: outsideDirectory },
    })

    expect(ids(listed.events)).toEqual([media.inputId])
    await expect(access(path.join(paths.assistantStateRoot, 'state', 'input-media.json')))
      .resolves.toBeUndefined()
    await expect(access(path.join(outsideDirectory, 'input-media.json')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed for a symlinked index without reading or overwriting its target', async () => {
    const paths = await createPaths()
    await createMedia(paths, 'symlink-media')
    await listMedia(paths)
    const indexPath = indexFile(paths)
    const target = path.join(paths.absoluteVaultRoot, 'synthetic-index-target.json')
    const targetContents = '{"synthetic":"unchanged"}'
    await writeFile(target, targetContents)
    await rm(indexPath)
    await symlink(target, indexPath)
    vi.mocked(readFile).mockClear()

    await expect(listMedia(paths)).rejects.toThrow(/symlink|symbolic/iu)
    expect(vi.mocked(readFile).mock.calls.some(([file]) =>
      String(file) === target || String(file) === indexPath,
    )).toBe(false)
    expect(await readFile(target, 'utf8')).toBe(targetContents)
  })
})

async function createPaths(): Promise<Paths> {
  const context = await createTempVaultContext('assistant-input-media-index-')
  tempRoots.push(context.parentRoot)
  return resolveAssistantStatePaths(context.vaultRoot)
}

function createInput(
  paths: Paths, captureId: string, conversation: AssistantInputConversationRef | null = DIRECT,
): Promise<AssistantInputEventRecord> {
  return upsertAssistantInputEvent({
    vault: paths.absoluteVaultRoot, now: new Date(START),
    event: { content: { text: 'Synthetic retained attachment message' }, conversation,
      occurredAt: RECEIVED_AT, receivedAt: RECEIVED_AT,
      sourceRef: { kind: 'inbox-capture', captureId, source: conversation?.source ?? 'telegram', version: null } },
  })
}

async function createMedia(paths: Paths, captureId: string, options: {
  conversation?: AssistantInputConversationRef | null
  kind?: 'image' | 'video'
} = {}): Promise<AssistantInputEventRecord> {
  const event = await createInput(paths, captureId, options.conversation)
  return attachMedia(paths, event, [options.kind ?? 'image'])
}

function attachMedia(paths: Paths, event: AssistantInputEventRecord, kinds: readonly ('image' | 'video')[] = ['image']) {
  return updateAssistantInputAttachmentEvidence({
    inputId: event.inputId, vault: paths.absoluteVaultRoot, now: new Date(START),
    attachmentEvidence: {
      attachments: kinds.map((kind, index) => ({
        byteSize: 128, derived: null, descriptorAttachmentId: `descriptor-${index}`,
        fileName: kind === 'image' ? 'synthetic.png' : 'synthetic.mp4', inlineFragments: [],
        kind, mime: kind === 'image' ? 'image/png' : 'video/mp4', ordinal: index + 1,
        parseState: 'succeeded' as const,
        raw: { kind: 'vault-relative-file' as const,
          path: `raw/inbox/synthetic-media/attachments/${index}.${kind === 'image' ? 'png' : 'mp4'}`,
          byteSize: 128, mediaType: kind === 'image' ? 'image/png' : 'video/mp4', sha256: 'a'.repeat(64) },
        sourceAttachmentId: `attachment-${index}`,
      })),
      optionalInboxCaptureId: null, reasonCode: null, source: 'manual', status: 'available', updatedAt: null,
    },
  })
}

function listMedia(paths: Paths, conversations: readonly (AssistantInputConversationRef | null)[] = [DIRECT], now = START + DAY) {
  return listAssistantConversationMediaInputEvents({ conversations, now: new Date(now), paths })
}

function ids(events: readonly AssistantInputEventRecord[]): string[] {
  return events.map((event) => event.inputId).sort()
}

function indexFile(paths: Paths): string {
  return path.join(paths.stateDirectory, 'input-media.json')
}

function canonicalDirectoryReads(paths: Paths) {
  return vi.mocked(readdir).mock.calls.filter(([directory]) =>
    String(directory) === resolveAssistantInputEventsDirectory(paths),
  )
}
