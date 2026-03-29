export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/u, '$1')
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '127.0.0.1' ||
    normalized.startsWith('127.')
  )
}

export function isLoopbackHttpBaseUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl)
  return url.protocol === 'http:' && isLoopbackHostname(url.hostname)
}

export function isLoopbackRemoteAddress(
  value: string | null | undefined,
): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  )
}
