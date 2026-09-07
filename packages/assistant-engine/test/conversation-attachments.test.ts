import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  upsertAssistantInputEvent, updateAssistantInputAttachmentEvidence,
  readAssistantInputEvent, retireAssistantInputEventContent,
  type AssistantInputAttachmentEvidenceItem,
} from '../src/assistant/input-store.js'
import { pruneAssistantRuntimeResidue } from '../src/assistant/runtime-residue.js'
import {
  readAnalyzeVideoConversationEvents, snapshotConversationAttachmentAuthorities,
} from '../src/assistant-codex/analyze-video-tool.js'
import { createAssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import { executeMurphDynamicToolRequest } from '../src/assistant-codex/dynamic-tools.js'
import { executeConversationAttachmentsTool } from '../src/assistant-codex/dynamic-tools/conversation-attachments.js'
import type { ConversationAttachmentAuthority } from '../src/assistant-codex/analyze-video-tool.js'
import { writeAssistantAutoReplySuppressionEvidence } from '../src/assistant/automation/evidence.js'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true }))) })
const receivedAt = '2026-06-01T00:00:00.000Z'
const start = Date.parse(receivedAt)
const conversation = { source: 'telegram', accountId: 'synthetic-account', actorId: 'participant-a', actorIsSelf: false,
  threadId: 'synthetic-thread', threadIsDirect: true }
const bytesByKind = {
  image: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAABAcU3iAAAADElEQVR42mNk+M8AAwUBAcF/lMsAAAAASUVORK5CYII=', 'base64'),
  video: Buffer.from([0,0,0,24,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d]),
}

it.each(['image', 'video'] as const)('keeps %s references after text retirement and residue cleanup, then rejects them at expiry', async (kind) => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(start + 20 * 86_400_000)
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-attachment-lifetime-')); roots.push(vault)
  const rawPath = `raw/inbox/cap_synthetic/attachments/01__media.${kind === 'image' ? 'png' : 'mp4'}`
  const bytes = bytesByKind[kind]
  const event = await upsertAssistantInputEvent({ vault, event: {
    content: { text: 'synthetic text to retire', transcriptText: 'synthetic transcript to retire' },
    conversation, occurredAt: receivedAt, receivedAt,
    sourceRef: { kind: 'inbox-capture', captureId: 'cap_synthetic', source: 'telegram', version: null },
  } })
  const attachment: AssistantInputAttachmentEvidenceItem = {
    byteSize: bytes.length, derived: null, descriptorAttachmentId: 'descriptor_1', fileName: kind === 'image' ? 'photo.png' : 'clip.mp4',
    inlineFragments: [{ kind: 'attachment_transcript', label: 'Transcript', text: 'synthetic inline text to retire', truncated: false }],
    kind, mime: kind === 'image' ? 'image/png' : 'video/mp4', ordinal: 1, parseState: 'succeeded',
    raw: { kind: 'vault-relative-file', path: rawPath, byteSize: bytes.length,
      mediaType: kind === 'image' ? 'image/png' : 'video/mp4', sha256: createHash('sha256').update(bytes).digest('hex') },
    sourceAttachmentId: 'source_1',
  }
  const evidence = { attachments: [attachment], optionalInboxCaptureId: 'cap_synthetic', reasonCode: null,
    source: 'hosted-inbox-projection' as const, status: 'available' as const, updatedAt: receivedAt }
  await updateAssistantInputAttachmentEvidence({ vault, inputId: event.inputId, attachmentEvidence: evidence })
  await writeAssistantAutoReplySuppressionEvidence({ vault, inputIds: [event.inputId], captureIds: ['cap_synthetic'],
    reason: 'already-handled', recordedAt: receivedAt })
  await retireAssistantInputEventContent({ vault, inputId: event.inputId, now: new Date(start + 14 * 86_400_000) })
  // A late projection replay cannot restore message-derived text.
  await updateAssistantInputAttachmentEvidence({ vault, inputId: event.inputId, attachmentEvidence: evidence,
    now: new Date(start + 20 * 86_400_000) })
  await pruneAssistantRuntimeResidue({ vault, pendingInputIds: [], now: new Date(Date.now()) })
  const retained = await readAssistantInputEvent({ vault, inputId: event.inputId })
  expect(retained?.content.text).toBeNull(); expect(retained?.content.transcriptText).toBeNull()
  expect(retained?.attachmentEvidence.attachments[0]?.inlineFragments).toEqual([])
  expect(retained?.attachmentEvidence.attachments[0]?.raw?.path).toBe(rawPath)
  const followup = await upsertAssistantInputEvent({ vault, event: {
    content: { text: 'Please inspect the earlier attachment.' }, conversation,
    occurredAt: new Date(Date.now()).toISOString(), receivedAt: new Date(Date.now()).toISOString(),
    sourceRef: { kind: 'inbox-capture', captureId: 'cap_followup', source: 'telegram', version: null },
  } })
  const authorities = snapshotConversationAttachmentAuthorities(await readAnalyzeVideoConversationEvents({ acceptedEvents: [followup], vaultRoot: vault }))
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ candidates: [{ content: { parts: [{ text: 'A blue object is visible.' }] }, finishReason: 'STOP' }] }))
  const materialize = vi.fn(async (refs: readonly string[]) => {
    expect(refs).toEqual([rawPath]); await mkdir(path.dirname(path.join(vault, rawPath)), { recursive: true })
    await writeFile(path.join(vault, rawPath), bytes)
    return { materializedArtifactPaths: new Set(refs), missingArtifactPaths: new Set<string>() }
  })
  const context = createAssistantHostedToolContext({ getConversationAttachmentAuthorities: () => authorities,
    getConversationScope: () => 'direct', getUserActionAcceptedInputIds: () => [followup.inputId],
    messageInput: { channel: 'telegram' } as never,
    session: { binding: { channel: 'telegram' }, sessionId: 'synthetic-session' } as never })
  const execute = (request: Parameters<typeof executeMurphDynamicToolRequest>[0]['request']) => executeMurphDynamicToolRequest({
    request, hostedToolContext: context, vaultRoot: vault, env: {}, fetchImpl, nextUsageOrdinal: () => 1,
    materializeWorkspaceArtifacts: materialize, analyzeVideoRuntime: { apiKey: 'synthetic-key', fetchImpl }, progressDelivery: null })
  const listed = await execute({ kind: 'conversation-attachments', args: { action: 'list' } })
  expect(listed.rpcResult.success).toBe(true)
  expect(listed.rpcResult.contentItems[0]?.text).toContain(event.inputId)
  expect(listed.rpcResult.contentItems[0]?.text).not.toContain('text to retire')
  expect(materialize).not.toHaveBeenCalled()
  const request = kind === 'image' ? { kind: 'conversation-attachments' as const,
    args: { action: 'open_image' as const, message_ref: event.inputId, attachment_ordinal: 1 } }
    : { kind: 'analyze-video' as const, args: { messageRef: event.inputId, question: 'What is visible?' } }
  const opened = await execute(request)
  expect(opened.rpcResult.success).toBe(true); expect(materialize).toHaveBeenCalledTimes(1)
  expect(await readFile(path.join(vault, rawPath))).toEqual(bytes)
  const lifetimeDays = kind === 'image' ? 90 : 30
  clock.mockReturnValue(start + lifetimeDays * 86_400_000)
  expect((await execute(request)).rpcResult.success).toBe(false)
  expect(materialize).toHaveBeenCalledTimes(1)
  expect((await execute({ kind: 'conversation-attachments', args: { action: 'list' } })).rpcResult.contentItems[0]?.text).toContain('resend')
  await pruneAssistantRuntimeResidue({ vault, pendingInputIds: [], now: new Date(Date.now() + 15 * 86_400_000) })
  expect(await readAssistantInputEvent({ vault, inputId: event.inputId })).toBeNull()
})


it('paginates metadata without loading bytes and rejects unselected images', async () => {
  const materialize = vi.fn()
  const authorities: ConversationAttachmentAuthority[] = Array.from({ length: 23 }, (_, i) => ({
    byteSize: bytesByKind.image.length,
    capturedAt: new Date(start + i * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    fileName: `photo-${i}.png`, kind: 'image',
    messageRef: `ain_${i.toString(16).padStart(32, '0')}`,
    mimeType: 'image/png', ordinal: 1,
    rawPath: `raw/inbox/synthetic/attachments/${i}.png`,
    sha256: createHash('sha256').update(bytesByKind.image).digest('hex'),
  }))
  const execute = (args: Parameters<typeof executeConversationAttachmentsTool>[0]['args']) =>
    executeConversationAttachmentsTool({ args, hostedToolContext: createAssistantHostedToolContext({
      getConversationAttachmentAuthorities: () => authorities,
      getConversationScope: () => 'direct',
      getUserActionAcceptedInputIds: () => [authorities[0]!.messageRef],
      messageInput: { channel: 'telegram' } as never,
      session: { binding: { channel: 'telegram' }, sessionId: 'synthetic-session' } as never,
    }), materializeWorkspaceArtifacts: materialize, vaultRoot: '/synthetic-vault' })
  const first = JSON.parse((await execute({ action: 'list' })).rpcResult.contentItems[0]!.text)
  const second = JSON.parse((await execute({ action: 'list', offset: first.next_offset })).rpcResult.contentItems[0]!.text)
  expect(first.attachments).toHaveLength(20)
  expect(second.attachments).toHaveLength(3)
  expect(second.next_offset).toBeNull()
  expect(new Set([...first.attachments, ...second.attachments].map((a) => a.message_ref)).size).toBe(23)
  expect((await execute({ action: 'open_image', message_ref: authorities[0]!.messageRef, attachment_ordinal: 2 })).rpcResult.success).toBe(false)
  expect((await execute({ action: 'open_image', message_ref: `ain_${'f'.repeat(32)}`, attachment_ordinal: 1 })).rpcResult.success).toBe(false)
  expect(materialize).not.toHaveBeenCalled()
})

it.each(['no-current-input', 'unverified-external-group', 'no-context'] as const)('denies attachment discovery for %s', async (boundary) => {
  const list = vi.fn(() => [])
  const context = createAssistantHostedToolContext({
    getConversationAttachmentAuthorities: list,
    getConversationScope: () => boundary === 'unverified-external-group' ? 'unverified-external' : 'direct',
    getUserActionAcceptedInputIds: () => boundary === 'no-current-input' ? [] : [`ain_${'a'.repeat(32)}`],
    messageInput: { channel: 'telegram' } as never,
    session: { binding: { channel: 'telegram' }, sessionId: 'synthetic-session' } as never,
  })
  const result = await executeMurphDynamicToolRequest({
    request: { kind: 'conversation-attachments', args: { action: 'list' } },
    hostedToolContext: boundary === 'no-context' ? null : context,
    vaultRoot: '/synthetic-vault', env: {}, fetchImpl: vi.fn(), nextUsageOrdinal: () => 1,
    progressDelivery: null,
  })
  expect(result.rpcResult.success).toBe(false)
  expect(list).not.toHaveBeenCalled()
})
