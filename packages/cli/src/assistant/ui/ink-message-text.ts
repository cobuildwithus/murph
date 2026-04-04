import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as React from 'react'
import { Box, Text, useStdout } from 'ink'

import { normalizeNullableString } from '@murphai/assistant-core/assistant-runtime'

import type { InkChatEntry } from './view-model.js'
import {
  WrappedTextBlock,
  resolveAssistantPlainTextWrapColumns,
  useAssistantInkTheme,
  wrapAssistantPlainText,
} from './ink-layout.js'

interface AssistantMessageTextProps {
  text: string
}

export function resolveMessageRoleLabel(
  kind: InkChatEntry['kind'],
): string | null {
  if (kind === 'error') {
    return 'error'
  }

  return null
}

export const MessageRoleLabel = React.memo(function MessageRoleLabel(input: {
  kind: InkChatEntry['kind']
}): React.ReactElement | null {
  const theme = useAssistantInkTheme()
  const label = resolveMessageRoleLabel(input.kind)
  if (!label) {
    return null
  }

  return React.createElement(
    Box,
    {
      marginBottom: 1,
    },
    React.createElement(
      Text,
      {
        bold: true,
        color: theme.errorColor,
      },
      label,
    ),
  )
})

export function splitAssistantMarkdownLinks(input: string): Array<
  | {
      kind: 'link'
      label: string
      target: string
    }
  | {
      kind: 'text'
      text: string
    }
> {
  const segments: Array<
    | {
        kind: 'link'
        label: string
        target: string
      }
    | {
        kind: 'text'
        text: string
      }
  > = []
  const markdownLinkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/gu
  let lastIndex = 0

  for (const match of input.matchAll(markdownLinkPattern)) {
    const matchedText = match[0]
    const label = match[1]
    const target = match[2]
    const start = match.index ?? -1

    if (
      typeof matchedText !== 'string' ||
      typeof label !== 'string' ||
      typeof target !== 'string' ||
      start < 0
    ) {
      continue
    }

    if (start > lastIndex) {
      segments.push({
        kind: 'text',
        text: input.slice(lastIndex, start),
      })
    }

    segments.push({
      kind: 'link',
      label,
      target,
    })
    lastIndex = start + matchedText.length
  }

  if (lastIndex < input.length) {
    segments.push({
      kind: 'text',
      text: input.slice(lastIndex),
    })
  }

  return segments.length > 0
    ? segments
    : [
        {
          kind: 'text',
          text: input,
        },
      ]
}

export function resolveAssistantHyperlinkTarget(target: string): string | null {
  if (/^(https?|mailto):/iu.test(target)) {
    return target
  }

  const fragmentIndex = target.indexOf('#')
  const pathPart =
    fragmentIndex >= 0
      ? target.slice(0, fragmentIndex)
      : target
  const fragment =
    fragmentIndex >= 0
      ? target.slice(fragmentIndex)
      : ''

  if (!path.isAbsolute(pathPart)) {
    return null
  }

  return `${pathToFileURL(pathPart).href}${fragment}`
}

export function formatAssistantTerminalHyperlink(
  label: string,
  target: string,
): string {
  return `\u001B]8;;${target}\u0007${label}\u001B]8;;\u0007`
}

export function supportsAssistantTerminalHyperlinks(input: {
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
} = {}): boolean {
  const env = input.env ?? process.env
  const isTTY = input.isTTY ?? process.stderr.isTTY ?? false

  if (!isTTY || env.CI === 'true') {
    return false
  }

  if (env.FORCE_HYPERLINK === '1') {
    return true
  }

  return Boolean(
    env.KITTY_WINDOW_ID ||
      env.ITERM_SESSION_ID ||
      env.WT_SESSION ||
      env.WEZTERM_PANE ||
      env.VSCODE_INJECTION ||
      env.TERM_PROGRAM === 'Apple_Terminal' ||
      env.TERM_PROGRAM === 'WarpTerminal' ||
      env.TERM_PROGRAM === 'vscode',
  )
}

export function renderAssistantMessageText(
  input: AssistantMessageTextProps,
): React.ReactElement {
  const theme = useAssistantInkTheme()
  const { stdout } = useStdout()
  const enableHyperlinks = supportsAssistantTerminalHyperlinks()
  const segments = splitAssistantMarkdownLinks(input.text)
  const plainTextOnly = segments.every((segment) => segment.kind === 'text')

  if (plainTextOnly) {
    return React.createElement(
      WrappedTextBlock,
      {},
      wrapAssistantPlainText(
        normalizeNullableString(input.text) ?? '',
        resolveAssistantPlainTextWrapColumns(stdout?.columns),
      ),
    )
  }

  return React.createElement(
    WrappedTextBlock,
    {},
    ...segments.map((segment, index) => {
      if (segment.kind === 'text') {
        return segment.text
      }

      const hyperlinkTarget = resolveAssistantHyperlinkTarget(segment.target)
      const displayedLabel =
        hyperlinkTarget && enableHyperlinks
          ? formatAssistantTerminalHyperlink(segment.label, hyperlinkTarget)
          : segment.label

      return React.createElement(
        Text,
        {
          color: theme.accentColor,
          key: `link:${index}:${segment.label}`,
          underline: true,
        },
        displayedLabel,
      )
    }),
  )
}

export const AssistantMessageText = React.memo(function AssistantMessageText(
  props: AssistantMessageTextProps,
): React.ReactElement {
  return renderAssistantMessageText(props)
})
