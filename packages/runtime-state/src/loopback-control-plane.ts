const IPV4_MAPPED_PREFIX = '::ffff:'

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeLoopbackValue(hostname)
  return normalized === 'localhost' || normalized === '::1' || isLoopbackIpv4Literal(normalized)
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

  const normalized = normalizeLoopbackValue(value)
  if (normalized === '::1' || isLoopbackIpv4Literal(normalized)) {
    return true
  }
  if (normalized.startsWith(IPV4_MAPPED_PREFIX)) {
    return isLoopbackIpv4Literal(normalized.slice(IPV4_MAPPED_PREFIX.length))
  }
  return false
}

function normalizeLoopbackValue(value: string): string {
  return value.trim().toLowerCase().replace(/^\[(.*)\]$/u, '$1')
}

function isLoopbackIpv4Literal(value: string): boolean {
  const octets = value.split('.')
  if (octets.length !== 4) {
    return false
  }

  const parsedOctets = octets.map((octet) =>
    /^\d{1,3}$/u.test(octet) ? Number(octet) : Number.NaN,
  )
  return (
    parsedOctets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) &&
    parsedOctets[0] === 127
  )
}
