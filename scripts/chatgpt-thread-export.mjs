#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'
import {
  CdpClient,
  DEFAULT_BROWSER_ENDPOINT,
  ensureTarget,
  waitForTargetContent,
} from './chatgpt-managed-browser.mjs'
import { filterThreadAttachmentCandidates } from './chatgpt-attachment-files.mjs'

function parseArgs(argv) {
  const args = {
    browserEndpoint: DEFAULT_BROWSER_ENDPOINT,
    chatUrl: null,
    output: null,
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
    if (arg === '--output') {
      args.output = argv[index + 1] ?? null
      index += 1
      continue
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length)
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
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!args.chatUrl) {
    throw new Error('--chat-url is required.')
  }
  if (!args.output) {
    throw new Error('--output is required.')
  }

  return args
}

async function captureThread(client) {
  return client.evaluate(`(() => {
    const bodyText = document.body?.innerText ?? ''
    const attachments = Array.from(document.querySelectorAll('button, a'))
      .map((element) => ({
        tag: element.tagName,
        text: (element.innerText || element.getAttribute('aria-label') || '').trim(),
        href: element.href || null,
      }))

    const codeBlocks = Array.from(document.querySelectorAll('pre'))
      .map((element) => element.innerText)
      .filter(Boolean)

    return {
      href: location.href,
      title: document.title,
      patchMarkers: {
        beginPatch: bodyText.includes('*** Begin Patch'),
        diffGit: bodyText.includes('diff --git'),
        addFile: bodyText.includes('*** Add File:'),
        updateFile: bodyText.includes('*** Update File:'),
        deleteFile: bodyText.includes('*** Delete File:'),
      },
      attachmentButtons: attachments,
      codeBlocks,
      bodyText,
    }
  })()`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const target = await ensureTarget(args.browserEndpoint, args.chatUrl)
  const client = new CdpClient(target.webSocketDebuggerUrl)

  try {
    await client.send('Runtime.enable')
    await waitForTargetContent(client, args.chatUrl)
    const rawSnapshot = await captureThread(client)
    const snapshot = {
      ...rawSnapshot,
      attachmentButtons: filterThreadAttachmentCandidates(
        rawSnapshot.attachmentButtons,
      ),
    }
    const payload = {
      capturedAt: new Date().toISOString(),
      chatUrl: args.chatUrl,
      ...snapshot,
    }
    await writeFile(args.output, JSON.stringify(payload, null, 2))
    process.stdout.write(`${args.output}\n`)
  } finally {
    client.close()
  }
}

await main()
