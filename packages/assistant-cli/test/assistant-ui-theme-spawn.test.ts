import assert from 'node:assert/strict'

import { beforeEach, test, vi } from 'vitest'

const spawnSyncMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawnSync: spawnSyncMock,
}))

const {
  captureAssistantInkThemeBaseline,
  DARK_ASSISTANT_INK_THEME,
  LIGHT_ASSISTANT_INK_THEME,
  resolveAssistantInkTheme,
} = await import('../src/assistant/ui/theme.js')

beforeEach(() => {
  spawnSyncMock.mockReset()
})

test('theme helpers read Apple interface style from defaults output and treat status 1 as light mode', () => {
  spawnSyncMock.mockReturnValueOnce({
    status: 0,
    stdout: 'Dark\n',
  })

  assert.deepEqual(
    resolveAssistantInkTheme({
      env: {},
      platform: 'darwin',
    }),
    DARK_ASSISTANT_INK_THEME,
  )

  spawnSyncMock.mockReturnValueOnce({
    status: 1,
    stdout: '',
  })

  assert.deepEqual(
    captureAssistantInkThemeBaseline({
      env: {},
      platform: 'darwin',
    }),
    {
      initialAppleInterfaceStyle: '',
      initialColorFgbg: undefined,
      theme: LIGHT_ASSISTANT_INK_THEME,
    },
  )
})

test('theme helpers tolerate defaults read failures when inferring the Apple interface style', () => {
  spawnSyncMock.mockImplementationOnce(() => {
    throw new Error('defaults unavailable')
  })

  assert.deepEqual(
    resolveAssistantInkTheme({
      env: {},
      platform: 'darwin',
    }),
    LIGHT_ASSISTANT_INK_THEME,
  )
})
