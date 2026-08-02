import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { z } from 'zod'

import { MAPBOX_GEOCODING_API_VERSION } from './mapbox-route-contracts.js'
import {
  fetchMapboxJson,
  readMapboxAccessToken,
  resolveMapboxTimeoutMs,
} from './mapbox-route-client.js'

const MAX_ADDRESS_CANDIDATES = 3
const US_POSTAL_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/u
const US_STATE_CODE_PATTERN = /^[A-Z]{2}$/u

const isoCountryCodeSchema = z.string().trim().regex(/^[A-Za-z]{2}$/u)
const nullableStringSchema = z.string().min(1).nullable()

export const mapboxAddressResolveInputSchema = z.object({
  query: z.string().trim().min(1).max(256),
  country: z.array(isoCountryCodeSchema).max(10).optional(),
  language: z.string().trim().min(1).max(10).optional(),
})

const mapboxAddressMatchSchema = z
  .object({
    confidence: nullableStringSchema,
    addressNumber: nullableStringSchema,
    street: nullableStringSchema,
    postcode: nullableStringSchema,
    place: nullableStringSchema,
    region: nullableStringSchema,
    country: nullableStringSchema,
  })
  .strict()

const mapboxAddressCandidateSchema = z
  .object({
    formattedAddress: z.string().min(1),
    addressLine1: nullableStringSchema,
    addressLine2: nullableStringSchema,
    city: nullableStringSchema,
    state: nullableStringSchema,
    postalCode: nullableStringSchema,
    countryCode: nullableStringSchema,
    featureType: nullableStringSchema,
    accuracy: nullableStringSchema,
    completeForUsMail: z.boolean(),
    safeToAutofill: z.boolean(),
    match: mapboxAddressMatchSchema,
  })
  .strict()

export const mapboxAddressResolveResultSchema = z
  .object({
    provider: z
      .object({
        name: z.literal('mapbox'),
        geocodingApiVersion: z.literal(MAPBOX_GEOCODING_API_VERSION),
      })
      .strict(),
    query: z.string().min(1),
    candidates: z.array(mapboxAddressCandidateSchema).max(MAX_ADDRESS_CANDIDATES),
    recommendedCandidate: mapboxAddressCandidateSchema.nullable(),
    privacy: z
      .object({
        tokenSource: z.literal('env'),
        persistedByTool: z.literal(false),
        geocodingStorage: z.literal('temporary'),
        candidateCount: z.number().int().nonnegative(),
      })
      .strict(),
    warnings: z.array(z.string().min(1)),
  })
  .strict()

export type MapboxAddressDependencies = {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}
export type MapboxAddressResolveInput = z.infer<
  typeof mapboxAddressResolveInputSchema
>
export type MapboxAddressResolveResult = z.infer<
  typeof mapboxAddressResolveResultSchema
>
type MapboxAddressCandidate = z.infer<typeof mapboxAddressCandidateSchema>

interface MapboxAddressGeocodingResponse {
  features?: MapboxAddressFeature[]
}

interface MapboxAddressFeature {
  properties?: {
    feature_type?: string
    full_address?: string
    name?: string
    coordinates?: {
      accuracy?: string
    }
    context?: {
      address?: {
        address_number?: string
        street_name?: string
        name?: string
      }
      secondary_address?: {
        designator?: string
        identifier?: string
        name?: string
      }
      postcode?: {
        name?: string
      }
      place?: {
        name?: string
      }
      locality?: {
        name?: string
      }
      region?: {
        name?: string
        region_code?: string
      }
      country?: {
        name?: string
        country_code?: string
      }
    }
    match_code?: {
      confidence?: string
      address_number?: string
      street?: string
      postcode?: string
      place?: string
      region?: string
      country?: string
    }
  }
}

export async function resolveMapboxAddress(
  rawInput: MapboxAddressResolveInput,
  dependencies: MapboxAddressDependencies = {},
): Promise<MapboxAddressResolveResult> {
  const input = mapboxAddressResolveInputSchema.parse(rawInput)
  const env = dependencies.env ?? process.env
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const accessToken = readMapboxAccessToken(env)

  if (!accessToken) {
    throw new VaultCliError(
      'route_mapbox_token_missing',
      'Mapbox address resolution is not configured. Set MAPBOX_ACCESS_TOKEN in the runtime environment before resolving an address.',
    )
  }

  const url = new URL(
    `https://api.mapbox.com/search/geocode/${MAPBOX_GEOCODING_API_VERSION}/forward`,
  )
  url.searchParams.set('q', input.query)
  url.searchParams.set('access_token', accessToken)
  url.searchParams.set('types', 'address,secondary_address')
  url.searchParams.set('limit', String(MAX_ADDRESS_CANDIDATES))
  url.searchParams.set('autocomplete', 'false')
  url.searchParams.set('permanent', 'false')

  if (input.country && input.country.length > 0) {
    url.searchParams.set(
      'country',
      input.country.map((country) => country.toLowerCase()).join(','),
    )
  }

  if (input.language) {
    url.searchParams.set('language', input.language)
  }

  const payload = await fetchMapboxJson<MapboxAddressGeocodingResponse>({
    fetchImpl,
    timeoutMs: resolveMapboxTimeoutMs(env),
    url,
    requestLabel: 'address resolution',
  })
  const candidates = dedupeCandidates(
    (payload.features ?? [])
      .slice(0, MAX_ADDRESS_CANDIDATES)
      .map(buildCandidate)
      .filter(isPresent),
  )
  const safeCandidates = candidates.filter((candidate) => candidate.safeToAutofill)
  const recommendedCandidate =
    safeCandidates.length === 1 ? safeCandidates[0] ?? null : null
  const result = {
    provider: {
      name: 'mapbox',
      geocodingApiVersion: MAPBOX_GEOCODING_API_VERSION,
    },
    query: input.query,
    candidates,
    recommendedCandidate,
    privacy: {
      tokenSource: 'env',
      persistedByTool: false,
      geocodingStorage: 'temporary',
      candidateCount: candidates.length,
    },
    warnings: buildWarnings(candidates, safeCandidates.length),
  } satisfies MapboxAddressResolveResult

  return mapboxAddressResolveResultSchema.parse(result)
}

function buildCandidate(
  feature: MapboxAddressFeature,
): MapboxAddressCandidate | null {
  const properties = feature.properties
  const context = properties?.context
  const addressLine1 =
    normalizeNullableString(context?.address?.name) ??
    normalizeNullableString(properties?.name)
  const addressLine2 = normalizeNullableString(
    context?.secondary_address?.name,
  )
  const city =
    normalizeNullableString(context?.place?.name) ??
    normalizeNullableString(context?.locality?.name)
  const state = normalizeUppercase(context?.region?.region_code)
  const postalCode = normalizeNullableString(context?.postcode?.name)
  const countryCode = normalizeUppercase(context?.country?.country_code)
  const featureType = normalizeLowercase(properties?.feature_type)
  const accuracy = normalizeLowercase(properties?.coordinates?.accuracy)
  const match = {
    confidence: normalizeLowercase(properties?.match_code?.confidence),
    addressNumber: normalizeLowercase(
      properties?.match_code?.address_number,
    ),
    street: normalizeLowercase(properties?.match_code?.street),
    postcode: normalizeLowercase(properties?.match_code?.postcode),
    place: normalizeLowercase(properties?.match_code?.place),
    region: normalizeLowercase(properties?.match_code?.region),
    country: normalizeLowercase(properties?.match_code?.country),
  }
  const formattedAddress =
    normalizeNullableString(properties?.full_address) ??
    formatAddress({
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      countryCode,
    })

  if (!formattedAddress) {
    return null
  }

  const completeForUsMail = Boolean(
    addressLine1 &&
      city &&
      state &&
      US_STATE_CODE_PATTERN.test(state) &&
      postalCode &&
      US_POSTAL_CODE_PATTERN.test(postalCode) &&
      countryCode === 'US',
  )
  const safeToAutofill = Boolean(
    completeForUsMail &&
      (featureType === 'address' || featureType === 'secondary_address') &&
      (match.confidence === 'exact' || match.confidence === 'high') &&
      match.addressNumber === 'matched' &&
      match.street === 'matched',
  )

  return {
    formattedAddress,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    countryCode,
    featureType,
    accuracy,
    completeForUsMail,
    safeToAutofill,
    match,
  }
}

function formatAddress(input: {
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  countryCode: string | null
}): string | null {
  const locality = [input.city, input.state, input.postalCode]
    .filter(isPresent)
    .join(' ')
  const formatted = [
    input.addressLine1,
    input.addressLine2,
    locality || null,
    input.countryCode,
  ]
    .filter(isPresent)
    .join(', ')

  return normalizeNullableString(formatted)
}

function dedupeCandidates(
  candidates: readonly MapboxAddressCandidate[],
): MapboxAddressCandidate[] {
  const seen = new Set<string>()
  const uniqueCandidates: MapboxAddressCandidate[] = []

  for (const candidate of candidates) {
    const key = [
      candidate.addressLine1,
      candidate.addressLine2,
      candidate.city,
      candidate.state,
      candidate.postalCode,
      candidate.countryCode,
    ]
      .map((value) => value?.toLowerCase() ?? '')
      .join('|')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    uniqueCandidates.push(candidate)
  }

  return uniqueCandidates
}

function buildWarnings(
  candidates: readonly MapboxAddressCandidate[],
  safeCandidateCount: number,
): string[] {
  if (candidates.length === 0) {
    return ['No mailing-address candidates were found.']
  }

  if (safeCandidateCount === 1) {
    return []
  }

  if (safeCandidateCount > 1) {
    return ['More than one strong mailing-address match was returned.']
  }

  return ['No unique strong mailing-address match was returned.']
}

function normalizeUppercase(value: string | null | undefined): string | null {
  return normalizeNullableString(value)?.toUpperCase() ?? null
}

function normalizeLowercase(value: string | null | undefined): string | null {
  return normalizeNullableString(value)?.toLowerCase() ?? null
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}
