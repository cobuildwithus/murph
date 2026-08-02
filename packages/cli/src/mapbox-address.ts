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
const MAX_FORMATTED_ADDRESS_LENGTH = 512
const MAX_ADDRESS_LINE_LENGTH = 64
const MAX_CITY_LENGTH = 200
const MAX_PROVIDER_LABEL_LENGTH = 64
const MAX_MATCH_VALUE_LENGTH = 32
const US_POSTAL_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/u
const US_STATE_CODE_PATTERN = /^[A-Z]{2}$/u

const isoCountryCodeSchema = z.string().trim().regex(/^[A-Za-z]{2}$/u)
const nullableAddressLineSchema = z
  .string()
  .min(1)
  .max(MAX_ADDRESS_LINE_LENGTH)
  .nullable()
const nullableCitySchema = z.string().min(1).max(MAX_CITY_LENGTH).nullable()
const nullableProviderLabelSchema = z
  .string()
  .min(1)
  .max(MAX_PROVIDER_LABEL_LENGTH)
  .nullable()
const nullableMatchValueSchema = z
  .string()
  .min(1)
  .max(MAX_MATCH_VALUE_LENGTH)
  .nullable()

export const mapboxAddressResolveInputSchema = z.object({
  query: z.string().trim().min(1).max(256),
  country: z.array(isoCountryCodeSchema).max(10).optional(),
  language: z.string().trim().min(1).max(10).optional(),
})

const mapboxAddressMatchSchema = z
  .object({
    confidence: nullableMatchValueSchema,
    addressNumber: nullableMatchValueSchema,
    street: nullableMatchValueSchema,
    secondaryAddress: nullableMatchValueSchema,
    postcode: nullableMatchValueSchema,
    place: nullableMatchValueSchema,
    region: nullableMatchValueSchema,
    country: nullableMatchValueSchema,
  })
  .strict()

const mapboxAddressCandidateSchema = z
  .object({
    formattedAddress: z.string().min(1).max(MAX_FORMATTED_ADDRESS_LENGTH),
    addressLine1: nullableAddressLineSchema,
    addressLine2: nullableAddressLineSchema,
    city: nullableCitySchema,
    state: nullableProviderLabelSchema,
    postalCode: nullableProviderLabelSchema,
    countryCode: nullableProviderLabelSchema,
    featureType: nullableProviderLabelSchema,
    accuracy: nullableProviderLabelSchema,
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
    query: z.string().min(1).max(256),
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
      secondary_address?: string
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
  const soleCandidate = candidates.length === 1 ? candidates[0] ?? null : null
  const recommendedCandidate = soleCandidate?.safeToAutofill
    ? soleCandidate
    : null
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
    warnings: buildWarnings(candidates, recommendedCandidate),
  } satisfies MapboxAddressResolveResult

  return mapboxAddressResolveResultSchema.parse(result)
}

function buildCandidate(
  feature: MapboxAddressFeature,
): MapboxAddressCandidate | null {
  const properties = feature.properties
  const context = properties?.context
  const featureType = normalizeLowercase(
    properties?.feature_type,
    MAX_PROVIDER_LABEL_LENGTH,
  )
  const addressLine1 =
    normalizeBoundedString(
      context?.address?.name,
      MAX_ADDRESS_LINE_LENGTH,
    ) ??
    formatStreetAddress({
      addressNumber: context?.address?.address_number,
      streetName: context?.address?.street_name,
    }) ??
    (featureType === 'address'
      ? normalizeBoundedString(properties?.name, MAX_ADDRESS_LINE_LENGTH)
      : null)
  const addressLine2 =
    normalizeBoundedString(
      context?.secondary_address?.name,
      MAX_ADDRESS_LINE_LENGTH,
    ) ??
    (featureType === 'secondary_address'
      ? formatSecondaryAddress({
          designator: context?.secondary_address?.designator,
          identifier: context?.secondary_address?.identifier,
        }) ?? normalizeBoundedString(
          properties?.name,
          MAX_ADDRESS_LINE_LENGTH,
        )
      : null)
  const city =
    normalizeBoundedString(context?.place?.name, MAX_CITY_LENGTH) ??
    normalizeBoundedString(context?.locality?.name, MAX_CITY_LENGTH)
  const state = normalizeUsStateCode(context?.region?.region_code)
  const postalCode = normalizeUppercase(
    context?.postcode?.name,
    MAX_PROVIDER_LABEL_LENGTH,
  )
  const countryCode = normalizeUppercase(
    context?.country?.country_code,
    MAX_PROVIDER_LABEL_LENGTH,
  )
  const accuracy = normalizeLowercase(
    properties?.coordinates?.accuracy,
    MAX_PROVIDER_LABEL_LENGTH,
  )
  const match = {
    confidence: normalizeLowercase(
      properties?.match_code?.confidence,
      MAX_MATCH_VALUE_LENGTH,
    ),
    addressNumber: normalizeLowercase(
      properties?.match_code?.address_number,
      MAX_MATCH_VALUE_LENGTH,
    ),
    street: normalizeLowercase(
      properties?.match_code?.street,
      MAX_MATCH_VALUE_LENGTH,
    ),
    secondaryAddress: normalizeLowercase(
      properties?.match_code?.secondary_address,
      MAX_MATCH_VALUE_LENGTH,
    ),
    postcode: normalizeLowercase(
      properties?.match_code?.postcode,
      MAX_MATCH_VALUE_LENGTH,
    ),
    place: normalizeLowercase(
      properties?.match_code?.place,
      MAX_MATCH_VALUE_LENGTH,
    ),
    region: normalizeLowercase(
      properties?.match_code?.region,
      MAX_MATCH_VALUE_LENGTH,
    ),
    country: normalizeLowercase(
      properties?.match_code?.country,
      MAX_MATCH_VALUE_LENGTH,
    ),
  }
  const formattedAddress =
    normalizeBoundedString(
      properties?.full_address,
      MAX_FORMATTED_ADDRESS_LENGTH,
    ) ??
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
  const secondaryAddressIsExact =
    featureType !== 'secondary_address' ||
    Boolean(addressLine2 && match.secondaryAddress === 'matched')
  const safeToAutofill = Boolean(
    completeForUsMail &&
      (featureType === 'address' || featureType === 'secondary_address') &&
      (match.confidence === 'exact' || match.confidence === 'high') &&
      match.addressNumber === 'matched' &&
      match.street === 'matched' &&
      secondaryAddressIsExact,
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

function formatStreetAddress(input: {
  addressNumber: string | null | undefined
  streetName: string | null | undefined
}): string | null {
  const addressNumber = normalizeBoundedString(input.addressNumber, 16)
  const streetName = normalizeBoundedString(input.streetName, 56)
  if (!addressNumber || !streetName) {
    return null
  }

  return normalizeBoundedString(
    `${addressNumber} ${streetName}`,
    MAX_ADDRESS_LINE_LENGTH,
  )
}

function formatSecondaryAddress(input: {
  designator: string | null | undefined
  identifier: string | null | undefined
}): string | null {
  const designator = normalizeBoundedString(input.designator, 24)
  const identifier = normalizeBoundedString(input.identifier, 32)
  if (!designator || !identifier) {
    return null
  }

  return normalizeBoundedString(
    `${designator} ${identifier}`,
    MAX_ADDRESS_LINE_LENGTH,
  )
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

  return normalizeBoundedString(formatted, MAX_FORMATTED_ADDRESS_LENGTH)
}

function dedupeCandidates(
  candidates: readonly MapboxAddressCandidate[],
): MapboxAddressCandidate[] {
  const seen = new Set<string>()
  const uniqueCandidates: MapboxAddressCandidate[] = []

  for (const candidate of candidates) {
    const structuredParts = [
      candidate.addressLine1,
      candidate.addressLine2,
      candidate.city,
      candidate.state,
      candidate.postalCode,
      candidate.countryCode,
    ].map((value) => value?.toLowerCase() ?? '')
    const key = structuredParts.some((value) => value.length > 0)
      ? structuredParts.join('|')
      : candidate.formattedAddress.toLowerCase()

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
  recommendedCandidate: MapboxAddressCandidate | null,
): string[] {
  if (candidates.length === 0) {
    return ['No mailing-address candidates were found.']
  }

  if (candidates.length > 1) {
    return ['More than one mailing-address candidate was returned.']
  }

  if (recommendedCandidate) {
    return []
  }

  if (candidates[0]?.completeForUsMail) {
    return ['The mailing-address match was not strong enough to fill automatically.']
  }

  return ['The mailing-address match did not include every required US mailing field.']
}

function normalizeUsStateCode(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeUppercase(value, 8)
  if (!normalized) {
    return null
  }
  if (US_STATE_CODE_PATTERN.test(normalized)) {
    return normalized
  }

  const fullCodeMatch = /^US-([A-Z]{2})$/u.exec(normalized)
  return fullCodeMatch?.[1] ?? null
}

function normalizeUppercase(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  return normalizeBoundedString(value, maxLength)?.toUpperCase() ?? null
}

function normalizeLowercase(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  return normalizeBoundedString(value, maxLength)?.toLowerCase() ?? null
}

function normalizeBoundedString(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = normalizeNullableString(value)
  return normalized && normalized.length <= maxLength ? normalized : null
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}
