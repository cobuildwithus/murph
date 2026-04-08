export function tryKillProcess(
  killProcess: (pid: number, signal?: NodeJS.Signals | number) => void,
  pid: number,
  signal: NodeJS.Signals | number,
): void {
  try {
    killProcess(pid, signal)
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: string }).code ?? '')
        : ''

    if (code === 'ESRCH') {
      return
    }

    throw error
  }
}
