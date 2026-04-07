import * as React from 'react'
import { Box, Text } from 'ink'

export type SetupWizardTone = 'accent' | 'success' | 'warn' | 'danger' | 'muted'

export interface SetupWizardInlineBadge {
  label: string
  tone: SetupWizardTone
}

export interface SetupWizardHint {
  label: string
  tone: SetupWizardTone
}

export interface SetupWizardSelectionLine {
  active: boolean
  badges: readonly SetupWizardInlineBadge[]
  description: string
  detail?: string
  key: string
  selected: boolean
  title: string
}

export interface SetupWizardPublicUrlTarget {
  detail: string
  label: string
  url: string
}

export function resolveSetupWizardToneColor(tone: SetupWizardTone): string {
  switch (tone) {
    case 'accent':
      return 'cyan'
    case 'success':
      return 'green'
    case 'warn':
      return 'yellow'
    case 'danger':
      return 'red'
    case 'muted':
      return 'gray'
  }
}

export function createSetupWizardPanel(input: {
  children: readonly React.ReactNode[]
  title: string
  tone: SetupWizardTone
}): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      borderColor: resolveSetupWizardToneColor(input.tone),
      borderStyle: 'round',
      flexDirection: 'column',
      paddingX: 1,
      paddingY: 0,
    },
    createElement(
      Text,
      { color: resolveSetupWizardToneColor(input.tone), bold: true },
      input.title,
    ),
    input.children.length > 0 ? createElement(Text, null, '') : null,
    ...input.children,
  )
}

export function createSetupWizardSelectionRow(
  input: {
    line: SetupWizardSelectionLine
    marker: 'checkbox' | 'radio'
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement
  const markerSymbol =
    input.marker === 'checkbox'
      ? input.line.selected
        ? '■'
        : '□'
      : input.line.selected
        ? '●'
        : '○'
  const markerTone: SetupWizardTone = input.line.active
    ? 'accent'
    : input.line.selected
      ? 'success'
      : 'muted'
  const titleColor = input.line.active
    ? resolveSetupWizardToneColor('accent')
    : input.line.selected
      ? resolveSetupWizardToneColor('success')
      : undefined

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Box,
      { flexDirection: 'row' },
      createElement(
        Text,
        {
          color: input.line.active
            ? resolveSetupWizardToneColor('accent')
            : resolveSetupWizardToneColor('muted'),
          bold: input.line.active,
        },
        `${input.line.active ? '›' : ' '} `,
      ),
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor(markerTone),
          bold: true,
        },
        `${markerSymbol} `,
      ),
      createElement(
        Text,
        {
          color: titleColor,
          bold: true,
        },
        input.line.title,
      ),
      input.line.badges.length > 0
        ? createElement(
            Box,
            {
              flexDirection: 'row',
              marginLeft: 1,
            },
            createElement(
              Text,
              null,
              ...createSetupWizardInlineBadgeElements(input.line.badges, key),
            ),
          )
        : null,
    ),
    createElement(
      Text,
      { color: resolveSetupWizardToneColor('muted') },
      `  ${input.line.description}`,
    ),
    input.line.detail
      ? createElement(
          Text,
          {
            color: resolveSetupWizardToneColor('muted'),
            dimColor: true,
          },
          `  ${input.line.detail}`,
        )
      : null,
  )
}

export function createSetupWizardAnsweredBlock(
  input: {
    detail?: string
    label: string
    value: string
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Text,
      { color: resolveSetupWizardToneColor('accent'), bold: true },
      `◇ ${input.label}`,
    ),
    createElement(
      Text,
      { bold: true },
      `  ${input.value}`,
    ),
    input.detail
      ? createElement(
          Text,
          {
            color: resolveSetupWizardToneColor('muted'),
            dimColor: true,
          },
          `  ${input.detail}`,
        )
      : null,
  )
}

export function createSetupWizardBulletRow(
  input: {
    body: string
    label: string
    tone: SetupWizardTone
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Text,
      null,
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor(input.tone),
          bold: true,
        },
        `• ${input.label}: `,
      ),
      input.body,
    ),
  )
}

export function createSetupWizardKeyValueRow(
  input: {
    label: string
    value: string
  },
  key: string,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key,
      marginBottom: 1,
    },
    createElement(
      Text,
      null,
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor('muted'),
          bold: true,
        },
        `${input.label}: `,
      ),
      input.value,
    ),
  )
}

export function createSetupWizardPublicUrlTargetRow(
  target: SetupWizardPublicUrlTarget,
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Box,
    {
      flexDirection: 'column',
      key: target.label,
      marginBottom: 1,
    },
    createElement(
      Text,
      null,
      createElement(
        Text,
        {
          color: resolveSetupWizardToneColor('muted'),
          bold: true,
        },
        `${target.label}: `,
      ),
      createElement(
        Text,
        { color: resolveSetupWizardToneColor('accent') },
        target.url,
      ),
    ),
    createElement(
      Text,
      {
        color: resolveSetupWizardToneColor('muted'),
        dimColor: true,
      },
      `  ${target.detail}`,
    ),
  )
}

export function createSetupWizardHintRow(
  hints: readonly SetupWizardHint[],
): React.ReactElement {
  const createElement = React.createElement

  return createElement(
    Text,
    null,
    ...createSetupWizardInlineBadgeElements(hints, 'hint'),
  )
}

function createSetupWizardInlineBadgeElements(
  badges: readonly SetupWizardInlineBadge[],
  keyPrefix: string,
): React.ReactElement[] {
  const createElement = React.createElement
  const elements: React.ReactElement[] = []

  for (const [index, badge] of badges.entries()) {
    if (index > 0) {
      elements.push(createElement(Text, { key: `${keyPrefix}:space:${index}` }, ' '))
    }

    elements.push(
      createElement(
        Text,
        {
          bold: true,
          color: resolveSetupWizardToneColor(badge.tone),
          key: `${keyPrefix}:badge:${badge.label}:${index}`,
        },
        `[${badge.label}]`,
      ),
    )
  }

  return elements
}
