export const DEFAULT_BROWSER_ENDPOINT = 'http://127.0.0.1:9222'
const TARGET_READY_TIMEOUT_MS = 30_000
const TARGET_READY_POLL_MS = 750
const PATCH_BUTTON_TEXT_PATTERN = /\b(?:patch|diff)\b/i

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`)
  }
  return response.json()
}

export class CdpClient {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.eventListeners = new Set()
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) {
          return
        }
        this.pending.delete(message.id)
        if (message.error) {
          pending.reject(new Error(JSON.stringify(message.error)))
          return
        }
        pending.resolve(message.result)
        return
      }

      for (const listener of this.eventListeners) {
        listener(message)
      }
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

  waitForEvent(predicate, timeoutMs = TARGET_READY_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.eventListeners.delete(handleEvent)
        reject(new Error(`Timed out waiting for matching CDP event after ${timeoutMs}ms`))
      }, timeoutMs)

      const handleEvent = (event) => {
        if (!predicate(event)) {
          return
        }
        clearTimeout(timeoutId)
        this.eventListeners.delete(handleEvent)
        resolve(event)
      }

      this.eventListeners.add(handleEvent)
    })
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

export async function ensureTarget(browserEndpoint, chatUrl) {
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

export async function waitForTargetContent(client, chatUrl) {
  const startedAt = Date.now()
  for (;;) {
    const state = await client.evaluate(`(() => ({
      href: location.href,
      readyState: document.readyState,
      title: document.title,
      bodyLength: document.body?.innerText?.length ?? 0,
      mainLength: document.querySelector('main')?.innerText?.length ?? 0,
      articleCount: document.querySelectorAll('main article').length,
      messageCount: document.querySelectorAll('main [data-message-author-role]').length,
      attachmentButtonCount: Array.from(document.querySelectorAll('main button, main a'))
        .filter((element) => /\\.(patch|diff|zip|txt|json|md|patched)\\b/i.test((element.innerText || element.getAttribute('aria-label') || '').trim()) || Boolean(element.getAttribute('download')))
        .length,
      patchButtonCount: Array.from(document.querySelectorAll('main button'))
        .filter((element) => element.classList?.contains('behavior-btn') && ${PATCH_BUTTON_TEXT_PATTERN}.test((element.innerText || element.getAttribute('aria-label') || '').trim()))
        .length,
    }))()`)
    if (
      state &&
      state.href === chatUrl &&
      state.readyState === 'complete' &&
      (
        state.mainLength > 500 ||
        state.articleCount > 0 ||
        state.messageCount > 0 ||
        state.attachmentButtonCount > 0 ||
        state.patchButtonCount > 0
      )
    ) {
      return state
    }
    if (Date.now() - startedAt > TARGET_READY_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for ChatGPT thread content for ${chatUrl}`)
    }
    await sleep(TARGET_READY_POLL_MS)
  }
}
