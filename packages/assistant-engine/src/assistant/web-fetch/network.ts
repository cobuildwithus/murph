import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { urlToHttpOptions } from 'node:url'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  errorMessage,
  normalizeNullableString,
} from '../shared.js'
import {
  cancelAssistantWebResponseBody,
  createAssistantWebNodeResponse,
} from './response.js'
import {
  type AssistantWebFetchedResponse,
  type AssistantWebFetchRuntimeContext,
  normalizeAssistantWebHostname,
  normalizeAssistantWebRequestUrl,
} from './config.js'

interface AssistantWebResolvedAddress {
  address: string
  family: number
}

interface AssistantWebResolvedTarget {
  addresses: AssistantWebResolvedAddress[]
  hostname: string
}

type AssistantWebLookupFunction =
  NonNullable<import('node:http').RequestOptions['lookup']>

const ASSISTANT_WEB_FETCH_BLOCKED_HOSTNAMES = [
  'home.arpa',
  'localhost',
  'localhost.localdomain',
] as const
const ASSISTANT_WEB_FETCH_DEFAULT_ACCEPT_HEADER =
  'text/html, application/xhtml+xml, application/json, text/plain;q=0.9, */*;q=0.1'

const assistantWebFetchBlockedAddressList = createAssistantWebFetchBlockedAddressList()

export async function fetchAssistantWebResponse(input: {
  acceptHeader?: string
  runtime: AssistantWebFetchRuntimeContext
  signal: AbortSignal
  toolName: string
  url: URL
}): Promise<AssistantWebFetchedResponse> {
  let currentUrl = input.url
  const warnings: string[] = []

  for (let redirectCount = 0; ; redirectCount += 1) {
    const resolvedTarget = await resolveAssistantWebPublicTarget(
      currentUrl,
      input.runtime.lookupImplementation,
      input.toolName,
    )

    let response: Response
    try {
      response = await requestAssistantWebResponseAtPublicTarget({
        acceptHeader: input.acceptHeader ?? ASSISTANT_WEB_FETCH_DEFAULT_ACCEPT_HEADER,
        resolvedTarget,
        signal: input.signal,
        url: currentUrl,
      })
    } catch (error) {
      throw new VaultCliError(
        'WEB_FETCH_REQUEST_FAILED',
        `${input.toolName} could not reach ${redactAssistantWebFetchUrl(currentUrl)}: ${errorMessage(error)}`,
      )
    }

    if (!isAssistantWebRedirectStatus(response.status)) {
      return {
        finalUrl: currentUrl,
        response,
        warnings,
      }
    }

    const location = normalizeNullableString(response.headers.get('location'))
    if (!location) {
      await cancelAssistantWebResponseBody(response)
      throw new VaultCliError(
        'WEB_FETCH_REDIRECT_INVALID',
        `${input.toolName} received HTTP ${response.status} without a redirect location.`,
      )
    }

    if (redirectCount >= input.runtime.maxRedirects) {
      await cancelAssistantWebResponseBody(response)
      throw new VaultCliError(
        'WEB_FETCH_REDIRECT_LIMIT',
        `${input.toolName} followed too many redirects (>${input.runtime.maxRedirects}).`,
      )
    }

    const nextUrl = normalizeAssistantWebRequestUrl(
      new URL(location, currentUrl).toString(),
    )
    warnings.push(
      `Followed redirect ${redirectCount + 1} to ${redactAssistantWebFetchUrl(nextUrl)}.`,
    )
    await cancelAssistantWebResponseBody(response)
    currentUrl = nextUrl
  }
}

export function redactAssistantWebFetchUrl(url: URL): string {
  return `${url.origin}${url.pathname}`
}

async function resolveAssistantWebPublicTarget(
  candidateUrl: URL,
  lookupImplementation: AssistantWebFetchRuntimeContext['lookupImplementation'],
  toolName: string,
): Promise<AssistantWebResolvedTarget> {
  const protocol = candidateUrl.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new VaultCliError(
      'WEB_FETCH_URL_UNSUPPORTED_SCHEME',
      `${toolName} only supports http:// and https:// URLs.`,
    )
  }

  if (candidateUrl.username || candidateUrl.password) {
    throw new VaultCliError(
      'WEB_FETCH_URL_CREDENTIALS_FORBIDDEN',
      `${toolName} does not allow credentials in URLs.`,
    )
  }

  const hostname = normalizeAssistantWebHostname(candidateUrl.hostname)
  if (!hostname) {
    throw new VaultCliError(
      'WEB_FETCH_HOST_INVALID',
      `${toolName} requires a URL with a hostname.`,
    )
  }

  if (isAssistantWebBlockedHostname(hostname)) {
    throw new VaultCliError(
      'WEB_FETCH_PRIVATE_HOST_BLOCKED',
      `${toolName} blocked ${hostname} because private or loopback hosts are not allowed.`,
    )
  }

  const hostAddressFamily = isIP(hostname)
  if (hostAddressFamily !== 0) {
    if (isAssistantWebBlockedIpAddress(hostname, hostAddressFamily)) {
      throw new VaultCliError(
        'WEB_FETCH_PRIVATE_HOST_BLOCKED',
        `${toolName} blocked ${hostname} because private or loopback hosts are not allowed.`,
      )
    }

    return {
      hostname,
      addresses: [
        {
          address: hostname,
          family: hostAddressFamily,
        },
      ],
    }
  }

  let resolvedAddresses: AssistantWebResolvedAddress[]
  try {
    resolvedAddresses = await lookupAllAssistantWebAddresses(
      lookupImplementation,
      hostname,
    )
  } catch (error) {
    throw new VaultCliError(
      'WEB_FETCH_DNS_LOOKUP_FAILED',
      `${toolName} could not resolve ${hostname}: ${errorMessage(error)}`,
    )
  }

  if (resolvedAddresses.length === 0) {
    throw new VaultCliError(
      'WEB_FETCH_DNS_LOOKUP_FAILED',
      `${toolName} could not resolve ${hostname} to any IP address.`,
    )
  }

  for (const address of resolvedAddresses) {
    if (isAssistantWebBlockedIpAddress(address.address, address.family)) {
      throw new VaultCliError(
        'WEB_FETCH_PRIVATE_HOST_BLOCKED',
        `${toolName} blocked ${hostname} because it resolved to a private or loopback address.`,
      )
    }
  }

  return {
    hostname,
    addresses: resolvedAddresses,
  }
}

async function requestAssistantWebResponseAtPublicTarget(input: {
  acceptHeader: string
  resolvedTarget: AssistantWebResolvedTarget
  signal: AbortSignal
  url: URL
}): Promise<Response> {
  const failures: string[] = []

  for (const address of input.resolvedTarget.addresses) {
    try {
      return await requestAssistantWebResponseAtAddress({
        acceptHeader: input.acceptHeader,
        address,
        hostname: input.resolvedTarget.hostname,
        signal: input.signal,
        url: input.url,
      })
    } catch (error) {
      if (input.signal.aborted || isAssistantWebAbortError(error)) {
        throw error
      }

      failures.push(errorMessage(error))
    }
  }

  throw new Error(
    failures.length > 0
      ? `All vetted public addresses failed: ${failures.join('; ')}`
      : 'All vetted public addresses failed.',
  )
}

async function requestAssistantWebResponseAtAddress(input: {
  acceptHeader: string
  address: AssistantWebResolvedAddress
  hostname: string
  signal: AbortSignal
  url: URL
}): Promise<Response> {
  const options = {
    ...urlToHttpOptions(input.url),
    method: 'GET',
    headers: {
      accept: input.acceptHeader,
      'accept-encoding': 'identity',
    },
    autoSelectFamily: false,
    family: input.address.family,
    agent: false,
    lookup: isIP(input.hostname) === 0
      ? createAssistantWebPinnedLookup(input.address)
      : undefined,
    servername:
      input.url.protocol === 'https:' && isIP(input.hostname) === 0
        ? input.hostname
        : undefined,
    signal: input.signal,
  }
  const requestImplementation = input.url.protocol === 'https:'
    ? requestHttps
    : requestHttp

  return await new Promise<Response>((resolve, reject) => {
    const request = requestImplementation(options, (response) => {
      try {
        resolve(createAssistantWebNodeResponse(response))
      } catch (error) {
        reject(error)
      }
    })

    request.once('error', reject)
    request.end()
  })
}

function createAssistantWebPinnedLookup(
  address: AssistantWebResolvedAddress,
): AssistantWebLookupFunction {
  return (
    _hostname: Parameters<AssistantWebLookupFunction>[0],
    options: Parameters<AssistantWebLookupFunction>[1],
    callback: Parameters<AssistantWebLookupFunction>[2],
  ) => {
    const requestedFamily = typeof options === 'number'
      ? options
      : options.family === 'IPv4'
        ? 4
        : options.family === 'IPv6'
          ? 6
          : options.family ?? 0

    queueMicrotask(() => {
      if (requestedFamily !== 0 && requestedFamily !== address.family) {
        callback(
          new Error(
            `Pinned address family ${address.family} did not match requested family ${requestedFamily}.`,
          ),
          address.address,
          address.family,
        )
        return
      }

      callback(null, address.address, address.family)
    })
  }
}

function isAssistantWebRedirectStatus(status: number): boolean {
  return status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
}

function isAssistantWebBlockedHostname(
  hostname: string,
): boolean {
  if (ASSISTANT_WEB_FETCH_BLOCKED_HOSTNAMES.some((blocked) => blocked === hostname)) {
    return true
  }

  return hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.home.arpa')
}

function isAssistantWebBlockedIpAddress(
  address: string,
  family: number,
): boolean {
  if (family === 4) {
    return assistantWebFetchBlockedAddressList.check(address, 'ipv4')
  }

  if (family === 6) {
    const mappedIpv4 = resolveAssistantWebIpv4MappedAddress(address)
    if (mappedIpv4) {
      return assistantWebFetchBlockedAddressList.check(mappedIpv4, 'ipv4')
    }

    return assistantWebFetchBlockedAddressList.check(address, 'ipv6')
  }

  return false
}

function resolveAssistantWebIpv4MappedAddress(
  address: string,
): string | null {
  const normalized = address.toLowerCase()
  if (!normalized.startsWith('::ffff:')) {
    return null
  }

  const suffix = normalized.slice('::ffff:'.length)
  if (isIP(suffix) === 4) {
    return suffix
  }

  const parts = suffix.split(':')
  if (
    parts.length !== 2 ||
    !parts.every((part) => /^[0-9a-f]{1,4}$/u.test(part))
  ) {
    return null
  }

  const left = Number.parseInt(parts[0] ?? '', 16)
  const right = Number.parseInt(parts[1] ?? '', 16)
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return null
  }

  return [
    (left >> 8) & 0xff,
    left & 0xff,
    (right >> 8) & 0xff,
    right & 0xff,
  ].join('.')
}

function createAssistantWebFetchBlockedAddressList(): BlockList {
  const blockList = new BlockList()

  blockList.addSubnet('0.0.0.0', 8)
  blockList.addSubnet('10.0.0.0', 8)
  blockList.addSubnet('100.64.0.0', 10)
  blockList.addSubnet('127.0.0.0', 8)
  blockList.addSubnet('169.254.0.0', 16)
  blockList.addSubnet('172.16.0.0', 12)
  blockList.addSubnet('192.0.0.0', 24)
  blockList.addSubnet('192.168.0.0', 16)
  blockList.addSubnet('198.18.0.0', 15)
  blockList.addSubnet('224.0.0.0', 4)
  blockList.addSubnet('240.0.0.0', 4)
  blockList.addSubnet('::', 128, 'ipv6')
  blockList.addSubnet('::ffff:0:0', 96, 'ipv6')
  blockList.addSubnet('::1', 128, 'ipv6')
  blockList.addSubnet('fc00::', 7, 'ipv6')
  blockList.addSubnet('fe80::', 10, 'ipv6')
  blockList.addSubnet('ff00::', 8, 'ipv6')

  return blockList
}

function isAssistantWebAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function lookupAllAssistantWebAddresses(
  lookupImplementation: AssistantWebFetchRuntimeContext['lookupImplementation'],
  hostname: string,
): Promise<AssistantWebResolvedAddress[]> {
  const resolved = await lookupImplementation(hostname, {
    all: true,
    verbatim: true,
  })
  const normalized = Array.isArray(resolved) ? resolved : [resolved]
  const seen = new Set<string>()
  const addresses: AssistantWebResolvedAddress[] = []

  for (const entry of normalized) {
    const key = `${entry.family}:${entry.address}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    addresses.push(entry)
  }

  return addresses
}
