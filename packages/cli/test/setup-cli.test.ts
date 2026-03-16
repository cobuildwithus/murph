import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  createSetupCli,
  detectSetupProgramName,
  isSetupInvocation,
} from '../src/setup-cli.js'
import { createSetupServices } from '../src/setup-services.js'
import type { SetupResult } from '../src/setup-cli-contracts.js'
import { requireData, type CliEnvelope } from './cli-test-helpers.js'

async function writeExecutable(
  absolutePath: string,
  body = '#!/usr/bin/env bash\nexit 0\n',
): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, body, 'utf8')
  await chmod(absolutePath, 0o755)
}

function makeBootstrapResult(vault: string) {
  return {
    vault,
    init: {
      runtimeDirectory: '.runtime/inboxd',
      databasePath: '.runtime/inboxd.sqlite',
      configPath: '.runtime/inboxd/config.json',
      createdPaths: ['.runtime', '.runtime/inboxd'],
      rebuiltCaptures: 0,
    },
    setup: {
      configPath: '.runtime/parsers/toolchain.json',
      updatedAt: '2026-03-13T12:00:00.000Z',
      tools: {
        ffmpeg: {
          available: true,
          command: '/usr/local/bin/ffmpeg',
          reason: 'ffmpeg CLI available.',
          source: 'config' as const,
        },
        pdftotext: {
          available: true,
          command: '/usr/local/bin/pdftotext',
          reason: 'pdftotext CLI available.',
          source: 'config' as const,
        },
        whisper: {
          available: true,
          command: '/usr/local/bin/whisper-cli',
          modelPath: '/tmp/model.bin',
          reason: 'whisper.cpp CLI and model path configured.',
          source: 'config' as const,
        },
        paddleocr: {
          available: true,
          command: '/usr/local/bin/paddlex',
          reason: 'PaddleOCR CLI available.',
          source: 'config' as const,
        },
      },
    },
    doctor: {
      configPath: '.runtime/inboxd/config.json',
      databasePath: '.runtime/inboxd.sqlite',
      target: null,
      ok: true,
      checks: [],
      connectors: [],
      parserToolchain: null,
    },
  }
}

async function runSetupCli<TData>(
  args: string[],
  services: ReturnType<typeof createSetupServices> | { setupMacos(input: any): Promise<any> },
  commandName = 'healthybob',
): Promise<CliEnvelope<TData>> {
  const cli = createSetupCli({
    commandName,
    services: services as ReturnType<typeof createSetupServices>,
  })
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

test.sequential('setup CLI dry-run returns a macOS plan without mutating services', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-home-'))
  const vaultRoot = path.join(homeRoot, 'vault')
  let coreInitCalls = 0
  let bootstrapCalls = 0

  const services = createSetupServices({
    arch: () => 'x64',
    env: () => ({ PATH: '' }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap() {
        bootstrapCalls += 1
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    runCommand: async ({ file, args }) => {
      if (path.basename(file) === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        return {
          exitCode: 1,
          stderr: '',
          stdout: '',
        }
      }

      if (path.basename(file) === 'brew' && args[0] === '--prefix') {
        return {
          exitCode: 0,
          stderr: '',
          stdout: '',
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init() {
          coreInitCalls += 1
          return {
            created: true,
            directories: [],
            files: [],
            vault: vaultRoot,
          }
        },
      },
    } as any,
  })

  try {
    const result = await runSetupCli<SetupResult>(
      ['setup', '--dryRun', '--vault', vaultRoot],
      services,
    )
    const data = requireData(result)

    assert.equal(data.dryRun, true)
    assert.equal(data.vault, vaultRoot)
    assert.equal(coreInitCalls, 0)
    assert.equal(bootstrapCalls, 0)
    assert.equal(
      data.steps.some(
        (step) =>
          step.id === 'homebrew' &&
          (step.status === 'planned' || step.status === 'reused'),
      ),
      true,
    )
    assert.equal(
      data.steps.some((step) => step.id === 'paddlex-ocr' && step.status === 'skipped'),
      true,
    )
    assert.equal(
      data.steps.some((step) => step.id === 'inbox-bootstrap' && step.status === 'planned'),
      true,
    )
  } finally {
    await rm(homeRoot, { recursive: true, force: true })
  }
})

test.sequential('setup service provisions formulas, downloads the model, and bootstraps the vault', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-real-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'vault')
  const homebrewBin = path.join(tempRoot, 'brew', 'bin')
  const formulaPrefixes = {
    ffmpeg: path.join(tempRoot, 'Cellar', 'ffmpeg'),
    poppler: path.join(tempRoot, 'Cellar', 'poppler'),
    'whisper-cpp': path.join(tempRoot, 'Cellar', 'whisper-cpp'),
    'python@3.12': path.join(tempRoot, 'Cellar', 'python@3.12'),
  }
  const brewCommand = path.join(homebrewBin, 'brew')
  const ffmpegCommand = path.join(formulaPrefixes.ffmpeg, 'bin', 'ffmpeg')
  const pdftotextCommand = path.join(formulaPrefixes.poppler, 'bin', 'pdftotext')
  const whisperCommand = path.join(formulaPrefixes['whisper-cpp'], 'bin', 'whisper-cli')
  const pythonCommand = path.join(formulaPrefixes['python@3.12'], 'bin', 'python3.12')
  const installedFormulas = new Set<string>()
  const runCalls: Array<{ file: string; args: string[] }> = []
  const initCalls: Array<{ requestId: string | null; vault: string }> = []
  const bootstrapCalls: Array<Record<string, unknown>> = []

  await writeExecutable(brewCommand)
  await writeExecutable(ffmpegCommand)
  await writeExecutable(pdftotextCommand)
  await writeExecutable(whisperCommand)
  await writeExecutable(pythonCommand)

  const services = createSetupServices({
    arch: () => 'arm64',
    downloadFile: async (_url, destinationPath) => {
      await writeFile(destinationPath, 'model', 'utf8')
    },
    env: () => ({ PATH: homebrewBin }),
    getHomeDirectory: () => homeRoot,
    inboxServices: {
      async bootstrap(input) {
        bootstrapCalls.push(input as unknown as Record<string, unknown>)
        return makeBootstrapResult(vaultRoot)
      },
    },
    log() {},
    platform: () => 'darwin',
    runCommand: async ({ file, args }) => {
      runCalls.push({ args, file })
      const baseName = path.basename(file)

      if (baseName === 'brew' && args[0] === 'list' && args[1] === '--versions') {
        const formula = args[2] ?? ''
        return installedFormulas.has(formula)
          ? {
              exitCode: 0,
              stderr: '',
              stdout: `${formula} 1.0.0\n`,
            }
          : {
              exitCode: 1,
              stderr: '',
              stdout: '',
            }
      }

      if (baseName === 'brew' && args[0] === 'install') {
        installedFormulas.add(args[1] ?? '')
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'installed\n',
        }
      }

      if (baseName === 'brew' && args[0] === '--prefix') {
        const formula = args[1] as keyof typeof formulaPrefixes
        return {
          exitCode: 0,
          stderr: '',
          stdout: `${formulaPrefixes[formula]}\n`,
        }
      }

      if (file === pythonCommand && args[0] === '-m' && args[1] === 'venv') {
        const venvRoot = args[2] ?? ''
        await writeExecutable(path.join(venvRoot, 'bin', 'python'))
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'venv created\n',
        }
      }

      if (
        path.basename(file) === 'python' &&
        args[0] === '-m' &&
        args[1] === 'pip' &&
        args[2] === 'install'
      ) {
        if (args.includes('paddlex[ocr]')) {
          await writeExecutable(path.join(path.dirname(file), 'paddlex'))
        }
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'pip ok\n',
        }
      }

      throw new Error(`Unexpected command: ${file} ${args.join(' ')}`)
    },
    vaultServices: {
      core: {
        async init(input: { requestId: string | null; vault: string }) {
          initCalls.push(input)
          return {
            created: true,
            directories: [],
            files: [],
            vault: input.vault,
          }
        },
      },
    } as any,
  })

  try {
    const result = await services.setupMacos({
      requestId: 'req-123',
      vault: vaultRoot,
      whisperModel: 'base.en',
    })

    assert.equal(result.bootstrap?.vault, vaultRoot)
    assert.equal(initCalls.length, 1)
    assert.deepEqual(initCalls[0], { requestId: 'req-123', vault: vaultRoot })
    assert.equal(bootstrapCalls.length, 1)
    assert.equal(bootstrapCalls[0]?.vault, vaultRoot)
    assert.equal(bootstrapCalls[0]?.ffmpegCommand, ffmpegCommand)
    assert.equal(bootstrapCalls[0]?.pdftotextCommand, pdftotextCommand)
    assert.equal(bootstrapCalls[0]?.whisperCommand, whisperCommand)
    assert.equal(
      bootstrapCalls[0]?.whisperModelPath,
      path.join(homeRoot, '.healthybob', 'toolchain', 'models', 'whisper', 'ggml-base.en.bin'),
    )
    assert.match(
      String(bootstrapCalls[0]?.paddleocrCommand),
      /paddlex-ocr\/bin\/paddlex$/u,
    )
    assert.equal(installedFormulas.has('ffmpeg'), true)
    assert.equal(installedFormulas.has('poppler'), true)
    assert.equal(installedFormulas.has('whisper-cpp'), true)
    assert.equal(installedFormulas.has('python@3.12'), true)
    assert.equal(
      result.steps.some((step) => step.id === 'paddlex-ocr' && step.status === 'completed'),
      true,
    )

    const modelText = await readFile(result.tools.whisperModelPath, 'utf8')
    assert.equal(modelText, 'model')
    assert.equal(
      runCalls.some(
        ({ args, file }) => path.basename(file) === 'brew' && args.join(' ') === 'install ffmpeg',
      ),
      true,
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('setup routing helpers keep the setup alias stable', () => {
  assert.equal(isSetupInvocation(['setup', '--dryRun']), true)
  assert.equal(isSetupInvocation(['inbox', 'doctor']), false)
  assert.equal(
    detectSetupProgramName('/usr/local/bin/healthybob'),
    'healthybob',
  )
  assert.equal(
    detectSetupProgramName('/tmp/packages/cli/dist/bin.js'),
    'vault-cli',
  )

  const cli = createSetupCli({ commandName: 'healthybob' })
  assert.ok(cli)
})

test('setup service rejects non-macOS hosts', async () => {
  const services = createSetupServices({
    platform: () => 'linux',
    log() {},
  })

  await assert.rejects(
    services.setupMacos({ vault: './vault' }),
    (error: unknown) => {
      assert.equal(error instanceof Error, true)
      assert.match(String(error), /macOS only/u)
      return true
    },
  )
})
