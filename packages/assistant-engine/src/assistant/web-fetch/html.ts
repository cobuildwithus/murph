import { Readability } from '@mozilla/readability'
import { DOMParser } from 'linkedom'

import { normalizeNullableString } from '../shared.js'
import { normalizeAssistantWebRequestUrl } from './config.js'
import type {
  AssistantWebFetchExtractMode,
  AssistantWebFetchResponse,
} from './config.js'

interface AssistantHtmlNodeLike {
  childNodes?: ArrayLike<AssistantHtmlNodeLike>
  getAttribute?(name: string): string | null
  nodeName: string
  nodeType: number
  textContent: string | null
}

interface AssistantHtmlRenderContext {
  baseUrl: URL | null
}

type AssistantHtmlDocument = ReturnType<
  InstanceType<typeof DOMParser>['parseFromString']
> extends infer T
  ? Extract<T, { body: unknown }>
  : never

const ASSISTANT_WEB_FETCH_TEXT_NODE = 3
const ASSISTANT_WEB_FETCH_ELEMENT_NODE = 1

export function extractAssistantWebHtml(input: {
  baseUrl?: URL | null
  extractMode: AssistantWebFetchExtractMode
  html: string
}): {
  extractor: AssistantWebFetchResponse['extractor']
  text: string
  title: string | null
  warnings: string[]
} {
  const document = parseAssistantHtmlDocument(input.html)
  const renderContext: AssistantHtmlRenderContext = {
    baseUrl: input.baseUrl ?? null,
  }
  const article = parseAssistantHtmlWithReadability(document)
  const warnings: string[] = []

  if (article) {
    const articleText = normalizeAssistantText(article.textContent ?? '')
    const markdownText = normalizeAssistantMarkdown(
      renderAssistantHtmlToMarkdown(
        parseAssistantHtmlFragment(normalizeNullableString(article.content) ?? ''),
        renderContext,
      ),
    )
    if (input.extractMode === 'markdown' && markdownText.length === 0 && articleText.length > 0) {
      warnings.push(
        'Readable article markdown conversion was empty; falling back to normalized article text.',
      )
    }

    return {
      extractor: 'readability',
      title:
        normalizeNullableString(article.title) ??
        resolveAssistantHtmlDocumentTitle(document),
      text:
        input.extractMode === 'markdown'
          ? (markdownText || articleText)
          : articleText,
      warnings,
    }
  }

  warnings.push(
    'Readable article extraction failed; falling back to a simpler HTML cleanup path.',
  )

  const fallbackText = normalizeAssistantText(document.body?.textContent ?? '')
  const fallbackMarkdown = normalizeAssistantMarkdown(
    renderAssistantHtmlToMarkdown(document, renderContext),
  )
  if (input.extractMode === 'markdown' && fallbackMarkdown.length === 0 && fallbackText.length > 0) {
    warnings.push(
      'Fallback HTML markdown conversion was empty; returning normalized page text instead.',
    )
  }

  return {
    extractor: 'raw-html',
    title: resolveAssistantHtmlDocumentTitle(document),
    text:
      input.extractMode === 'markdown'
        ? (fallbackMarkdown || fallbackText)
        : fallbackText,
    warnings,
  }
}

function parseAssistantHtmlDocument(
  html: string,
): AssistantHtmlDocument {
  const document = new DOMParser().parseFromString(
    html,
    'text/html',
  ) as AssistantHtmlDocument

  for (const element of document.querySelectorAll(
    'script, style, noscript, iframe, svg, canvas, form',
  )) {
    element.remove()
  }

  return document
}

function parseAssistantHtmlFragment(
  htmlFragment: string,
): AssistantHtmlDocument {
  return parseAssistantHtmlDocument(
    `<!doctype html><html><body>${htmlFragment}</body></html>`,
  )
}

function renderAssistantHtmlToMarkdown(
  document: AssistantHtmlDocument,
  context: AssistantHtmlRenderContext,
): string {
  return normalizeAssistantMarkdown(
    renderAssistantNodeToMarkdown(document.body, context),
  )
}

function renderAssistantNodeToMarkdown(
  node: AssistantHtmlNodeLike | null | undefined,
  context: AssistantHtmlRenderContext,
): string {
  if (!node) {
    return ''
  }

  if (node.nodeType === ASSISTANT_WEB_FETCH_TEXT_NODE) {
    return escapeAssistantMarkdownText(node.textContent ?? '')
  }

  if (node.nodeType !== ASSISTANT_WEB_FETCH_ELEMENT_NODE) {
    return ''
  }

  const tagName = node.nodeName.toLowerCase()
  const childText = renderAssistantChildrenToMarkdown(node, context)

  switch (tagName) {
    case 'body':
    case 'main':
    case 'article':
    case 'section':
    case 'header':
    case 'footer':
    case 'nav':
    case 'aside':
    case 'div':
      return `${childText}\n\n`
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Math.max(
        1,
        Math.min(Number(tagName.slice(1)) || 1, 6),
      )
      const heading = normalizeAssistantText(childText)
      return heading ? `${'#'.repeat(level)} ${heading}\n\n` : ''
    }
    case 'p':
      return childText.trim() ? `${childText.trim()}\n\n` : ''
    case 'br':
      return '\n'
    case 'hr':
      return '\n---\n\n'
    case 'ul':
    case 'ol':
      return `${renderAssistantListToMarkdown(node, tagName === 'ol', context)}\n`
    case 'li': {
      const text = normalizeAssistantMarkdownInline(childText)
      return text ? `${text}\n` : ''
    }
    case 'pre': {
      const code = normalizeTrailingWhitespace(node.textContent ?? '')
      return code ? `\n\`\`\`\n${code}\n\`\`\`\n\n` : ''
    }
    case 'code': {
      const text = normalizeAssistantText(node.textContent ?? '')
      return text ? `\`${text}\`` : ''
    }
    case 'a': {
      const text = normalizeAssistantMarkdownInline(childText)
      const href = resolveAssistantMarkdownHref(
        node.getAttribute?.('href') ?? null,
        context.baseUrl,
      )
      if (!text) {
        return ''
      }
      if (!href) {
        return text
      }
      return `[${text}](${href})`
    }
    case 'strong':
    case 'b': {
      const text = normalizeAssistantMarkdownInline(childText)
      return text ? `**${text}**` : ''
    }
    case 'em':
    case 'i': {
      const text = normalizeAssistantMarkdownInline(childText)
      return text ? `_${text}_` : ''
    }
    case 'blockquote': {
      const lines = normalizeAssistantText(childText)
        .split('\n')
        .filter((line) => line.length > 0)
      return lines.length > 0
        ? `${lines.map((line) => `> ${line}`).join('\n')}\n\n`
        : ''
    }
    case 'table':
      return `${normalizeAssistantText(childText)}\n\n`
    default:
      return childText
  }
}

function renderAssistantChildrenToMarkdown(
  node: AssistantHtmlNodeLike,
  context: AssistantHtmlRenderContext,
): string {
  if (!node.childNodes || node.childNodes.length === 0) {
    return ''
  }

  let markdown = ''
  for (const childNode of Array.from(node.childNodes)) {
    markdown += renderAssistantNodeToMarkdown(childNode, context)
  }

  return markdown
}

function renderAssistantListToMarkdown(
  node: AssistantHtmlNodeLike,
  ordered: boolean,
  context: AssistantHtmlRenderContext,
): string {
  if (!node.childNodes || node.childNodes.length === 0) {
    return ''
  }

  let markdown = ''
  let orderedListIndex = 1

  for (const childNode of Array.from(node.childNodes)) {
    if (childNode.nodeType !== ASSISTANT_WEB_FETCH_ELEMENT_NODE) {
      continue
    }

    if (childNode.nodeName.toLowerCase() !== 'li') {
      markdown += renderAssistantNodeToMarkdown(childNode, context)
      continue
    }

    const itemText = normalizeAssistantMarkdownInline(
      renderAssistantChildrenToMarkdown(childNode, context),
    )
    if (!itemText) {
      continue
    }

    markdown += ordered
      ? `${orderedListIndex}. ${itemText}\n`
      : `- ${itemText}\n`
    orderedListIndex += 1
  }

  return markdown
}

function normalizeAssistantText(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim()
}

function normalizeAssistantMarkdown(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function normalizeAssistantMarkdownInline(input: string): string {
  return normalizeAssistantText(input).replace(/\n+/gu, ' ')
}

function resolveAssistantMarkdownHref(
  href: string | null | undefined,
  baseUrl: URL | null,
): string | null {
  const normalized = normalizeNullableString(href)
  if (!normalized) {
    return null
  }

  try {
    const resolvedUrl = baseUrl
      ? new URL(normalized, baseUrl)
      : new URL(normalized)

    if (resolvedUrl.username || resolvedUrl.password) {
      return null
    }

    const protocol = resolvedUrl.protocol.toLowerCase()
    if (protocol !== 'http:' && protocol !== 'https:') {
      return null
    }

    return normalizeAssistantWebRequestUrl(resolvedUrl.toString()).toString()
  } catch {
    return null
  }
}

function parseAssistantHtmlWithReadability(
  document: AssistantHtmlDocument,
): ReturnType<Readability['parse']> {
  const ReadabilityConstructor = Readability as new (
    ...args: readonly unknown[]
  ) => {
    parse(): ReturnType<Readability['parse']>
  }

  return new ReadabilityConstructor(document).parse()
}

function resolveAssistantHtmlDocumentTitle(
  document: { title?: unknown },
): string | null {
  if (typeof document.title === 'string') {
    return normalizeNullableString(document.title)
  }

  if (
    document.title &&
    typeof document.title === 'object' &&
    'textContent' in document.title
  ) {
    const textContent = document.title.textContent
    return typeof textContent === 'string'
      ? normalizeNullableString(textContent)
      : null
  }

  return null
}

function normalizeTrailingWhitespace(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/\s+$/u, '')
}

function escapeAssistantMarkdownText(input: string): string {
  return input.replace(/([\\`*_{}\[\]()#+!|>~-])/gu, '\\$1')
}
