export type LoopbackControlHeaderValue = string | readonly string[] | undefined

export function readLoopbackControlHeaderValue(
  value: LoopbackControlHeaderValue,
): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? readLoopbackControlHeaderValue(value[0]) : null
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function isListenerPort(
  port: number,
  options: { allowZero?: boolean } = {},
): boolean {
  const minimum = options.allowZero ? 0 : 1
  return Number.isInteger(port) && port >= minimum && port <= 65_535
}

export function assertListenerPort(
  port: number,
  message = 'Listener port must be an integer between 1 and 65535.',
  options: { allowZero?: boolean } = {},
): void {
  if (!isListenerPort(port, options)) {
    throw new TypeError(message)
  }
}
