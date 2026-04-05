import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  captureAssistantInkThemeBaseline,
  DARK_ASSISTANT_INK_THEME,
  LIGHT_ASSISTANT_INK_THEME,
  inferAssistantInkThemeModeFromAppleInterfaceStyle,
  inferAssistantInkThemeModeFromColorFgbg,
  resolveAssistantInkThemeForOpenChat,
  resolveAssistantInkTheme,
  resolveAssistantInkThemeMode,
  resolveAssistantInkThemeModeForOpenChat,
} from '@murphai/assistant-cli/assistant/ui/theme'

test('assistant Ink theme infers dark and light terminal backgrounds from COLORFGBG', () => {
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('15;0'), 'dark')
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('0;15'), 'light')
  assert.equal(inferAssistantInkThemeModeFromColorFgbg(undefined), null)
  assert.equal(inferAssistantInkThemeModeFromColorFgbg('bogus'), null)
})

test('assistant Ink theme infers macOS appearance strings', () => {
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle('Dark'), 'dark')
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle('light'), 'light')
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle(''), 'light')
  assert.equal(inferAssistantInkThemeModeFromAppleInterfaceStyle('System'), null)
})

test('assistant Ink theme prefers terminal background hints over system appearance', () => {
  assert.equal(
    resolveAssistantInkThemeMode({
      appleInterfaceStyle: 'light',
      colorFgbg: '15;0',
      platform: 'darwin',
    }),
    'dark',
  )
})

test('assistant Ink theme falls back to macOS appearance when terminal hints are absent', () => {
  assert.equal(
    resolveAssistantInkThemeMode({
      appleInterfaceStyle: 'Dark',
      colorFgbg: undefined,
      platform: 'darwin',
    }),
    'dark',
  )
  assert.equal(
    resolveAssistantInkThemeMode({
      appleInterfaceStyle: '',
      colorFgbg: undefined,
      platform: 'darwin',
    }),
    'light',
  )
})

test('assistant Ink theme returns the matching palette object', () => {
  assert.deepEqual(
    resolveAssistantInkTheme({
      env: {},
      platform: 'darwin',
      readAppleInterfaceStyle: () => 'Dark',
    }),
    DARK_ASSISTANT_INK_THEME,
  )
  assert.deepEqual(
    resolveAssistantInkTheme({
      env: {},
      platform: 'linux',
    }),
    LIGHT_ASSISTANT_INK_THEME,
  )
})

test('assistant Ink open-chat theme follows macOS appearance after launch when the system mode flips', () => {
  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'light',
      currentAppleInterfaceStyle: 'Dark',
      initialAppleInterfaceStyle: '',
      initialColorFgbg: '0;15',
      platform: 'darwin',
    }),
    'dark',
  )
  assert.deepEqual(
    resolveAssistantInkThemeForOpenChat({
      currentMode: 'light',
      initialAppleInterfaceStyle: '',
      initialColorFgbg: '0;15',
      platform: 'darwin',
      readAppleInterfaceStyle: () => 'Dark',
    }),
    DARK_ASSISTANT_INK_THEME,
  )
})

test('assistant Ink open-chat theme returns to the launch terminal hint when macOS appearance returns to its launch mode', () => {
  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'dark',
      currentAppleInterfaceStyle: '',
      initialAppleInterfaceStyle: '',
      initialColorFgbg: '0;15',
      platform: 'darwin',
    }),
    'light',
  )
})

test('assistant Ink open-chat theme preserves a manual terminal hint when macOS appearance has not changed', () => {
  assert.equal(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: 'dark',
      currentAppleInterfaceStyle: '',
      initialAppleInterfaceStyle: '',
      initialColorFgbg: '15;0',
      platform: 'darwin',
    }),
    'dark',
  )
})

test('assistant Ink theme baseline captures the launch appearance snapshot once', () => {
  assert.deepEqual(
    captureAssistantInkThemeBaseline({
      env: {
        COLORFGBG: '0;15',
      },
      platform: 'darwin',
      readAppleInterfaceStyle: () => '',
    }),
    {
      initialAppleInterfaceStyle: '',
      initialColorFgbg: '0;15',
      theme: LIGHT_ASSISTANT_INK_THEME,
    },
  )
})
