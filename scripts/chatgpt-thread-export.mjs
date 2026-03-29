#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const DEFAULT_BROWSER_ENDPOINT = 'http://127.0.0.1:9222'
const TARGET_READY_TIMEOUT_MS = 30_000
const TARGET_READY_POLL_MS = 750

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  return response.json()
}

class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (!message.id || !this.pending.has(message.id)) {
        return
      }
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)))
        return
      }
      resolve(message.result)
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = this.nextId
    this.nextId += 1
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  async evaluate(expression, options = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: options.awaitPromise ?? false,
      returnByValue: true,
    })
    return result.result?.value
  }

  close() {
    this.ws.close()
  }
}

async function findMatchingTarget(browserEndpoint, chatUrl) {
  const targets = await fetchJson(`${browserEndpoint}/json/list`)
  const matches = targets.filter(
    (target) => target.type === 'page' && target.url === chatUrl,
  )
  return matches.at(-1) ?? null
}

async function createTarget(browserEndpoint, chatUrl) {
  const version = await fetchJson(`${browserEndpoint}/json/version`)
  const browser = new CdpClient(version.webSocketDebuggerUrl)
  try {
    await browser.send('Target.createTarget', { url: chatUrl })
  } finally {
    browser.close()
  }
}

async function ensureTarget(browserEndpoint, chatUrl) {
  const existingTarget = await findMatchingTarget(browserEndpoint, chatUrl)
  if (existingTarget) {
    return existingTarget
  }

  await createTarget(browserEndpoint, chatUrl)
  const startedAt = Date.now()
  for (;;) {
    const target = await findMatchingTarget(browserEndpoint, chatUrl)
    if (target) {
      return target
    }
    if (Date.now() - startedAt > TARGET_READY_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for a browser tab for ${chatUrl}`)
    }
    await sleep(TARGET_READY_POLL_MS)
  }
}

async function waitForTargetContent(client, chatUrl) {
  const startedAt = Date.now()
  for (;;) {
    const state = await client.evaluate(`(() => ({
      href: location.href,
      readyState: document.readyState,
      title: document.title,
      bodyLength: document.body?.innerText?.length ?? 0,
    }))()`)
    if (
      state &&
      state.href === chatUrl &&
      state.readyState === 'complete' &&
      state.bodyLength > 0
    ) {
      return state
    }
    if (Date.now() - startedAt > TARGET_READY_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ChatGPT thread content for ${chatUrl}`)
    }
    await sleep(TARGET_READY_POLL_MS)
  }
}

async function captureThread(client) {
  return client.evaluate(`(() => {
    const bodyText = document.body?.innerText ?? ''
    const filePattern = /\\.(patch|diff|zip|txt|json|md)\\b/i
    const keywordPattern = /patch|diff|archive|zip|file/i
    const attachments = Array.from(document.querySelectorAll('button, a'))
      .map((element) => ({
        tag: element.tagName,
        text: (element.innerText || element.getAttribute('aria-label') || '').trim(),
        href: element.href || null,
      }))
      .filter(
        (item) =>
          filePattern.test(item.text) ||
          filePattern.test(item.href || '') ||
          keywordPattern.test(item.text),
      )

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
    const snapshot = await captureThread(client)
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
