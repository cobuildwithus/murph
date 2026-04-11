const IPV4_MAPPED_PREFIX = '::ffff:'

const LOOPBACK_CONTROL_PLANE_FORWARDED_HEADER_NAMES = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
] as const

export type LoopbackControlHeaderValue = string | readonly string[] | undefined

export type LoopbackControlRequestRejectionReason =
  | 'loopback-remote-address-required'
  | 'forwarded-headers-rejected'
  | 'loopback-host-required'

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeLoopbackValue(hostname)
  return normalized === 'localhost' || isLoopbackAddressLiteral(normalized)
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

export function readLoopbackControlHeaderValue(
  value: LoopbackControlHeaderValue,
): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? readLoopbackControlHeaderValue(value[0]) : null
  }

  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function getLoopbackControlRequestRejectionReason(input: {
  headers: Readonly<Record<string, LoopbackControlHeaderValue>>
  remoteAddress: string | null | undefined
}): LoopbackControlRequestRejectionReason | null {
  if (!isLoopbackRemoteAddress(input.remoteAddress)) {
    return 'loopback-remote-address-required'
  }

  if (hasForwardedLoopbackControlHeaders(input.headers)) {
    return 'forwarded-headers-rejected'
  }

  if (!hasLoopbackControlHostHeader(input.headers.host)) {
    return 'loopback-host-required'
  }

  return null
}

export function isLoopbackHttpBaseUrl(baseUrl: string): boolean {
  const url = new URL(baseUrl)
  return url.protocol === 'http:' && isLoopbackHostname(url.hostname)
}

export function isBracketedListenerHost(host: string): boolean {
  return /^\[[^[\]]+\]$/u.test(host.trim())
}

export function assertUnbracketedListenerHost(
  host: string,
  message = 'Listener host must be an unbracketed hostname or address.',
): void {
  if (isBracketedListenerHost(host)) {
    throw new TypeError(message)
  }
}

export function isLoopbackListenerHost(host: string): boolean {
  const trimmed = host.trim()
  return !isBracketedListenerHost(trimmed) && isLoopbackHostname(trimmed)
}

export function assertLoopbackListenerHost(
  host: string,
  message = 'Loopback listener host must be a loopback hostname or address.',
): void {
  if (!isLoopbackListenerHost(host)) {
    throw new TypeError(message)
  }
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

export function isLoopbackRemoteAddress(
  value: string | null | undefined,
): boolean {
  if (typeof value !== 'string') {
    return false
  }

  return isLoopbackAddressLiteral(normalizeLoopbackValue(value))
}

function normalizeLoopbackValue(value: string): string {
  return value.trim().toLowerCase().replace(/^\[(.*)\]$/u, '$1')
}

function isLoopbackAddressLiteral(value: string): boolean {
  return (
    value === '::1' ||
    isLoopbackIpv4Literal(value) ||
    isLoopbackIpv4MappedLoopbackLiteral(value)
  )
}

function readLoopbackControlHostHeaderHostname(
  value: LoopbackControlHeaderValue,
): string | null {
  const host = readLoopbackControlHeaderValue(value)
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
