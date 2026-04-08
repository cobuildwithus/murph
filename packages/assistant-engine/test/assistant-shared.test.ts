import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AssistantStatePermissionAudit } from '@murphai/runtime-state/node'
import { afterEach, describe, expect, it, vi } from 'vitest'

type SharedModule = typeof import('../src/assistant/shared.ts')
type RuntimeStateNodeModule = typeof import('@murphai/runtime-state/node')

const tempRoots: string[] = []

afterEach(async () => {
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('@murphai/runtime-state/node')
  vi.resetModules()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('assistant shared helpers', () => {
  it('normalizes environment strings, OpenAI base URLs, and provider option keys', async () => {
    const {
      isAssistantOpenAIBaseUrl,
      normalizeAssistantProviderOptionKey,
      readAssistantEnvString,
    } = await loadSharedModule()

    expect(
      readAssistantEnvString(
        {
          OPENAI_API_KEY: '  secret-token  ',
        },
        ' OPENAI_API_KEY ',
      ),
    ).toBe('secret-token')
    expect(readAssistantEnvString({ OPENAI_API_KEY: 'secret-token' }, '   ')).toBeNull()
    expect(readAssistantEnvString({}, 'MISSING_KEY')).toBeNull()

    expect(isAssistantOpenAIBaseUrl(' https://api.openai.com/v1 ')).toBe(true)
    expect(isAssistantOpenAIBaseUrl('https://API.OPENAI.COM/v1/chat/completions')).toBe(true)
    expect(isAssistantOpenAIBaseUrl('http://api.openai.com/v1')).toBe(false)
    expect(isAssistantOpenAIBaseUrl('https://example.com/v1')).toBe(false)
    expect(isAssistantOpenAIBaseUrl('not-a-url')).toBe(false)

    expect(normalizeAssistantProviderOptionKey(' OpenAI-compatible endpoint ')).toBe(
      'openAICompatibleEndpoint',
    )
    expect(normalizeAssistantProviderOptionKey('---')).toBe('murphAssistant')
    expect(normalizeAssistantProviderOptionKey(null)).toBe('murphAssistant')
  })

  it('rejects required blank text, resolves timestamps, and detects missing or json syntax errors', async () => {
    const {
      isJsonSyntaxError,
      isMissingFileError,
      normalizeRequiredText,
      resolveTimestamp,
    } = await loadSharedModule()

    expect(normalizeRequiredText('  ready  ', 'assistant prompt')).toBe('ready')
    expect(() => normalizeRequiredText('   ', 'assistant prompt')).toThrowError(
      expect.objectContaining({
        code: 'invalid_payload',
        message: 'assistant prompt must be a non-empty string.',
        name: 'VaultCliError',
      }),
    )

    expect(resolveTimestamp(new Date('2026-04-08T00:00:00.000Z'))).toBe(
      '2026-04-08T00:00:00.000Z',
    )
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T04:05:06.789Z'))
    expect(resolveTimestamp()).toBe('2026-04-08T04:05:06.789Z')

    expect(isMissingFileError(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(true)
    expect(isMissingFileError(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false)
    expect(isMissingFileError(null)).toBe(false)

    expect(isJsonSyntaxError(new SyntaxError('bad json'))).toBe(true)
    expect(isJsonSyntaxError(new TypeError('bad type'))).toBe(false)
  })

  it('reads json files and recovers defaults for missing or malformed content', async () => {
    const { readAssistantJsonFile } = await loadSharedModule()
    const rootPath = await createTempDirectory('assistant-shared-json-')
    const validPath = path.join(rootPath, 'valid.json')
    const invalidPath = path.join(rootPath, 'invalid.json')
    const missingPath = path.join(rootPath, 'missing.json')

    await writeFile(validPath, JSON.stringify({ enabled: true }), 'utf8')
    await writeFile(invalidPath, '{"enabled":', 'utf8')

    await expect(
      readAssistantJsonFile({
        filePath: validPath,
        parse: parseEnabledRecord,
      }),
    ).resolves.toEqual({
      present: true,
      recoveredFromParseError: false,
      value: { enabled: true },
    })

    await expect(
      readAssistantJsonFile({
        createDefault: () => ({ enabled: false }),
        filePath: missingPath,
        parse: parseEnabledRecord,
      }),
    ).resolves.toEqual({
      present: false,
      recoveredFromParseError: false,
      value: { enabled: false },
    })

    await expect(
      readAssistantJsonFile({
        createDefault: () => ({ enabled: false }),
        filePath: invalidPath,
        parse: parseEnabledRecord,
      }),
    ).resolves.toEqual({
      present: true,
      recoveredFromParseError: true,
      value: { enabled: false },
    })
  })

  it('rethrows missing-file and schema parse failures when no default recovery applies', async () => {
    const { readAssistantJsonFile } = await loadSharedModule()
    const rootPath = await createTempDirectory('assistant-shared-json-errors-')
    const validPath = path.join(rootPath, 'valid.json')
    const missingPath = path.join(rootPath, 'missing.json')

    await writeFile(validPath, JSON.stringify({ enabled: 'yes' }), 'utf8')

    await expect(
      readAssistantJsonFile({
        filePath: missingPath,
        parse: parseEnabledRecord,
      }),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })

    await expect(
      readAssistantJsonFile({
        createDefault: () => ({ enabled: false }),
        filePath: validPath,
        parse: parseEnabledRecord,
      }),
    ).rejects.toThrow('enabled must be a boolean')
  })

  it('salvages an incomplete trailing jsonl line and counts malformed lines', async () => {
    const { parseAssistantJsonLinesWithTailSalvage } = await loadSharedModule()

    expect(
      parseAssistantJsonLinesWithTailSalvage(
        `${JSON.stringify({ id: 1 })}\nnot-json\n${JSON.stringify({ id: 2 })}\n{"id":3`,
        parseIdRecord,
      ),
    ).toEqual({
      malformedLineCount: 1,
      salvagedTailLineCount: 1,
      values: [1, 2],
    })

    expect(
      parseAssistantJsonLinesWithTailSalvage(
        `${JSON.stringify({ id: 1 })}\n{"id":2\n`,
        parseIdRecord,
      ),
    ).toEqual({
      malformedLineCount: 1,
      salvagedTailLineCount: 0,
      values: [1],
    })
  })

  it('emits best-effort warning messages with error names and optional codes', async () => {
    const { warnAssistantBestEffortFailure } = await loadSharedModule()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const permissionError: Error & { code: string } = Object.assign(
      new TypeError('denied'),
      {
        code: 'EACCES',
      },
    )

    warnAssistantBestEffortFailure({
      error: permissionError,
      operation: 'cleanup',
    })
    warnAssistantBestEffortFailure({
      error: 'plain failure',
      operation: 'retry scheduling',
    })

    expect(warnSpy.mock.calls).toEqual([
      ['Assistant best-effort cleanup failed (TypeError/EACCES).'],
      ['Assistant best-effort retry scheduling failed (Error).'],
    ])
  })

  it('delegates runtime-state helper wrappers to the package-local node helpers', async () => {
    const appendTextFileWithMode = vi
      .fn<(filePath: string, value: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const ensureAssistantStateDirectory = vi
      .fn<(directoryPath: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const writeJsonFileAtomic = vi
      .fn<(filePath: string, value: unknown) => Promise<void>>()
      .mockResolvedValue(undefined)
    const writeTextFileAtomic = vi
      .fn<(filePath: string, value: string) => Promise<void>>()
      .mockResolvedValue(undefined)
    const auditResult: AssistantStatePermissionAudit = {
      incorrectEntries: 1,
      issues: [],
      repairedEntries: 1,
      scannedDirectories: 2,
      scannedFiles: 3,
      scannedOtherEntries: 0,
    }
    const auditAssistantStatePermissions = vi
      .fn<(input: { repair?: boolean; rootPath: string }) => Promise<AssistantStatePermissionAudit>>()
      .mockResolvedValue(auditResult)
    const shared = await loadSharedModule({
      runtimeStateOverrides: {
        appendTextFileWithMode,
        auditAssistantStatePermissions,
        ensureAssistantStateDirectory,
        writeJsonFileAtomic,
        writeTextFileAtomic,
      },
    })

    await shared.ensureAssistantStateDirectory('/tmp/assistant-state')
    await expect(
      shared.auditAssistantStatePermissions({
        repair: true,
        rootPath: '/tmp/assistant-state',
      }),
    ).resolves.toEqual(auditResult)
    await shared.appendTextFile('/tmp/assistant-state/events.jsonl', 'line\n')
    await shared.writeJsonFileAtomic('/tmp/assistant-state/state.json', {
      enabled: true,
    })
    await shared.writeTextFileAtomic('/tmp/assistant-state/note.txt', 'hello')

    expect(ensureAssistantStateDirectory).toHaveBeenCalledWith('/tmp/assistant-state')
    expect(auditAssistantStatePermissions).toHaveBeenCalledWith({
      repair: true,
      rootPath: '/tmp/assistant-state',
    })
    expect(appendTextFileWithMode).toHaveBeenCalledWith(
      '/tmp/assistant-state/events.jsonl',
      'line\n',
    )
    expect(writeJsonFileAtomic).toHaveBeenCalledWith('/tmp/assistant-state/state.json', {
      enabled: true,
    })
    expect(writeTextFileAtomic).toHaveBeenCalledWith('/tmp/assistant-state/note.txt', 'hello')
  })
})

async function createTempDirectory(prefix: string): Promise<string> {
  const rootPath = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(rootPath)
  return rootPath
}

async function loadSharedModule(input?: {
  runtimeStateOverrides?: Partial<RuntimeStateNodeModule>
}): Promise<SharedModule> {
  vi.resetModules()
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('@murphai/runtime-state/node')

  if (input?.runtimeStateOverrides) {
    vi.doMock('@murphai/runtime-state/node', async () => {
      const actual = await vi.importActual<RuntimeStateNodeModule>(
        '@murphai/runtime-state/node',
      )
      return {
        ...actual,
        ...input.runtimeStateOverrides,
      }
    })
  }

  return await import('../src/assistant/shared.ts')
}

function parseEnabledRecord(value: unknown): { enabled: boolean } {
  if (!value || typeof value !== 'object' || !('enabled' in value)) {
    throw new TypeError('enabled must be a boolean')
  }
  const enabled = value.enabled
  if (typeof enabled !== 'boolean') {
    throw new TypeError('enabled must be a boolean')
  }
  return { enabled }
}

function parseIdRecord(value: unknown): number {
  if (!value || typeof value !== 'object' || !('id' in value)) {
    throw new TypeError('id must be a number')
  }
  const id = value.id
  if (typeof id !== 'number') {
    throw new TypeError('id must be a number')
  }
  return id
}
