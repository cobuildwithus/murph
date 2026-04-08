import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'
import {
  captureAssistantInkThemeBaseline,
  DARK_ASSISTANT_INK_THEME,
  LIGHT_ASSISTANT_INK_THEME,
  resolveAssistantInkTheme,
} from '../src/assistant/ui/theme.js'

const spawnSyncMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}))

function resolveDarwinTheme() {
  return resolveAssistantInkTheme({
    env: {},
    platform: 'darwin',
  })
}

function captureDarwinThemeBaseline() {
  return captureAssistantInkThemeBaseline({
    env: {},
    platform: 'darwin',
  })
}

beforeEach(() => {
  spawnSyncMock.mockReset()
})

test('theme helpers read Apple interface style from defaults output and treat status 1 as light mode', () => {
  spawnSyncMock.mockReturnValueOnce({
    status: 0,
    stdout: 'Dark\n',
  })

  assert.deepEqual(resolveDarwinTheme(), DARK_ASSISTANT_INK_THEME)

  spawnSyncMock.mockReturnValueOnce({
    status: 1,
    stdout: '',
  })

  assert.deepEqual(captureDarwinThemeBaseline(), {
    initialAppleInterfaceStyle: '',
    initialColorFgbg: undefined,
    theme: LIGHT_ASSISTANT_INK_THEME,
  })
})

test('theme helpers tolerate defaults read failures when inferring the Apple interface style', () => {
  spawnSyncMock.mockImplementationOnce(() => {
    throw new Error('defaults unavailable')
  })

  assert.deepEqual(resolveDarwinTheme(), LIGHT_ASSISTANT_INK_THEME)
})
