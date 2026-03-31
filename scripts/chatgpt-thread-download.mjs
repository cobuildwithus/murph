#!/usr/bin/env node

import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  CdpClient,
  DEFAULT_BROWSER_ENDPOINT,
  ensureTarget,
  sleep,
  waitForTargetContent,
} from './chatgpt-managed-browser.mjs'

const DEFAULT_TIMEOUT_MS = 30_000
const NATIVE_DOWNLOAD_GRACE_MS = 1_500
const LATE_NATIVE_DOWNLOAD_GRACE_MS = 1_000

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

function parseContentDispositionFilename(value) {
  const raw = String(value ?? '').trim()
  if (raw.length === 0) {
    return null
  }

  const utf8Match = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/iu)
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1])
  }

  const quotedMatch = raw.match(/filename\s*=\s*"([^"]+)"/iu)
  if (quotedMatch) {
    return quotedMatch[1]
  }

  const bareMatch = raw.match(/filename\s*=\s*([^;]+)/iu)
  if (bareMatch) {
    return bareMatch[1].trim()
  }

  return null
}

function sanitizeDownloadFilename(value, fallback = 'downloaded-artifact') {
  const raw = String(value ?? '').trim()
  const normalized = raw.replaceAll('\\', '/')
  const basename = path.posix.basename(normalized).trim()
  if (
    basename.length === 0 ||
    basename === '.' ||
    basename === '..'
  ) {
    return fallback
  }
  return basename
}

async function findAttachmentClickTarget(client, attachmentText) {
  return client.evaluate(`(() => {
    const root = document.querySelector('main') ?? document.body
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

    const target = Array.from(root.querySelectorAll('button, a')).find((element) => {
      const text = (element.innerText || element.getAttribute('aria-label') || '').trim()
      return (
        text === ${JSON.stringify(attachmentText)} ||
        deriveHrefLabel(element.href || '') === ${JSON.stringify(attachmentText)}
      )
    })
    if (!target) {
      return {
        found: false,
        availableButtons: Array.from(root.querySelectorAll('button, a'))
          .map((element) => (element.innerText || element.getAttribute('aria-label') || '').trim())
          .filter(Boolean)
          .slice(-80),
      }
    }

    target.scrollIntoView({ block: 'center' })
    const rect = target.getBoundingClientRect()
    return {
      found: true,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      href: target.href || null,
      hrefLabel: deriveHrefLabel(target.href || ''),
      text: (target.innerText || target.getAttribute('aria-label') || '').trim(),
    }
  })()`)
}

async function clickAttachment(client, attachmentText, timeoutMs) {
  const startedAt = Date.now()
  let target = await findAttachmentClickTarget(client, attachmentText)
  while (!target?.found && Date.now() - startedAt <= timeoutMs) {
    await sleep(250)
    target = await findAttachmentClickTarget(client, attachmentText)
  }
  if (!target?.found) {
    return target
  }

  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: target.centerX,
    y: target.centerY,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: target.centerX,
    y: target.centerY,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: target.centerX,
    y: target.centerY,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })
  return target
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

async function fetchArtifactThroughPage(client, requestUrl) {
  return client.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(requestUrl)}, {
      credentials: 'include',
    })
    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
    }
    return {
      base64: btoa(binary),
      contentDisposition: response.headers.get('content-disposition'),
      contentType: response.headers.get('content-type'),
      ok: response.ok,
      status: response.status,
    }
  })()`, { awaitPromise: true })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  await mkdir(args.outputDir, { recursive: true })

  const target = await ensureTarget(args.browserEndpoint, args.chatUrl)
  const client = new CdpClient(target.webSocketDebuggerUrl)

  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await client.send('Network.enable')
    await waitForTargetContent(client, args.chatUrl)
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: path.resolve(args.outputDir),
    })

    const downloadStartPromise = client.waitForEvent(
      (event) =>
        event.method === 'Page.downloadWillBegin' &&
        String(event.params?.suggestedFilename ?? '').length > 0,
      args.timeoutMs,
    ).then((event) => ({ event, kind: 'native-download' }))

    const estuaryResponsePromise = client.waitForEvent(
      (event) =>
        event.method === 'Network.responseReceived' &&
        String(event.params?.response?.url ?? '').includes('/backend-api/estuary/content') &&
        Number(event.params?.response?.status ?? 0) >= 200 &&
        Number(event.params?.response?.status ?? 0) < 300,
      args.timeoutMs,
    ).then((event) => ({ event, kind: 'estuary-response' }))

    const clicked = await clickAttachment(
      client,
      args.attachmentText,
      args.timeoutMs,
    )
    if (!clicked?.found) {
      throw new Error(
        `Attachment button not found for ${args.attachmentText}. Available buttons: ${(clicked?.availableButtons ?? []).join(' | ')}`,
      )
    }

    const nativeDownloadWindow = await Promise.race([
      downloadStartPromise,
      sleep(Math.min(args.timeoutMs, NATIVE_DOWNLOAD_GRACE_MS)).then(() => ({
        kind: 'native-download-timeout',
      })),
    ])

    if (nativeDownloadWindow.kind === 'native-download') {
      const downloadStart = nativeDownloadWindow.event
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
      return
    }

    const fallbackSignal = await Promise.race([
      downloadStartPromise,
      estuaryResponsePromise,
      sleep(Math.min(args.timeoutMs, LATE_NATIVE_DOWNLOAD_GRACE_MS)).then(() => ({
        kind: 'late-native-timeout',
      })),
    ])

    if (fallbackSignal.kind === 'native-download') {
      const downloadStart = fallbackSignal.event
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
      return
    }

    const artifactSignal =
      fallbackSignal.kind === 'estuary-response'
        ? fallbackSignal
        : await estuaryResponsePromise
    if (artifactSignal.kind === 'native-download') {
      const downloadStart = artifactSignal.event
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
      return
    }

    const response = artifactSignal.event.params?.response ?? {}
    const fetchedArtifact = await fetchArtifactThroughPage(
      client,
      String(response.url ?? ''),
    )
    if (!fetchedArtifact?.ok) {
      throw new Error(
        `Attachment fetch failed for ${args.attachmentText} with status ${fetchedArtifact?.status ?? 'unknown'}.`,
      )
    }

    const filename =
      sanitizeDownloadFilename(
        parseContentDispositionFilename(
          fetchedArtifact.contentDisposition ??
            response.headers?.['content-disposition'] ??
            response.headers?.['Content-Disposition'],
        ) ??
        args.attachmentText,
        'downloaded-artifact',
      )
    const downloadedFile = path.join(path.resolve(args.outputDir), filename)
    await removeIfPresent(downloadedFile)
    await writeFile(
      downloadedFile,
      Buffer.from(fetchedArtifact.base64, 'base64'),
    )
    process.stdout.write(`${downloadedFile}\n`)
  } finally {
    client.close()
  }
}

await main()
