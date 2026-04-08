import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'vitest'

import {
  discoverCodexHomes,
  resolveSetupCodexHomeSelection,
} from '../src/setup-codex-home.ts'
import { assertCommandSucceeded } from '../src/setup-services/process.ts'
import {
  buildBaseFormulaSpecs,
  createStep,
  DEFAULT_TOOLCHAIN_DIRECTORY,
  resolveWhisperModelPath,
  whisperModelDownloadUrl,
} from '../src/setup-services/steps.ts'
import {
  pathIncludesSegment,
  redactHomePath,
  redactHomePathInText,
  redactHomePathsInValue,
  resolveShellProfilePath,
} from '../src/setup-services/shell.ts'
import {
  resolveExecutablePath,
  withPrependedPath,
} from '../src/setup-services/toolchain.ts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { resolveAssistantStatePaths } from '@murphai/assistant-engine/assistant-state'
import {
  listSetupPendingWearables,
  listSetupReadyWearables,
  resolveSetupPostLaunchAction,
  resolveInitialSetupWizardChannels,
  shouldAutoLaunchAssistantAfterSetup,
  shouldRunSetupWizard,
} from '../src/setup-cli.ts'

test('service-step helpers preserve the stable toolchain ordering and step shape', () => {
  const specs = buildBaseFormulaSpecs()

  assert.deepEqual(
    specs.map((spec) => [spec.id, spec.commandCandidates, spec.key]),
    [
      ['ffmpeg', ['ffmpeg'], 'ffmpegCommand'],
      ['pdftotext', ['pdftotext'], 'pdftotextCommand'],
      ['whisper-cpp', ['whisper-cli', 'whisper-cpp'], 'whisperCommand'],
    ],
  )
  assert.equal(
    whisperModelDownloadUrl('base.en'),
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  )
  assert.equal(
    resolveWhisperModelPath('/tmp/toolchain', 'tiny'),
    path.join('/tmp/toolchain', 'models', 'whisper', 'ggml-tiny.bin'),
  )

  assert.deepEqual(
    createStep({
      id: 'toolchain-root',
      title: 'Local toolchain root',
      kind: 'configure',
      status: 'planned',
      detail: 'Create the local toolchain root.',
    }),
    {
      id: 'toolchain-root',
      title: 'Local toolchain root',
      kind: 'configure',
      status: 'planned',
      detail: 'Create the local toolchain root.',
    },
  )
})

test('setup scheduling helpers respect terminal gating and launch routing', () => {
  assert.equal(
    shouldRunSetupWizard(
      { agent: false, format: 'toon', dryRun: false },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    true,
  )
  assert.equal(
    shouldRunSetupWizard(
      { agent: false, format: 'json', dryRun: false },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    false,
  )
  assert.equal(
    resolveSetupPostLaunchAction(
      {
        agent: false,
        format: 'toon',
        formatExplicit: false,
        result: {
          arch: 'arm64',
          assistant: null,
          bootstrap: null,
          channels: [
            {
              autoReply: true,
              channel: 'email',
              configured: true,
              connectorId: 'email:agentmail',
              detail: 'Configured email.',
              enabled: true,
              missingEnv: [],
            },
          ],
          dryRun: false,
          notes: [],
          platform: 'darwin',
          scheduledUpdates: [],
          steps: [],
          toolchainRoot: '~/.murph/toolchain',
          tools: {
            ffmpegCommand: null,
            pdftotextCommand: null,
            whisperCommand: null,
            whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
          },
          vault: '~/vault',
          wearables: [],
          whisperModel: 'base.en',
        },
      },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    'assistant-run',
  )
  assert.equal(
    resolveSetupPostLaunchAction(
      {
        agent: false,
        format: 'toon',
        formatExplicit: false,
        result: {
          arch: 'arm64',
          assistant: null,
          bootstrap: null,
          channels: [],
          dryRun: false,
          notes: [],
          platform: 'darwin',
          scheduledUpdates: [],
          steps: [],
          toolchainRoot: '~/.murph/toolchain',
          tools: {
            ffmpegCommand: null,
            pdftotextCommand: null,
            whisperCommand: null,
            whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
          },
          vault: '~/vault',
          wearables: [],
          whisperModel: 'base.en',
        },
      },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    'assistant-chat',
  )
  assert.equal(
    resolveSetupPostLaunchAction(
      {
        agent: false,
        format: 'toon',
        formatExplicit: false,
        result: {
          arch: 'arm64',
          assistant: null,
          bootstrap: null,
          channels: [],
          dryRun: false,
          notes: [],
          platform: 'darwin',
          scheduledUpdates: [],
          steps: [],
          toolchainRoot: '~/.murph/toolchain',
          tools: {
            ffmpegCommand: null,
            pdftotextCommand: null,
            whisperCommand: null,
            whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
          },
          vault: '~/vault',
          wearables: [],
          whisperModel: 'base.en',
        },
      },
      { stdinIsTTY: false, stderrIsTTY: true },
    ),
    null,
  )
  assert.equal(
    shouldAutoLaunchAssistantAfterSetup(
      {
        agent: false,
        format: 'toon',
        formatExplicit: false,
        result: {
          arch: 'arm64',
          assistant: null,
          bootstrap: null,
          channels: [],
          dryRun: false,
          notes: [],
          platform: 'darwin',
          scheduledUpdates: [],
          steps: [],
          toolchainRoot: '~/.murph/toolchain',
          tools: {
            ffmpegCommand: null,
            pdftotextCommand: null,
            whisperCommand: null,
            whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
          },
          vault: '~/vault',
          wearables: [],
          whisperModel: 'base.en',
        },
      },
      { stdinIsTTY: true, stderrIsTTY: true },
    ),
    true,
  )
  assert.deepEqual(
    listSetupReadyWearables({
      arch: 'arm64',
      assistant: null,
      bootstrap: null,
      channels: [],
      dryRun: false,
      notes: [],
      platform: 'darwin',
      scheduledUpdates: [],
      steps: [],
      toolchainRoot: '~/.murph/toolchain',
      tools: {
        ffmpegCommand: null,
        pdftotextCommand: null,
        whisperCommand: null,
        whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
      },
      vault: '~/vault',
      wearables: [
        {
          enabled: true,
          ready: true,
          wearable: 'garmin',
          missingEnv: [],
          detail: 'Ready.',
        },
        {
          enabled: true,
          ready: false,
          wearable: 'oura',
          missingEnv: ['OURA_CLIENT_ID'],
          detail: 'Waiting.',
        },
      ],
      whisperModel: 'base.en',
    }),
    ['garmin'],
  )
  assert.deepEqual(
    listSetupPendingWearables({
      arch: 'arm64',
      assistant: null,
      bootstrap: null,
      channels: [],
      dryRun: false,
      notes: [],
      platform: 'darwin',
      scheduledUpdates: [],
      steps: [],
      toolchainRoot: '~/.murph/toolchain',
      tools: {
        ffmpegCommand: null,
        pdftotextCommand: null,
        whisperCommand: null,
        whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
      },
      vault: '~/vault',
      wearables: [
        {
          enabled: true,
          ready: true,
          wearable: 'garmin',
          missingEnv: [],
          detail: 'Ready.',
        },
        {
          enabled: true,
          ready: false,
          wearable: 'oura',
          missingEnv: ['OURA_CLIENT_ID'],
          detail: 'Waiting.',
        },
      ],
      whisperModel: 'base.en',
    }).map((wearable) => wearable.wearable),
    ['oura'],
  )
})

test('setup wizard initial channels reuse saved automation channels and fall back when none are saved', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'setup-cli-vault-'))
  const automationStatePath = resolveAssistantStatePaths(vaultRoot).automationStatePath

  try {
    assert.deepEqual(
      await resolveInitialSetupWizardChannels(vaultRoot, 'darwin'),
      ['imessage'],
    )

    await mkdir(path.dirname(automationStatePath), { recursive: true })
    await writeFile(
      automationStatePath,
      JSON.stringify({
        version: 2,
        inboxScanCursor: null,
        autoReplyScanCursor: null,
        autoReplyChannels: ['telegram', 'email', 'unknown'],
        autoReplyBacklogChannels: [],
        autoReplyPrimed: true,
        updatedAt: '2026-04-08T00:00:00.000Z',
      }),
      'utf8',
    )

    assert.deepEqual(
      await resolveInitialSetupWizardChannels(vaultRoot, 'darwin'),
      ['telegram', 'email'],
    )

    await writeFile(
      automationStatePath,
      JSON.stringify({
        version: 2,
        inboxScanCursor: null,
        autoReplyScanCursor: null,
        autoReplyChannels: [],
        autoReplyBacklogChannels: [],
        autoReplyPrimed: false,
        updatedAt: '2026-04-08T00:00:00.000Z',
      }),
      'utf8',
    )

    assert.deepEqual(
      await resolveInitialSetupWizardChannels(vaultRoot, 'linux'),
      [],
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('shell and process helpers normalize paths and command failures predictably', async () => {
  const homeDirectory = path.join('/tmp', 'murph-home')

  assert.equal(resolveShellProfilePath(homeDirectory, { SHELL: '/bin/zsh' }), path.join(homeDirectory, '.zshrc'))
  assert.equal(resolveShellProfilePath(homeDirectory, { SHELL: '/bin/bash' }), path.join(homeDirectory, '.bashrc'))
  assert.equal(resolveShellProfilePath(homeDirectory, {}), path.join(homeDirectory, '.profile'))

  assert.equal(redactHomePath(path.join(homeDirectory, 'projects', 'murph'), homeDirectory), '~/projects/murph')
  assert.equal(
    redactHomePathInText(`cd ${homeDirectory}/projects/murph && echo done`, homeDirectory),
    'cd ~/projects/murph && echo done',
  )
  assert.deepEqual(
    redactHomePathsInValue(
      {
        nested: [homeDirectory, { path: path.join(homeDirectory, 'bin') }],
      },
      homeDirectory,
    ),
    {
      nested: ['~', { path: '~/bin' }],
    },
  )

  assert.equal(
    pathIncludesSegment(
      ['/usr/bin', '/opt/homebrew/bin', '/tmp/murph bin'].join(path.delimiter),
      '/opt/homebrew/bin',
    ),
    true,
  )
  assert.equal(pathIncludesSegment('/usr/bin:/bin', '/opt/homebrew/bin'), false)

  const runnerPath = await mkdtemp(path.join(tmpdir(), 'murph-setup-cli-'))
  try {
    const binDir = path.join(runnerPath, 'bin')
    await mkdir(binDir, { recursive: true })
    const toolPath = path.join(binDir, 'tool')
    await writeFile(toolPath, '#!/usr/bin/env bash\nexit 0\n', 'utf8')
    await chmod(toolPath, 0o755)

    assert.equal(
      await resolveExecutablePath(['tool'], {
        PATH: ['/usr/bin', binDir].join(path.delimiter),
      }),
      toolPath,
    )
    assert.equal(
      await resolveExecutablePath(['missing'], { PATH: '/usr/bin' }, [toolPath]),
      toolPath,
    )

    assert.deepEqual(
      withPrependedPath(
        { PATH: ['/usr/bin', '/bin'].join(path.delimiter) },
        ['/opt/murph/bin', '/usr/bin'],
      ),
      {
        PATH: ['/opt/murph/bin', '/usr/bin', '/bin'].join(path.delimiter),
      },
    )

    assert.doesNotThrow(() =>
      assertCommandSucceeded(
        {
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
        'unused',
      ),
    )

  assert.throws(
      () =>
        assertCommandSucceeded(
          {
            exitCode: 17,
            stdout: 'command output',
            stderr: '',
          },
          'setup_failed',
          {
            command: 'tool --flag',
          },
        ),
      isVaultCliErrorWithContext,
    )
  } finally {
    await rm(runnerPath, { recursive: true, force: true })
  }
})

test('codex home selection discovers matching homes and normalizes explicit choices', async () => {
  const homeDirectory = await mkdtemp(path.join(tmpdir(), 'murph-codex-home-'))
  const ambientHome = path.join(homeDirectory, '.codex')
  const teamHome = path.join(homeDirectory, '.codex-team')
  const workHome = path.join(homeDirectory, 'codex-work')
  const ignoredHome = path.join(homeDirectory, 'notes')
  const input = new PassThrough()
  const output = new PassThrough()

  try {
    await mkdir(path.join(ambientHome, 'sessions'), { recursive: true })
    await mkdir(teamHome, { recursive: true })
    await writeFile(path.join(teamHome, 'auth.json'), '{}', 'utf8')
    await mkdir(path.join(workHome, 'archived_sessions'), { recursive: true })
    await mkdir(ignoredHome, { recursive: true })
    await writeFile(path.join(ignoredHome, 'auth.json'), '{}', 'utf8')

    const discovered = await discoverCodexHomes({
      env: {
        CODEX_HOME: ambientHome,
      },
      homeDirectory,
    })

    assert.deepEqual(discovered, [teamHome, workHome].sort((left, right) => left.localeCompare(right)))

    const selected = await resolveSetupCodexHomeSelection({
      allowPrompt: false,
      currentCodexHome: '~/codex-work',
      explicitCodexHome: null,
      input,
      output,
      dependencies: {
        env: () => ({
          CODEX_HOME: ambientHome,
        }),
        getHomeDirectory: () => homeDirectory,
      },
    })

    assert.deepEqual(selected, {
      codexHome: workHome,
      discoveredHomes: [],
    })

    const explicit = await resolveSetupCodexHomeSelection({
      allowPrompt: false,
      currentCodexHome: null,
      explicitCodexHome: path.join('~', path.basename(teamHome)),
      input,
      output,
      dependencies: {
        getHomeDirectory: () => homeDirectory,
      },
    })

    assert.deepEqual(explicit, {
      codexHome: teamHome,
      discoveredHomes: [],
    })

    assert.equal(DEFAULT_TOOLCHAIN_DIRECTORY, path.join('.murph', 'toolchain'))
  } finally {
    await rm(homeDirectory, { recursive: true, force: true })
  }
})

function isVaultCliErrorWithContext(error: unknown): error is VaultCliError {
  if (!(error instanceof VaultCliError)) {
    return false
  }

  if (error.code !== 'setup_failed') {
    return false
  }

  const context = error.context
  return (
    typeof context === 'object' &&
    context !== null &&
    'command' in context &&
    (context as Record<string, unknown>).command === 'tool --flag'
  )
}
