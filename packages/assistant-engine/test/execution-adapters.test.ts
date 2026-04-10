import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  executeAssistantCliCommand,
  readAssistantCliLlmsManifest,
  readAssistantTextFile,
  withAssistantPayloadFile,
} from '../src/assistant-cli-tools/execution-adapters.ts'

const createdVaultRoots: string[] = []
const createdPathRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    [
      ...createdVaultRoots.splice(0),
      ...createdPathRoots.splice(0),
    ].map((targetRoot) => rm(targetRoot, { force: true, recursive: true })),
  )
})

describe('withAssistantPayloadFile', () => {
  it('stages assistant payloads under vault .runtime tmp and removes them after success', async () => {
    const vaultRoot = await createVaultRoot()
    const payload = {
      stream: 'body_weight',
      samples: [],
    }
    let inputFile = ''

    const result = await withAssistantPayloadFile(
      vaultRoot,
      'vault.samples.add',
      payload,
      async (stagedInputFile) => {
        inputFile = stagedInputFile
        expectAssistantPayloadRuntimePath(vaultRoot, stagedInputFile, 'vault-samples-add')
        expect(await readFile(stagedInputFile, 'utf8')).toBe(`${JSON.stringify(payload, null, 2)}\n`)
        const stagedFileStat = await stat(stagedInputFile)
        const stagedDirectoryStat = await stat(path.dirname(stagedInputFile))

        expect(stagedFileStat.mode & 0o777).toBe(0o600)
        expect(stagedDirectoryStat.mode & 0o777).toBe(0o700)
        return 'ok'
      },
    )

    expect(result).toBe('ok')
    expect(inputFile).not.toBe('')
    await expectPathMissing(inputFile)
    await expectPathMissing(path.dirname(inputFile))
    await expectPathMissing(path.join(vaultRoot, 'derived', 'assistant', 'payloads'))
  })

  it('removes staged payloads after the caller throws', async () => {
    const vaultRoot = await createVaultRoot()
    const payload = {
      providerId: 'prov_example',
      title: 'Example Provider',
    }
    const sentinel = new Error('boom')
    let inputFile = ''

    await expect(
      withAssistantPayloadFile(
        vaultRoot,
        'vault.provider.upsert',
        payload,
        async (stagedInputFile) => {
          inputFile = stagedInputFile
          expectAssistantPayloadRuntimePath(vaultRoot, stagedInputFile, 'vault-provider-upsert')
          throw sentinel
        },
      ),
    ).rejects.toBe(sentinel)

    expect(inputFile).not.toBe('')
    await expectPathMissing(inputFile)
    await expectPathMissing(path.dirname(inputFile))
  })
})

describe('readAssistantTextFile', () => {
  it('returns vault-relative paths and truncation notices when the file exceeds the requested limit', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultFile(
      vaultRoot,
      'journal/notes.txt',
      'Hydration '.repeat(6),
    )

    const result = await readAssistantTextFile(vaultRoot, 'journal/notes.txt', 20)

    expect(result).toEqual({
      path: 'journal/notes.txt',
      text: 'Hydration Hydration \n\n[truncated 40 characters]',
      totalChars: 60,
      truncated: true,
    })
  })

  it('rejects binary or invalid UTF-8 content as non-text input', async () => {
    const vaultRoot = await createVaultRoot()
    await writeVaultBinaryFile(vaultRoot, 'journal/binary.dat', Buffer.from([0x00, 0xff, 0x41]))

    await expect(
      readAssistantTextFile(vaultRoot, 'journal/binary.dat'),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TOOL_FILE_NOT_TEXT',
      message: 'Assistant file path "journal/binary.dat" must reference a UTF-8 text file inside the vault.',
    })
  })
})

describe('readAssistantCliLlmsManifest', () => {
  it('launches vault-cli from PATH and parses the returned manifest', async () => {
    const vaultRoot = await createVaultRoot()
    const homeRoot = await createPathRoot()
    await writeExecutable(
      path.join(homeRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"commands":[{"name":"search","description":"Search help"}]}\\n\'',
      ].join('\n'),
    )

    await expect(
      readAssistantCliLlmsManifest({
        cliEnv: {
          HOME: homeRoot,
          PATH: '/usr/bin:/bin',
        },
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      commands: [
        {
          description: 'Search help',
          name: 'search',
        },
      ],
    })
  })

  it('disables incur config autodiscovery for hosted manifest reads', async () => {
    const vaultRoot = await createVaultRoot()
    const homeRoot = await createPathRoot()
    await writeExecutable(
      path.join(homeRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"commands":[{"name":"argv","description":"%s"}]}\\n\' "$*"',
      ].join('\n'),
    )

    await expect(
      readAssistantCliLlmsManifest({
        cliEnv: {
          HOME: homeRoot,
          PATH: '/usr/bin:/bin',
        },
        executionContext: {
          hosted: {
            memberId: 'member_123',
            userEnvKeys: [],
          },
        },
        vault: vaultRoot,
      }),
    ).resolves.toEqual({
      commands: [
        {
          description: '--no-config --llms --format json',
          name: 'argv',
        },
      ],
    })
  })

  it('fails with command output context when vault-cli returns an invalid llms manifest shape', async () => {
    const vaultRoot = await createVaultRoot()
    const homeRoot = await createPathRoot()
    await writeExecutable(
      path.join(homeRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"invalid":true}\\n\'',
      ].join('\n'),
    )

    let thrown: unknown
    try {
      await readAssistantCliLlmsManifest({
        cliEnv: {
          HOME: homeRoot,
          PATH: '/usr/bin:/bin',
        },
        detail: 'full',
        vault: vaultRoot,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(VaultCliError)
    expect(thrown).toMatchObject({
      code: 'ASSISTANT_CLI_COMMAND_FAILED',
      context: {
        argv: ['vault-cli', '--llms-full', '--format', 'json'],
        stdout: '{"invalid":true}',
      },
      message: 'vault-cli --llms-full --format json returned an unexpected manifest shape.',
    })
  })
})

describe('executeAssistantCliCommand', () => {
  it('adds --no-config for hosted vault-cli invocations only', async () => {
    const vaultRoot = await createVaultRoot()
    const homeRoot = await createPathRoot()
    await writeExecutable(
      path.join(homeRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*"',
      ].join('\n'),
    )

    await expect(
      executeAssistantCliCommand({
        args: ['audit', 'list'],
        input: {
          cliEnv: {
            HOME: homeRoot,
            PATH: '/usr/bin:/bin',
          },
          executionContext: {
            hosted: {
              memberId: 'member_123',
              userEnvKeys: [],
            },
          },
          vault: vaultRoot,
        },
      }),
    ).resolves.toMatchObject({
      argv: ['vault-cli', '--no-config', 'audit', 'list', '--format', 'json', '--vault', '<REDACTED_PATH>'],
      stdout: `--no-config audit list --format json --vault ${vaultRoot}`,
    })

    await expect(
      executeAssistantCliCommand({
        args: ['audit', 'list'],
        input: {
          cliEnv: {
            HOME: homeRoot,
            PATH: '/usr/bin:/bin',
          },
          vault: vaultRoot,
        },
      }),
    ).resolves.toMatchObject({
      argv: ['vault-cli', 'audit', 'list', '--format', 'json', '--vault', '<REDACTED_PATH>'],
      stdout: `audit list --format json --vault ${vaultRoot}`,
    })
  })

  it('resolves vault-cli from the prepared child PATH instead of the ambient PATH', async () => {
    const vaultRoot = await createVaultRoot()
    const homeRoot = await createPathRoot()
    const ambientPathRoot = await createPathRoot()
    const childPathRoot = await createPathRoot()
    const previousPath = process.env.PATH
    const allowedPaths = new Set([
      path.join(ambientPathRoot, 'vault-cli'),
      path.join(childPathRoot, 'vault-cli'),
    ])

    await writeExecutable(
      path.join(ambientPathRoot, 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"launcher":"ambient"}\\n\'',
      ].join('\n'),
    )
    await writeExecutable(
      path.join(childPathRoot, 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"launcher":"child"}\\n\'',
      ].join('\n'),
    )

    process.env.PATH = ambientPathRoot

    try {
      vi.resetModules()
      vi.doMock('node:fs/promises', async () => {
        const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
        return {
          ...actual,
          access: vi.fn(async (candidatePath: Parameters<typeof actual.access>[0], mode?: Parameters<typeof actual.access>[1]) => {
            const resolvedPath = String(candidatePath)

            if (allowedPaths.has(resolvedPath)) {
              return await actual.access(candidatePath, mode)
            }

            throw Object.assign(new Error(`Missing ${resolvedPath}`), {
              code: 'ENOENT',
            })
          }),
        }
      })

      const executionAdaptersSpecifier = new URL(
        '../src/assistant-cli-tools/execution-adapters.ts?prepared-child-path',
        import.meta.url,
      ).href
      const mockedExecutionAdapters = await import(executionAdaptersSpecifier)

      await expect(
        mockedExecutionAdapters.executeAssistantCliCommand({
          args: ['audit', 'list'],
          input: {
            cliEnv: {
              HOME: homeRoot,
              PATH: childPathRoot,
            },
            vault: vaultRoot,
          },
        }),
      ).resolves.toMatchObject({
        json: {
          launcher: 'child',
        },
        stdout: '{"launcher":"child"}',
      })
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = previousPath
      }
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })

  it('filters hosted vault-cli subprocess env to the explicit allowlist', async () => {
    const vaultRoot = await createVaultRoot()
    const homeRoot = await createPathRoot()
    const previousNodeOptions = process.env.NODE_OPTIONS
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY
    const previousUnexpectedSecret = process.env.UNRELATED_SECRET
    process.env.NODE_OPTIONS = '--require /tmp/ambient-loader.js'
    process.env.OPENAI_API_KEY = 'ambient-openai-key'
    process.env.UNRELATED_SECRET = 'ambient-secret'
    await writeExecutable(
      path.join(homeRoot, '.local', 'bin', 'vault-cli'),
      [
        '#!/bin/sh',
        'printf \'{"apiEnv":"%s","ambientOpenAi":"%s","customApi":"%s","fetchEnabled":"%s","nodeOptions":"%s","turnId":"%s","unexpected":"%s"}\\n\' \\',
        '  "${HOSTED_ASSISTANT_API_KEY_ENV-}" "${OPENAI_API_KEY-}" "${OPENAI_ENTERPRISE_API_KEY-}" "${MURPH_WEB_FETCH_ENABLED-}" \\',
        '  "${NODE_OPTIONS-}" "${ASSISTANT_MEMORY_BOUND_TURN_ID-}" "${UNRELATED_SECRET-}"',
      ].join('\n'),
    )

    try {
      await expect(
        executeAssistantCliCommand({
          args: ['audit', 'list'],
          input: {
            cliEnv: {
              ASSISTANT_MEMORY_BOUND_TURN_ID: 'turn-123',
              HOME: homeRoot,
              HOSTED_ASSISTANT_API_KEY_ENV: 'OPENAI_ENTERPRISE_API_KEY',
              MURPH_WEB_FETCH_ENABLED: '1',
              NODE_OPTIONS: '--require /tmp/cli-loader.js',
              OPENAI_ENTERPRISE_API_KEY: 'cli-enterprise-key',
              PATH: '/usr/bin:/bin',
              UNRELATED_SECRET: 'cli-secret',
            },
            executionContext: {
              hosted: {
                memberId: 'member_123',
                userEnvKeys: [],
              },
            },
            vault: vaultRoot,
          },
        }),
      ).resolves.toMatchObject({
        json: {
          ambientOpenAi: 'ambient-openai-key',
          apiEnv: 'OPENAI_ENTERPRISE_API_KEY',
          customApi: 'cli-enterprise-key',
          fetchEnabled: '1',
          nodeOptions: '',
          turnId: 'turn-123',
          unexpected: '',
        },
      })
    } finally {
      restoreEnvVar('NODE_OPTIONS', previousNodeOptions)
      restoreEnvVar('OPENAI_API_KEY', previousOpenAiApiKey)
      restoreEnvVar('UNRELATED_SECRET', previousUnexpectedSecret)
    }
  })
})

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-payload-vault-'))
  createdVaultRoots.push(vaultRoot)
  return vaultRoot
}

async function createPathRoot(): Promise<string> {
  const pathRoot = await mkdtemp(path.join(tmpdir(), 'murph-assistant-path-'))
  createdPathRoots.push(pathRoot)
  return pathRoot
}

async function expectPathMissing(targetPath: string): Promise<void> {
  await expect(access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' })
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
}

async function writeVaultBinaryFile(
  vaultRoot: string,
  relativePath: string,
  content: Buffer,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

async function writeExecutable(targetPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
  await chmod(targetPath, 0o755)
}

function restoreEnvVar(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

function expectAssistantPayloadRuntimePath(
  vaultRoot: string,
  inputFile: string,
  expectedPrefix: string,
): void {
  const relativePath = path.relative(vaultRoot, inputFile)
  const segments = relativePath.split(path.sep)

  expect(segments.slice(0, 4)).toEqual(['.runtime', 'tmp', 'assistant', 'payloads'])
  expect(segments[4]).toMatch(new RegExp(`^${expectedPrefix}-`))
  expect(segments[5]).toBe('payload.json')
}
