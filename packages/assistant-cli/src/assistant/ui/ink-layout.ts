import * as React from 'react'
import { Box, Text, type BoxProps } from 'ink'

import type { ChatMetadataBadge } from './view-model.js'
import { LIGHT_ASSISTANT_INK_THEME, type AssistantInkTheme } from './theme.js'

export const AssistantInkThemeContext =
  React.createContext<AssistantInkTheme>(LIGHT_ASSISTANT_INK_THEME)

export const ASSISTANT_CHAT_VIEW_PADDING_X = 1
const ASSISTANT_PLAIN_TEXT_WRAP_SLACK = 1
const BUSY_INDICATOR_CHARACTER = '•'

export function useAssistantInkTheme(): AssistantInkTheme {
  return React.useContext(AssistantInkThemeContext)
}

export interface ChromePanelProps {
  backgroundColor?: string
  children?: React.ReactNode
  marginBottom?: number
  paddingX?: number
  paddingY?: number
  width?: number | string
}

export function resolveChromePanelBoxProps(
  props: ChromePanelProps,
): BoxProps & {
  backgroundColor?: string
  flexDirection: 'column'
  marginBottom: number
  paddingX: number
  paddingY: number
  width: number | string
} {
  const boxProps: BoxProps & {
    backgroundColor?: string
    flexDirection: 'column'
    marginBottom: number
    paddingX: number
    paddingY: number
    width: number | string
  } = {
    flexDirection: 'column',
    marginBottom: props.marginBottom ?? 1,
    paddingX:
      props.paddingX ??
      (typeof props.backgroundColor === 'string' && props.backgroundColor.length > 0
        ? 1
        : 0),
    paddingY: props.paddingY ?? 0,
    width: props.width ?? '100%',
  }

  if (typeof props.backgroundColor === 'string' && props.backgroundColor.length > 0) {
    boxProps.backgroundColor = props.backgroundColor
  }

  return boxProps
}

export const ChromePanel = React.memo(function ChromePanel(
  props: ChromePanelProps,
): React.ReactElement {
  return React.createElement(Box, resolveChromePanelBoxProps(props), props.children)
})

export const BusySpinner = React.memo(function BusySpinner(input: {
  color?: string
}): React.ReactElement {
  const theme = useAssistantInkTheme()

  return React.createElement(
    Text,
    {
      color: input.color ?? theme.accentColor,
    },
    BUSY_INDICATOR_CHARACTER,
  )
})

export function renderWrappedTextBlock(input: {
  children?: React.ReactNode
  color?: string
  dimColor?: boolean
}): React.ReactElement {
  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: '100%',
    },
    React.createElement(
      Text,
      {
        color: input.color,
        dimColor: input.dimColor,
        wrap: 'wrap',
      },
      input.children,
    ),
  )
}

export function wrapAssistantPlainText(input: string, columns: number): string {
  return input
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => wrapAssistantPlainTextLine(line, columns))
    .join('\n')
}

function wrapAssistantPlainTextLine(input: string, columns: number): string {
  if (input.length === 0 || columns <= 0) {
    return input
  }

  const leadingWhitespace = input.match(/^\s*/u)?.[0] ?? ''
  const content = input.slice(leadingWhitespace.length)

  if (content.length === 0) {
    return input
  }

  const tokens = content.match(/\S+|\s+/gu) ?? [content]
  const lines: string[] = []
  let currentLine = leadingWhitespace
  let currentWidth = leadingWhitespace.length
  let pendingWhitespace = ''

  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      pendingWhitespace += token
      continue
    }

    const spacer =
      currentWidth > leadingWhitespace.length
        ? pendingWhitespace.length > 0
          ? pendingWhitespace
          : ' '
        : ''
    const candidateWidth = currentWidth + spacer.length + token.length

    if (currentWidth > leadingWhitespace.length && candidateWidth > columns) {
      lines.push(currentLine)
      currentLine = `${leadingWhitespace}${token}`
      currentWidth = leadingWhitespace.length + token.length
      pendingWhitespace = ''
      continue
    }

    if (spacer.length > 0) {
      currentLine += spacer
      currentWidth += spacer.length
    }

    currentLine += token
    currentWidth += token.length
    pendingWhitespace = ''
  }

  lines.push(currentLine)

  return lines.join('\n')
}

function resolveAssistantTerminalColumns(columns: number | null | undefined): number {
  return typeof columns === 'number' && Number.isFinite(columns)
    ? Math.max(1, Math.floor(columns))
    : 80
}

export function resolveAssistantChatViewportWidth(
  columns: number | null | undefined,
): number {
  return Math.max(
    1,
    resolveAssistantTerminalColumns(columns) - ASSISTANT_CHAT_VIEW_PADDING_X * 2,
  )
}

export function resolveAssistantPlainTextWrapColumns(
  columns: number | null | undefined,
): number {
  return Math.max(
    1,
    resolveAssistantChatViewportWidth(columns) - ASSISTANT_PLAIN_TEXT_WRAP_SLACK,
  )
}

export const WrappedTextBlock = React.memo(function WrappedTextBlock(input: {
  children?: React.ReactNode
  color?: string
  dimColor?: boolean
}): React.ReactElement {
  return renderWrappedTextBlock(input)
})

export function renderWrappedPlainTextBlock(input: {
  columns: number
  color?: string
  dimColor?: boolean
  text: string
}): React.ReactElement {
  const lines = wrapAssistantPlainText(input.text, input.columns).split('\n')

  return React.createElement(
    Box,
    {
      flexDirection: 'column',
      width: '100%',
    },
    ...lines.map((line, index) =>
      React.createElement(
        Text,
        {
          color: input.color,
          dimColor: input.dimColor,
          key: `wrapped-plain-text:${index}`,
        },
        line.length > 0 ? line : ' ',
      ),
    ),
  )
}

export const WrappedPlainTextBlock = React.memo(function WrappedPlainTextBlock(input: {
  columns: number
  color?: string
  dimColor?: boolean
  text: string
}): React.ReactElement {
  return renderWrappedPlainTextBlock(input)
})

export function formatFooterBadgeText(badge: ChatMetadataBadge): string {
  if (badge.key === 'model' || badge.key === 'reasoning') {
    return ` ${badge.value} `
  }

  return ` ${badge.label}: ${badge.value} `
}

export const FooterBadge = React.memo(function FooterBadge(input: {
  badge: ChatMetadataBadge
}): React.ReactElement {
  const theme = useAssistantInkTheme()
  const backgroundColor =
    input.badge.key === 'model' ? theme.accentColor : theme.footerBadgeBackground
  const color =
    input.badge.key === 'model'
      ? theme.composerCursorTextColor
      : input.badge.key === 'vault'
        ? theme.mutedColor
        : theme.footerBadgeTextColor

  return React.createElement(
    Text,
    {
      backgroundColor,
      color,
    },
    formatFooterBadgeText(input.badge),
  )
})
