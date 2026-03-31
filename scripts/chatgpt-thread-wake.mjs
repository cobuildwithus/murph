#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { collectPatchArtifactLabels } from './chatgpt-attachment-files.mjs'

function parseDurationMs(raw) {
  const normalized = raw.trim()
  const matches = [...normalized.matchAll(/(\d+)\s*([smhd])/giu)]
  if (
    matches.length === 0 ||
    matches.map((match) => match[0]).join('') !== normalized.replace(/\s+/gu, '')
  ) {
    throw new Error(
      'Unsupported delay format. Use values like 300s, 70m, 1h, or 1h30m.',
    )
  }

  const unitMs = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }

  const totalMs = matches.reduce((sum, match) => {
    const value = Number.parseInt(match[1], 10)
    const unit = match[2].toLowerCase()
    return sum + value * unitMs[unit]
  }, 0)

  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    throw new Error('Delay must resolve to a positive duration.')
  }

  return totalMs
}

function parseArgs(argv) {
  const args = {
    delay: '70m',
    chatUrl: null,
    sessionId: process.env.CODEX_THREAD_ID ?? null,
    outputDir: null,
    skipResume: false,
    fullAuto: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--delay') {
      args.delay = argv[index + 1] ?? ''
      index += 1
      continue
    }
    if (arg.startsWith('--delay=')) {
      args.delay = arg.slice('--delay='.length)
      continue
    }
    if (arg === '--chat-url') {
      args.chatUrl = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--chat-url=')) {
      args.chatUrl = arg.slice('--chat-url='.length)
      continue
    }
    if (arg === '--session-id') {
      args.sessionId = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--session-id=')) {
      args.sessionId = arg.slice('--session-id='.length)
      continue
    }
    if (arg === '--output-dir') {
      args.outputDir = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--output-dir=')) {
      args.outputDir = arg.slice('--output-dir='.length)
      continue
    }
    if (arg === '--skip-resume') {
      args.skipResume = true
      continue
    }
    if (arg === '--no-full-auto') {
      args.fullAuto = false
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!args.chatUrl) {
    throw new Error('--chat-url is required.')
  }
  if (!args.skipResume && !args.sessionId) {
    throw new Error(
      '--session-id is required unless --skip-resume is set or CODEX_THREAD_ID is available.',
    )
  }

  return args
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} exited with code ${code ?? 'null'}`))
    })
  })
}

function chatIdFromUrl(chatUrl) {
  const lastSegment = new URL(chatUrl).pathname.split('/').filter(Boolean).at(-1)
  return lastSegment ?? 'chat'
}

function buildResumePrompt(input) {
  const lines = [
    'Wake-up task:',
    `- Read the exported ChatGPT thread JSON at ${input.exportPath}.`,
    input.downloadedPatches.length > 0
      ? `- Inspect and apply the downloaded patch artifacts (including any \`.patched\` code files): ${input.downloadedPatches.join(', ')}.`
      : '- No patch or `.patched` code files were downloaded; inspect the thread export and attachment labels to determine why.',
    '- Implement the patch contents in this repository if they are applicable.',
    '- Run the repo-required verification commands and report any unrelated blockers separately.',
    '- Keep changes scoped to what the downloaded patch actually requires.',
  ]
  return lines.join('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const delayMs = parseDurationMs(args.delay)
  const chatId = chatIdFromUrl(args.chatUrl)
  const timestamp = new Date().toISOString().replaceAll(':', '').replace(/\.\d{3}Z$/u, 'Z')
  const outputDir = path.resolve(
    args.outputDir ?? path.join('output-packages', 'chatgpt-watch', `${chatId}-${timestamp}`),
  )
  const exportPath = path.join(outputDir, 'thread.json')
  const resumeOutputPath = path.join(outputDir, 'codex-last-message.md')
  const downloadDir = path.join(outputDir, 'downloads')

  await mkdir(downloadDir, { recursive: true })
  process.stderr.write(
    `Sleeping for ${args.delay} before checking ${args.chatUrl}.\nOutput dir: ${outputDir}\n`,
  )
  await sleep(delayMs)

  await runCommand('node', [
    'scripts/chatgpt-thread-export.mjs',
    '--chat-url',
    args.chatUrl,
    '--output',
    exportPath,
  ])

  const exportJson = JSON.parse(await readFile(exportPath, 'utf8'))
  const patchLabels = collectPatchArtifactLabels(exportJson.attachmentButtons ?? [])

  const downloadedPatches = []
  for (const label of patchLabels) {
    await runCommand('node', [
      'scripts/chatgpt-thread-download.mjs',
      '--chat-url',
      args.chatUrl,
      '--attachment-text',
      label,
      '--output-dir',
      downloadDir,
    ])
    downloadedPatches.push(path.join(downloadDir, label))
  }

  if (args.skipResume) {
    process.stdout.write(
      JSON.stringify({ exportPath, downloadedPatches, outputDir }, null, 2) + '\n',
    )
    return
  }

  const resumeArgs = [
    'exec',
    'resume',
    args.sessionId,
    buildResumePrompt({ exportPath, downloadedPatches }),
    '--output-last-message',
    resumeOutputPath,
  ]
  if (args.fullAuto) {
    resumeArgs.push('--full-auto')
  }

  await runCommand('codex', resumeArgs)
  process.stdout.write(
    JSON.stringify({ exportPath, downloadedPatches, resumeOutputPath, outputDir }, null, 2) +
      '\n',
  )
}

await main()
