#!/usr/bin/env node

import { access, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  CdpClient,
  DEFAULT_BROWSER_ENDPOINT,
  ensureTarget,
  sleep,
  waitForTargetContent,
} from './chatgpt-managed-browser.mjs'

const DEFAULT_TIMEOUT_MS = 30_000

function parseArgs(argv) {
  const args = {
    browserEndpoint: DEFAULT_BROWSER_ENDPOINT,
    chatUrl: null,
    attachmentText: null,
    outputDir: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--chat-url') {
      args.chatUrl = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--chat-url=')) {
      args.chatUrl = arg.slice('--chat-url='.length)
      continue
    }
    if (arg === '--attachment-text') {
      args.attachmentText = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--attachment-text=')) {
      args.attachmentText = arg.slice('--attachment-text='.length)
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
    if (arg === '--browser-endpoint') {
      args.browserEndpoint = argv[index + 1] ?? DEFAULT_BROWSER_ENDPOINT
      index += 1
      continue
    }
    if (arg.startsWith('--browser-endpoint=')) {
      args.browserEndpoint = arg.slice('--browser-endpoint='.length)
      continue
    }
    if (arg === '--timeout-ms') {
      args.timeoutMs = Number.parseInt(argv[index + 1] ?? '', 10)
      index += 1
      continue
    }
    if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!args.chatUrl) {
    throw new Error('--chat-url is required.')
  }
  if (!args.attachmentText) {
    throw new Error('--attachment-text is required.')
  }
  if (!args.outputDir) {
    throw new Error('--output-dir is required.')
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer.')
  }

  return args
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function removeIfPresent(filePath) {
  if (await exists(filePath)) {
    await rm(filePath, { force: true })
  }
}

async function clickAttachment(client, attachmentText) {
  return client.evaluate(`(() => {
    const deriveHrefLabel = (href) => {
      if (!href) {
        return ''
      }
      try {
        return decodeURIComponent(new URL(href).pathname.split('/').filter(Boolean).at(-1) || '')
      } catch {
        return decodeURIComponent(href.split('/').filter(Boolean).at(-1) || '')
      }
    }
    const target = Array.from(document.querySelectorAll('button, a')).find((element) => {
      const text = (element.innerText || element.getAttribute('aria-label') || '').trim()
      return text === ${JSON.stringify(attachmentText)} || deriveHrefLabel(element.href || '') === ${JSON.stringify(attachmentText)}
    })
    if (!target) {
      return { found: false, availableButtons: Array.from(document.querySelectorAll('button')).map((element) => (element.innerText || element.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(-80) }
    }
    const hrefLabel = deriveHrefLabel(target.href || '')
    target.scrollIntoView({ block: 'center' })
    target.click()
    return {
      found: true,
      text: (target.innerText || target.getAttribute('aria-label') || '').trim(),
      href: target.href || null,
      hrefLabel,
    }
  })()`)
}

async function waitForDownloadedFile(filePath, timeoutMs) {
  const startedAt = Date.now()
  for (;;) {
    if (await exists(filePath)) {
      return
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for downloaded file ${filePath}`)
    }
    await sleep(250)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(args.outputDir, { recursive: true })

  const target = await ensureTarget(args.browserEndpoint, args.chatUrl)
  const client = new CdpClient(target.webSocketDebuggerUrl)

  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await waitForTargetContent(client, args.chatUrl)
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: path.resolve(args.outputDir),
    })

    const clicked = await clickAttachment(client, args.attachmentText)
    if (!clicked?.found) {
      throw new Error(
        `Attachment button not found for ${args.attachmentText}. Available buttons: ${(clicked?.availableButtons ?? []).join(' | ')}`,
      )
    }

    const expectedFilenames = new Set(
      [args.attachmentText, clicked.text, clicked.hrefLabel]
        .map((value) => String(value ?? '').trim())
        .filter((value) => value.length > 0),
    )
    const downloadStart = await client.waitForEvent(
      (event) =>
        event.method === 'Page.downloadWillBegin' &&
        expectedFilenames.has(String(event.params?.suggestedFilename ?? '')),
      args.timeoutMs,
    )
    const downloadedFile = path.join(
      path.resolve(args.outputDir),
      downloadStart.params.suggestedFilename,
    )
    await removeIfPresent(`${downloadedFile}.crdownload`)

    await client.waitForEvent(
      (event) =>
        event.method === 'Page.downloadProgress' &&
        event.params?.guid === downloadStart.params.guid &&
        event.params?.state === 'completed',
      args.timeoutMs,
    )
    await waitForDownloadedFile(downloadedFile, args.timeoutMs)
    process.stdout.write(`${downloadedFile}\n`)
  } finally {
    client.close()
  }
}

await main()
