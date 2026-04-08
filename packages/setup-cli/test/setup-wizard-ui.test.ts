import assert from 'node:assert/strict'
import * as React from 'react'
import { Box, Text } from 'ink'
import { test } from 'vitest'

import {
  createSetupWizardAnsweredBlock,
  createSetupWizardBulletRow,
  createSetupWizardHintRow,
  createSetupWizardKeyValueRow,
  createSetupWizardPanel,
  createSetupWizardPublicUrlTargetRow,
  createSetupWizardSelectionRow,
  resolveSetupWizardToneColor,
} from '../src/setup-wizard-ui.ts'
import { collectElementText } from './helpers.ts'

function getChildren(element: React.ReactElement): React.ReactNode[] {
  return React.Children.toArray(
    (element.props as { children?: React.ReactNode }).children,
  )
}

test('setup wizard tone colors stay mapped to the intended Ink palette', () => {
  assert.equal(resolveSetupWizardToneColor('accent'), 'cyan')
  assert.equal(resolveSetupWizardToneColor('success'), 'green')
  assert.equal(resolveSetupWizardToneColor('warn'), 'yellow')
  assert.equal(resolveSetupWizardToneColor('danger'), 'red')
  assert.equal(resolveSetupWizardToneColor('muted'), 'gray')
})

test('setup wizard panel and selection rows build structured Ink elements without snapshots', () => {
  const panel = createSetupWizardPanel({
    children: [React.createElement(Text, { key: 'child' }, 'Body')],
    title: 'Review',
    tone: 'warn',
  })
  const panelChildren = getChildren(panel)
  const panelProps = panel.props as {
    borderColor?: string
    borderStyle?: string
  }

  assert.equal(panel.type, Box)
  assert.equal(panelProps.borderColor, 'yellow')
  assert.equal(panelProps.borderStyle, 'round')
  assert.equal(collectElementText(panelChildren[0]), 'Review')
  assert.equal(collectElementText(panelChildren[1]), '')
  assert.equal(collectElementText(panelChildren[2]), 'Body')

  const checkboxRow = createSetupWizardSelectionRow(
    {
      line: {
        active: true,
        badges: [
          { label: 'ready', tone: 'success' },
          { label: 'local', tone: 'muted' },
        ],
        description: 'Reply through a Telegram bot.',
        detail: 'Needs TELEGRAM_BOT_TOKEN before this can connect.',
        key: 'telegram',
        selected: true,
        title: 'Telegram',
      },
      marker: 'checkbox',
    },
    'telegram-row',
  )
  assert.equal(collectElementText(checkboxRow), [
    '› ',
    '■ ',
    'Telegram',
    '[ready]',
    ' ',
    '[local]',
    '  Reply through a Telegram bot.',
    '  Needs TELEGRAM_BOT_TOKEN before this can connect.',
  ].join(''))

  const radioRow = createSetupWizardSelectionRow(
    {
      line: {
        active: false,
        badges: [],
        description: 'Use the default local Codex path.',
        key: 'codex',
        selected: false,
        title: 'Codex',
      },
      marker: 'radio',
    },
    'codex-row',
  )
  assert.equal(collectElementText(radioRow), '  ○ Codex  Use the default local Codex path.')
})

test('setup wizard answered, detail, and hint rows render the expected labels and values', () => {
  const answered = createSetupWizardAnsweredBlock(
    {
      detail: 'OpenAI-compatible endpoint',
      label: 'Assistant',
      value: 'OpenRouter',
    },
    'answered',
  )
  assert.equal(
    collectElementText(answered),
    '◇ Assistant  OpenRouter  OpenAI-compatible endpoint',
  )

  const bullet = createSetupWizardBulletRow(
    {
      body: 'Hosted web is the easiest stable base.',
      label: 'Public links',
      tone: 'accent',
    },
    'bullet',
  )
  assert.equal(
    collectElementText(bullet),
    '• Public links: Hosted web is the easiest stable base.',
  )

  const keyValue = createSetupWizardKeyValueRow(
    {
      label: 'Assistant',
      value: 'Codex',
    },
    'key-value',
  )
  assert.equal(collectElementText(keyValue), 'Assistant: Codex')

  const publicUrl = createSetupWizardPublicUrlTargetRow({
    detail: 'Point your tunnel here.',
    label: 'Linq webhook',
    url: 'http://127.0.0.1:8789/linq-webhook',
  })
  assert.equal(
    collectElementText(publicUrl),
    'Linq webhook: http://127.0.0.1:8789/linq-webhook  Point your tunnel here.',
  )

  const hintRow = createSetupWizardHintRow([
    { label: 'Enter next', tone: 'success' },
    { label: 'Esc back', tone: 'muted' },
    { label: 'q quit', tone: 'muted' },
  ])
  assert.equal(collectElementText(hintRow), '[Enter next] [Esc back] [q quit]')
})

test('setup wizard UI omits optional rows cleanly and keeps selected inactive rows highlighted', () => {
  const panel = createSetupWizardPanel({
    children: [],
    title: 'Empty review',
    tone: 'accent',
  })
  const panelChildren = getChildren(panel)

  assert.equal(panelChildren.length, 1)
  assert.equal(collectElementText(panelChildren[0]), 'Empty review')

  const selectedRow = createSetupWizardSelectionRow(
    {
      line: {
        active: false,
        badges: [],
        description: 'Use the saved OpenAI-compatible endpoint.',
        key: 'endpoint',
        selected: true,
        title: 'Saved endpoint',
      },
      marker: 'radio',
    },
    'selected-row',
  )
  assert.equal(
    collectElementText(selectedRow),
    '  ● Saved endpoint  Use the saved OpenAI-compatible endpoint.',
  )

  const answered = createSetupWizardAnsweredBlock(
    {
      label: 'Public links',
      value: 'Local tunnel',
    },
    'answered-without-detail',
  )
  assert.equal(collectElementText(answered), '◇ Public links  Local tunnel')
})
