const IPV4_MAPPED_PREFIX = '::ffff:'

const LOOPBACK_CONTROL_PLANE_FORWARDED_HEADER_NAMES = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
] as const

type LoopbackControlHeaderValue = string | readonly string[] | undefined

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeLoopbackValue(hostname)
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    isLoopbackIpv4Literal(normalized) ||
    isLoopbackIpv4MappedLoopbackLiteral(normalized)
  )
}

export function hasForwardedLoopbackControlHeaders(
  headers: Readonly<Record<string, LoopbackControlHeaderValue>>,
): boolean {
  return LOOPBACK_CONTROL_PLANE_FORWARDED_HEADER_NAMES.some((headerName) =>
    hasPresentLoopbackControlHeaderValue(headers[headerName]),
  )
}

export function hasLoopbackControlHostHeader(
  value: LoopbackControlHeaderValue,
): boolean {
  const hostname = readLoopbackControlHostHeaderHostname(value)
  return hostname !== null && isLoopbackHostname(hostname)
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
  return isLoopbackIpv4MappedLoopbackLiteral(normalized)
}

function normalizeLoopbackValue(value: string): string {
  return value.trim().toLowerCase().replace(/^\[(.*)\]$/u, '$1')
}

function readLoopbackControlHostHeaderHostname(
  value: LoopbackControlHeaderValue,
): string | null {
  const host = readSingleLoopbackControlHeaderValue(value)
  if (!host) {
    return null
  }

  if (/[\s@/?#]/u.test(host)) {
    return null
  }

  const ipv6Match = host.match(/^\[([^[\]]+)\](?::\d+)?$/u)
  if (ipv6Match?.[1]) {
    return ipv6Match[1]
  }

  const hostMatch = host.match(/^([^:]+)(?::\d+)?$/u)
  return hostMatch?.[1] ?? null
}

function readSingleLoopbackControlHeaderValue(
  value: LoopbackControlHeaderValue,
): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? readSingleLoopbackControlHeaderValue(value[0]) : null
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function hasPresentLoopbackControlHeaderValue(
  value: LoopbackControlHeaderValue,
): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.trim().length > 0)
  }

  return typeof value === 'string' && value.trim().length > 0
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

function isLoopbackIpv4MappedLoopbackLiteral(value: string): boolean {
  if (!value.startsWith(IPV4_MAPPED_PREFIX)) {
    return false
  }

  const mappedValue = value.slice(IPV4_MAPPED_PREFIX.length)
  if (isLoopbackIpv4Literal(mappedValue)) {
    return true
  }

  const mappedOctets = mappedValue.split(':')
  if (mappedOctets.length !== 2) {
    return false
  }

  const [highOctet, lowOctet] = mappedOctets
  if (
    !/^[0-9a-f]{1,4}$/u.test(highOctet) ||
    !/^[0-9a-f]{1,4}$/u.test(lowOctet)
  ) {
    return false
  }

  const highValue = Number.parseInt(highOctet, 16)
  return Number.isInteger(highValue) && highValue >= 0x7f00 && highValue <= 0x7fff
}
