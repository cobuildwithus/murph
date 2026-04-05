import { spawnSync } from 'node:child_process'

export type AssistantInkThemeMode = 'dark' | 'light'

export interface AssistantInkTheme {
  accentColor: string
  assistantLabelColor: string
  borderColor: string
  composerBackground: string
  composerBorderColor: string
  composerCursorBackground: string
  composerCursorTextColor: string
  composerPlaceholderColor: string
  composerTextColor: string
  errorColor: string
  footerBadgeBackground: string
  footerBadgeTextColor: string
  infoColor: string
  mode: AssistantInkThemeMode
  mutedColor: string
  successColor: string
  switcherBackground: string
  switcherBorderColor: string
  switcherMutedColor: string
  switcherSelectionBackground: string
  switcherSelectionTextColor: string
  switcherTextColor: string
  userLabelColor: string
}

export interface ResolveAssistantInkThemeInput {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  readAppleInterfaceStyle?: () => string | null
}

export interface AssistantInkThemeBaseline {
  initialAppleInterfaceStyle: string | null
  initialColorFgbg: string | null | undefined
  theme: AssistantInkTheme
}

export interface ResolveAssistantInkThemeModeForOpenChatInput {
  currentMode: AssistantInkThemeMode
  currentAppleInterfaceStyle: string | null
  initialAppleInterfaceStyle: string | null
  initialColorFgbg: string | null | undefined
  platform: NodeJS.Platform
}

export const LIGHT_ASSISTANT_INK_THEME: AssistantInkTheme = {
  mode: 'light',
  accentColor: '#2563eb',
  assistantLabelColor: '#9333ea',
  borderColor: '#cbd5e1',
  composerBackground: '#f3f4f6',
  composerBorderColor: '#cbd5e1',
  composerCursorBackground: '#1d4ed8',
  composerCursorTextColor: '#ffffff',
  composerPlaceholderColor: '#6b7280',
  composerTextColor: '#111827',
  errorColor: '#dc2626',
  footerBadgeBackground: '#e2e8f0',
  footerBadgeTextColor: '#0f172a',
  infoColor: '#2563eb',
  mutedColor: '#64748b',
  successColor: '#16a34a',
  switcherBackground: '#f8fafc',
  switcherBorderColor: '#cbd5e1',
  switcherMutedColor: '#64748b',
  switcherSelectionBackground: '#dbeafe',
  switcherSelectionTextColor: '#0f172a',
  switcherTextColor: '#111827',
  userLabelColor: '#1d4ed8',
}

export const DARK_ASSISTANT_INK_THEME: AssistantInkTheme = {
  mode: 'dark',
  accentColor: '#60a5fa',
  assistantLabelColor: '#c084fc',
  borderColor: '#334155',
  composerBackground: '#111827',
  composerBorderColor: '#475569',
  composerCursorBackground: '#60a5fa',
  composerCursorTextColor: '#0f172a',
  composerPlaceholderColor: '#94a3b8',
  composerTextColor: '#e5e7eb',
  errorColor: '#f87171',
  footerBadgeBackground: '#1e293b',
  footerBadgeTextColor: '#e2e8f0',
  infoColor: '#60a5fa',
  mutedColor: '#94a3b8',
  successColor: '#4ade80',
  switcherBackground: '#0f172a',
  switcherBorderColor: '#334155',
  switcherMutedColor: '#94a3b8',
  switcherSelectionBackground: '#1e293b',
  switcherSelectionTextColor: '#e2e8f0',
  switcherTextColor: '#e5e7eb',
  userLabelColor: '#93c5fd',
}

export function resolveAssistantInkThemeForMode(
  mode: AssistantInkThemeMode,
): AssistantInkTheme {
  return mode === 'dark'
    ? DARK_ASSISTANT_INK_THEME
    : LIGHT_ASSISTANT_INK_THEME
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

  return resolveAssistantInkThemeForMode(mode)
}

export function captureAssistantInkThemeBaseline(
  input: ResolveAssistantInkThemeInput = {},
): AssistantInkThemeBaseline {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const readAppleStyle = input.readAppleInterfaceStyle ?? readAppleInterfaceStyle
  const initialAppleInterfaceStyle =
    platform === 'darwin'
      ? readAppleStyle()
      : null

  return {
    initialAppleInterfaceStyle,
    initialColorFgbg: env.COLORFGBG,
    theme: resolveAssistantInkTheme({
      env,
      platform,
      readAppleInterfaceStyle: () => initialAppleInterfaceStyle,
    }),
  }
}

export function resolveAssistantInkThemeModeForOpenChat(
  input: ResolveAssistantInkThemeModeForOpenChatInput,
): AssistantInkThemeMode {
  if (input.platform !== 'darwin') {
    return input.currentMode
  }

  const launchColorFgbgMode = inferAssistantInkThemeModeFromColorFgbg(
    input.initialColorFgbg,
  )
  const initialAppleMode = inferAssistantInkThemeModeFromAppleInterfaceStyle(
    input.initialAppleInterfaceStyle,
  )
  const currentAppleMode = inferAssistantInkThemeModeFromAppleInterfaceStyle(
    input.currentAppleInterfaceStyle,
  )

  if (!launchColorFgbgMode) {
    return currentAppleMode ?? input.currentMode
  }

  if (!initialAppleMode || !currentAppleMode) {
    return input.currentMode
  }

  return currentAppleMode === initialAppleMode
    ? launchColorFgbgMode
    : currentAppleMode
}

export function resolveAssistantInkThemeForOpenChat(input: {
  currentMode: AssistantInkThemeMode
  initialAppleInterfaceStyle: string | null
  initialColorFgbg: string | null | undefined
  platform?: NodeJS.Platform
  readAppleInterfaceStyle?: () => string | null
}): AssistantInkTheme {
  const platform = input.platform ?? process.platform
  const currentAppleInterfaceStyle =
    platform === 'darwin'
      ? (input.readAppleInterfaceStyle ?? readAppleInterfaceStyle)()
      : null

  return resolveAssistantInkThemeForMode(
    resolveAssistantInkThemeModeForOpenChat({
      currentMode: input.currentMode,
      currentAppleInterfaceStyle,
      initialAppleInterfaceStyle: input.initialAppleInterfaceStyle,
      initialColorFgbg: input.initialColorFgbg,
      platform,
    }),
  )
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
