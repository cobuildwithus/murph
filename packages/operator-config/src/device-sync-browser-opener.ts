import { spawn } from 'node:child_process'

const DEFAULT_WINDOWS_SYSTEM_ROOT = 'C:\\Windows'

export function resolveExternalUrlBrowserCommands(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Array<[string, string[]]> {
  return platform === 'darwin'
    ? [['open', [url]]]
    : platform === 'win32'
      ? [[resolveWindowsRundll32Path(env), ['url.dll,FileProtocolHandler', url]]]
      : [['xdg-open', [url]]]
}

export async function openExternalUrlInBrowser(url: string): Promise<boolean> {
  for (const [command, args] of resolveExternalUrlBrowserCommands(url)) {
    if (await trySpawn(command, args)) {
      return true
    }
  }

  return false
}

function resolveWindowsRundll32Path(env: NodeJS.ProcessEnv): string {
  const root = resolveWindowsSystemRoot(env)
  return `${root}\\System32\\rundll32.exe`
}

function resolveWindowsSystemRoot(env: NodeJS.ProcessEnv): string {
  const raw = env.SystemRoot ?? env.WINDIR ?? env.windir
  if (typeof raw !== 'string') {
    return DEFAULT_WINDOWS_SYSTEM_ROOT
  }

  const normalized = raw.trim().replace(/[\\/]+$/u, '').replace(/\//gu, '\\')
  if (/^[A-Z]:\\Windows$/iu.test(normalized)) {
    return normalized
  }

  return DEFAULT_WINDOWS_SYSTEM_ROOT
}

function trySpawn(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        env: sanitizeChildProcessEnv(),
        stdio: 'ignore',
      })

      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

function sanitizeChildProcessEnv(): NodeJS.ProcessEnv {
  const nextEnv = { ...process.env }
  delete nextEnv.NODE_V8_COVERAGE
  return nextEnv
}
