import { spawnSync } from 'node:child_process'

export type AssistantInkThemeMode = 'dark' | 'light'

export interface AssistantInkTheme {
  accentColor: string
  composerBackground: string
  composerCursorBackground: string
  composerCursorTextColor: string
  composerPlaceholderColor: string
  composerTextColor: string
  errorColor: string
  mode: AssistantInkThemeMode
  successColor: string
  switcherBackground: string
  switcherMutedColor: string
  switcherTextColor: string
}

export interface ResolveAssistantInkThemeInput {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  readAppleInterfaceStyle?: () => string | null
}

export const LIGHT_ASSISTANT_INK_THEME: AssistantInkTheme = {
  mode: 'light',
  accentColor: '#0f766e',
  composerBackground: '#f3f4f6',
  composerCursorBackground: '#1d4ed8',
  composerCursorTextColor: '#ffffff',
  composerPlaceholderColor: '#6b7280',
  composerTextColor: '#111827',
  errorColor: '#dc2626',
  successColor: '#16a34a',
  switcherBackground: '#f8fafc',
  switcherMutedColor: '#6b7280',
  switcherTextColor: '#111827',
}

export const DARK_ASSISTANT_INK_THEME: AssistantInkTheme = {
  mode: 'dark',
  accentColor: '#2dd4bf',
  composerBackground: '#1f2937',
  composerCursorBackground: '#60a5fa',
  composerCursorTextColor: '#0f172a',
  composerPlaceholderColor: '#94a3b8',
  composerTextColor: '#e5e7eb',
  errorColor: '#f87171',
  successColor: '#4ade80',
  switcherBackground: '#111827',
  switcherMutedColor: '#94a3b8',
  switcherTextColor: '#e5e7eb',
}

export function inferAssistantInkThemeModeFromColorFgbg(
  colorFgbg: string | null | undefined,
): AssistantInkThemeMode | null {
  if (typeof colorFgbg !== 'string') {
    return null
  }

  const rawParts = colorFgbg
    .split(';')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((part) => Number.isInteger(part))

  const background = rawParts.at(-1)
  if (typeof background !== 'number') {
    return null
  }

  return background === 7 || background === 15 ? 'light' : 'dark'
}

export function inferAssistantInkThemeModeFromAppleInterfaceStyle(
  appleInterfaceStyle: string | null | undefined,
): AssistantInkThemeMode | null {
  if (appleInterfaceStyle === '') {
    return 'light'
  }

  if (typeof appleInterfaceStyle !== 'string') {
    return null
  }

  const normalized = appleInterfaceStyle.trim().toLowerCase()
  if (normalized === 'dark') {
    return 'dark'
  }

  if (normalized === 'light') {
    return 'light'
  }

  return null
}

export function resolveAssistantInkThemeMode(input: {
  appleInterfaceStyle: string | null
  colorFgbg: string | null | undefined
  platform: NodeJS.Platform
}): AssistantInkThemeMode {
  const colorFgbgMode = inferAssistantInkThemeModeFromColorFgbg(input.colorFgbg)
  if (colorFgbgMode) {
    return colorFgbgMode
  }

  if (input.platform === 'darwin') {
    return (
      inferAssistantInkThemeModeFromAppleInterfaceStyle(input.appleInterfaceStyle) ??
      'light'
    )
  }

  return 'light'
}

export function resolveAssistantInkTheme(
  input: ResolveAssistantInkThemeInput = {},
): AssistantInkTheme {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const appleInterfaceStyle =
    platform === 'darwin'
      ? (input.readAppleInterfaceStyle ?? readAppleInterfaceStyle)()
      : null

  const mode = resolveAssistantInkThemeMode({
    appleInterfaceStyle,
    colorFgbg: env.COLORFGBG,
    platform,
  })

  return mode === 'dark'
    ? DARK_ASSISTANT_INK_THEME
    : LIGHT_ASSISTANT_INK_THEME
}

function readAppleInterfaceStyle(): string | null {
  try {
    const result = spawnSync('defaults', ['read', '-g', 'AppleInterfaceStyle'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 250,
    })

    if (typeof result.stdout === 'string') {
      const output = result.stdout.trim()
      if (output.length > 0) {
        return output
      }
    }

    if (result.status === 1) {
      return ''
    }
  } catch {
    return null
  }

  return null
}
