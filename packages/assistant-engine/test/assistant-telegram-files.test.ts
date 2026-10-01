import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { getAssistantChannelAdapter } from '../src/assistant-channel-adapters.ts'
import { sendTelegramFileMessage } from '../src/assistant-channel-runtime.ts'
import { readVerifiedAssistantVaultFileBytes } from '../src/assistant/vault-file-send.ts'

const bytes = Buffer.from('%PDF-1.4\nSynthetic document transport fixture\n%%EOF\n')
const file = {
  approvalGeneration: 'b'.repeat(64),
  approvalId: `haa_${'a'.repeat(32)}`,
  contentType: 'application/pdf',
  filename: 'report.pdf',
  kind: 'vault_file' as const,
  ref: 'documents/report.pdf',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sizeBytes: bytes.length,
}
const env = { TELEGRAM_BOT_TOKEN: 'synthetic-token', TELEGRAM_API_BASE_URL: 'https://telegram.test' }
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('delivers a verified PDF through the Telegram adapter as exactly one document', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'telegram-file-'))
  roots.push(vaultRoot)
  await mkdir(path.join(vaultRoot, 'documents'))
  await writeFile(path.join(vaultRoot, file.ref), bytes)
  const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({ ok: true, result: { message_id: 7 } }))
  const sendTelegram = vi.fn()
  const result = await getAssistantChannelAdapter('telegram')!.send({
    actorId: null, identityId: null, explicitTarget: null,
    bindingDelivery: { kind: 'thread', target: '123' },
    media: [file],
    message: 'Attached.',
    replyToMessageId: '4',
    threadIsDirect: true,
  }, {
    sendTelegram,
    sendTelegramFile: request => sendTelegramFileMessage(request, {
      env,
      fetchImplementation,
      loadVaultFile: file => readVerifiedAssistantVaultFileBytes({ file, vaultRoot }),
    }),
  })
  expect(result).toMatchObject({ channel: 'telegram', providerMessageId: '7', target: '123' })
  expect(sendTelegram).not.toHaveBeenCalled()
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
  const [url, init] = fetchImplementation.mock.calls[0]!
  expect(url).toBe('https://telegram.test/botsynthetic-token/sendDocument')
  const form = init!.body as FormData
  expect(form.get('chat_id')).toBe('123')
  expect(form.get('reply_to_message_id')).toBe('4')
  expect(form.has('caption')).toBe(false)
  const document = form.get('document') as File
  expect(document.name).toBe('report.pdf')
  expect(document.type).toBe('application/pdf')
  expect(Buffer.from(await document.arrayBuffer())).toEqual(bytes)
  await writeFile(path.join(vaultRoot, file.ref), Buffer.alloc(bytes.length, 'x'))
  await expect(sendTelegramFileMessage({ file, target: '123' }, {
    env, fetchImplementation,
    loadVaultFile: file => readVerifiedAssistantVaultFileBytes({ file, vaultRoot }),
  })).rejects.toThrow()
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

it.each([
  { label: 'group', threadIsDirect: false, media: [file] },
  { label: 'unknown audience', threadIsDirect: null, media: [file] },
  { label: 'multiple files', threadIsDirect: true, media: [file, file] },
])('rejects $label before document dispatch', async ({ threadIsDirect, media }) => {
  const sendTelegramFile = vi.fn()
  await expect(getAssistantChannelAdapter('telegram')!.send({
    actorId: null, identityId: null, explicitTarget: null,
    bindingDelivery: { kind: 'thread', target: '123' }, message: '', media, threadIsDirect,
  }, { sendTelegramFile })).rejects.toMatchObject({ code: 'ASSISTANT_VAULT_FILE_MEDIA_INVALID' })
  expect(sendTelegramFile).not.toHaveBeenCalled()
})

it('does not retry an ambiguous document upload', async () => {
  const fetchImplementation = vi.fn<typeof fetch>(async () => { throw new Error('connection lost') })
  await expect(sendTelegramFileMessage({ file, target: '123' }, {
    env, fetchImplementation, loadVaultFile: async () => bytes,
  })).rejects.toMatchObject({ deliveryMayHaveSucceeded: true })
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

it('does not follow a migration away from the approved destination', async () => {
  const fetchImplementation = vi.fn<typeof fetch>(async () => Response.json({
    ok: false, error_code: 400, parameters: { migrate_to_chat_id: -456 },
  }, { status: 400 }))
  await expect(sendTelegramFileMessage({ file, target: '123' }, {
    env, fetchImplementation, loadVaultFile: async () => bytes,
  })).rejects.toThrow()
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

it('rejects a wrong authorized target before loading the file', async () => {
  const loadVaultFile = vi.fn(async () => bytes)
  const fetchImplementation = vi.fn<typeof fetch>()
  await expect(sendTelegramFileMessage({ file, target: '123' }, {
    env, authorityBoundTarget: '456', fetchImplementation, loadVaultFile,
  })).rejects.toThrow()
  expect(loadVaultFile).not.toHaveBeenCalled()
  expect(fetchImplementation).not.toHaveBeenCalled()
})

it('requires a trusted loader and rejects mismatched file size before upload', async () => {
  const fetchImplementation = vi.fn<typeof fetch>()
  await expect(sendTelegramFileMessage({ file, target: '123' }, { env, fetchImplementation }))
    .rejects.toMatchObject({ code: 'ASSISTANT_VAULT_FILE_LOADER_REQUIRED' })
  await expect(sendTelegramFileMessage({ file, target: '123' }, {
    env, fetchImplementation, loadVaultFile: async () => bytes.subarray(1),
  })).rejects.toMatchObject({ code: 'ASSISTANT_VAULT_FILE_SIZE_UNSUPPORTED' })
  expect(fetchImplementation).not.toHaveBeenCalled()
})


it('retries a definitive rate-limit rejection with the same document and destination', async () => {
  const fetchImplementation = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({
      ok: false, error_code: 429, parameters: { retry_after: 0 },
    }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 8 } }))
  const loadVaultFile = vi.fn(async () => bytes)
  await expect(sendTelegramFileMessage({ file, target: '123' }, {
    env, fetchImplementation, loadVaultFile,
  })).resolves.toMatchObject({ providerMessageId: '8', target: '123' })
  expect(loadVaultFile).toHaveBeenCalledTimes(1)
  expect(fetchImplementation).toHaveBeenCalledTimes(2)
  for (const [, init] of fetchImplementation.mock.calls) {
    const form = init!.body as FormData
    expect(form.get('chat_id')).toBe('123')
    expect(Buffer.from(await (form.get('document') as File).arrayBuffer())).toEqual(bytes)
  }
})

it('preserves a pre-provider authority rejection without marking delivery ambiguous', async () => {
  const rejection = Object.assign(new Error('Delivery authority expired'), {
    deliveryMayHaveSucceeded: false,
  })
  const fetchImplementation = vi.fn<typeof fetch>(async () => { throw rejection })
  await expect(sendTelegramFileMessage({ file, target: '123' }, {
    env, fetchImplementation, loadVaultFile: async () => bytes,
  })).rejects.toBe(rejection)
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
  expect(rejection.deliveryMayHaveSucceeded).toBe(false)
})
