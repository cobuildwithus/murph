import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import * as z from '@murphai/contracts/zod-runtime'

import { MAPBOX_GEOCODING_API_VERSION } from './mapbox-route-contracts.js'
import {
  fetchMapboxJson,
  readMapboxAccessToken,
  resolveMapboxTimeoutMs,
} from './mapbox-route-client.js'

const MAX_ADDRESS_CANDIDATES = 3
const MAX_ADDRESS_LINE_LENGTH = 64
const MAX_CITY_LENGTH = 200
const MAX_PROVIDER_STRING_LENGTH = 512
const MAX_MATCH_VALUE_LENGTH = 32
const US_POSTAL_CODE_PATTERN = /^\d{5}(?:-\d{4})?$/u
const US_POSTAL_CODE_SEARCH_PATTERN = /\b(\d{5}(?:-\d{4})?)\b/u
const US_STATE_CODE_PATTERN = /^[A-Z]{2}$/u
const US_STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA',
  'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX',
  'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
])
const US_STATE_NAMES_TO_CODES = new Map([
  ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'],
  ['california', 'CA'], ['colorado', 'CO'], ['connecticut', 'CT'],
  ['delaware', 'DE'], ['district of columbia', 'DC'], ['florida', 'FL'],
  ['georgia', 'GA'], ['hawaii', 'HI'], ['idaho', 'ID'], ['illinois', 'IL'],
  ['indiana', 'IN'], ['iowa', 'IA'], ['kansas', 'KS'], ['kentucky', 'KY'],
  ['louisiana', 'LA'], ['maine', 'ME'], ['maryland', 'MD'],
  ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'],
  ['mississippi', 'MS'], ['missouri', 'MO'], ['montana', 'MT'],
  ['nebraska', 'NE'], ['nevada', 'NV'], ['new hampshire', 'NH'],
  ['new jersey', 'NJ'], ['new mexico', 'NM'], ['new york', 'NY'],
  ['north carolina', 'NC'], ['north dakota', 'ND'], ['ohio', 'OH'],
  ['oklahoma', 'OK'], ['oregon', 'OR'], ['pennsylvania', 'PA'],
  ['rhode island', 'RI'], ['south carolina', 'SC'], ['south dakota', 'SD'],
  ['tennessee', 'TN'], ['texas', 'TX'], ['utah', 'UT'], ['vermont', 'VT'],
  ['virginia', 'VA'], ['washington', 'WA'], ['west virginia', 'WV'],
  ['wisconsin', 'WI'], ['wyoming', 'WY'],
] as const)
const SECONDARY_ADDRESS_PREFIX_PATTERN =
  /^(?:#|apt\b|apartment\b|bldg\b|building\b|fl\b|floor\b|ste\b|suite\b|unit\b)/iu
const SECONDARY_ADDRESS_COMPONENT_PATTERN =
  /(?:\b(?:apt(?:artment)?|bldg|building|fl(?:oor)?|ste|suite|unit)\.?\s*[A-Za-z0-9-]+\b|#\s*[A-Za-z0-9-]+\b)/iu
const TRAILING_US_COUNTRY_PATTERN =
  /(?:,\s*|\s+)\b(?:united states(?: of america)?|u\.?s\.?(?:a\.?)?)\s*$/iu

const isoCountryCodeSchema = z.string().trim().regex(/^[A-Za-z]{2}$/u)
const nullableAddressLineSchema = z
  .string()
  .min(1)
  .max(MAX_ADDRESS_LINE_LENGTH)
  .nullable()
const optionalAddressLineSchema = z
  .string()
  .min(1)
  .max(MAX_ADDRESS_LINE_LENGTH)
  .optional()
const nullableCitySchema = z.string().min(1).max(MAX_CITY_LENGTH).nullable()
const nullableStateSchema = z.string().regex(US_STATE_CODE_PATTERN).nullable()
const nullablePostalCodeSchema = z
  .string()
  .regex(US_POSTAL_CODE_PATTERN)
  .nullable()

export const mapboxAddressResolveInputSchema = z.object({
  query: z.string().trim().min(1).max(256),
  country: z.array(isoCountryCodeSchema).max(10).optional(),
  language: z.string().trim().min(1).max(10).optional(),
})

const mapboxAddressCandidateSchema = z
  .object({
    addressLine1: nullableAddressLineSchema,
    addressLine2: optionalAddressLineSchema,
    city: nullableCitySchema,
    state: nullableStateSchema,
    postalCode: nullablePostalCodeSchema,
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
    candidates: z.array(mapboxAddressCandidateSchema).max(MAX_ADDRESS_CANDIDATES),
    recommendedCandidate: mapboxAddressCandidateSchema.nullable(),
    privacy: z
      .object({
        tokenSource: z.literal('env'),
        persistedByTool: z.literal(false),
        geocodingStorage: z.literal('temporary'),
        candidateCount: z
          .number()
          .int()
          .min(0)
          .max(MAX_ADDRESS_CANDIDATES),
      })
      .strict(),
    warnings: z.array(z.string().min(1)).max(1),
  })
  .strict()

const providerStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PROVIDER_STRING_LENGTH)
  .nullable()
  .optional()
const matchValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_MATCH_VALUE_LENGTH)
  .nullable()
  .optional()
const providerNamedContextSchema = z
  .object({
    name: providerStringSchema,
  })
  .passthrough()
  .optional()
const providerAddressFeatureSchema = z
  .object({
    properties: z
      .object({
        feature_type: providerStringSchema,
        name: providerStringSchema,
        context: z
          .object({
            address: z
              .object({
                address_number: providerStringSchema,
                street_name: providerStringSchema,
                name: providerStringSchema,
              })
              .passthrough()
              .optional(),
            secondary_address: z
              .object({
                designator: providerStringSchema,
                identifier: providerStringSchema,
                name: providerStringSchema,
              })
              .passthrough()
              .optional(),
            postcode: providerNamedContextSchema,
            place: providerNamedContextSchema,
            locality: providerNamedContextSchema,
            region: z
              .object({
                name: providerStringSchema,
                region_code: providerStringSchema,
              })
              .passthrough()
              .optional(),
            country: z
              .object({
                name: providerStringSchema,
                country_code: providerStringSchema,
              })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
        match_code: z
          .object({
            confidence: matchValueSchema,
            address_number: matchValueSchema,
            street: matchValueSchema,
            secondary_address: matchValueSchema,
            postcode: matchValueSchema,
            place: matchValueSchema,
            region: matchValueSchema,
            country: matchValueSchema,
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
const providerAddressResponseSchema = z
  .object({
    features: z.array(providerAddressFeatureSchema).max(10).optional(),
  })
  .passthrough()

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
type ProviderAddressFeature = z.infer<typeof providerAddressFeatureSchema>

type ExplicitMailingHints = {
  city: string | null
  localityPrefix: string | null
  postalCode: string | null
  secondaryAddress: string | null
  state: string | null
}
type ResolvedAddressCandidate = {
  candidate: MapboxAddressCandidate
  safeToAutofill: boolean
}

export async function resolveMapboxAddress(
  rawInput: MapboxAddressResolveInput,
  dependencies: MapboxAddressDependencies = {},
): Promise<MapboxAddressResolveResult> {
  const input = mapboxAddressResolveInputSchema.parse(rawInput)
  const env = dependencies.env ?? process.env
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

  const rawPayload = await fetchMapboxJson<unknown>({
    fetchImpl: dependencies.fetchImpl ?? fetch,
    timeoutMs: resolveMapboxTimeoutMs(env),
    url,
    requestLabel: 'address resolution',
  })
  const parsedPayload = providerAddressResponseSchema.safeParse(rawPayload)
  if (!parsedPayload.success) {
    throw new VaultCliError(
      'route_mapbox_response_invalid',
      'Mapbox returned an invalid address-resolution response.',
    )
  }

  const explicitMailingHints = readExplicitMailingHints(input.query)
  const resolvedCandidates = dedupeCandidates(
    (parsedPayload.data.features ?? [])
      .slice(0, MAX_ADDRESS_CANDIDATES)
      .map((feature) => buildCandidate(feature, explicitMailingHints))
      .filter(isPresent),
  )
  const candidates = resolvedCandidates.map(({ candidate }) => candidate)
  const soleCandidate =
    resolvedCandidates.length === 1 ? resolvedCandidates[0] ?? null : null
  const recommendedCandidate = soleCandidate?.safeToAutofill
    ? soleCandidate.candidate
    : null
  const result = {
    provider: {
      name: 'mapbox',
      geocodingApiVersion: MAPBOX_GEOCODING_API_VERSION,
    },
    candidates,
    recommendedCandidate,
    privacy: {
      tokenSource: 'env',
      persistedByTool: false,
      geocodingStorage: 'temporary',
      candidateCount: candidates.length,
    },
    warnings: buildWarnings(resolvedCandidates, recommendedCandidate),
  } satisfies MapboxAddressResolveResult

  return mapboxAddressResolveResultSchema.parse(result)
}

function buildCandidate(
  feature: ProviderAddressFeature,
  explicitMailingHints: ExplicitMailingHints,
): ResolvedAddressCandidate | null {
  const properties = feature.properties
  const context = properties?.context
  const featureType = normalizeLowercase(properties?.feature_type)
  const addressLine1 =
    normalizeBoundedString(
      context?.address?.name,
      MAX_ADDRESS_LINE_LENGTH,
    ) ??
    joinBoundedStrings(
      context?.address?.address_number,
      context?.address?.street_name,
      MAX_ADDRESS_LINE_LENGTH,
    ) ??
    (featureType === 'address'
      ? normalizeBoundedString(properties?.name, MAX_ADDRESS_LINE_LENGTH)
      : null)
  const addressLine2 =
    normalizeBoundedString(
      context?.secondary_address?.name,
      MAX_ADDRESS_LINE_LENGTH,
    ) ??
    (featureType === 'secondary_address'
      ? joinBoundedStrings(
          context?.secondary_address?.designator,
          context?.secondary_address?.identifier,
          MAX_ADDRESS_LINE_LENGTH,
        ) ?? normalizeBoundedString(
          properties?.name,
          MAX_ADDRESS_LINE_LENGTH,
        )
      : null)
  const candidate = {
    addressLine1,
    ...(addressLine2 ? { addressLine2 } : {}),
    city:
      normalizeBoundedString(context?.place?.name, MAX_CITY_LENGTH) ??
      normalizeBoundedString(context?.locality?.name, MAX_CITY_LENGTH),
    state: normalizeUsStateCode(context?.region?.region_code),
    postalCode: normalizePostalCode(context?.postcode?.name),
  } satisfies MapboxAddressCandidate

  if (!Object.values(candidate).some(isPresent)) {
    return null
  }

  const match = properties?.match_code
  const completeForUsMail = Boolean(
    candidate.addressLine1 &&
      candidate.city &&
      candidate.state &&
      candidate.postalCode &&
      normalizeUppercase(context?.country?.country_code) === 'US',
  )
  const secondaryAddressIsExact = candidate.addressLine2
    ? normalizeLowercase(match?.secondary_address) === 'matched'
    : featureType !== 'secondary_address'
  const suppliedMailingHintsMatch = mailingHintsMatchCandidate(
    explicitMailingHints,
    candidate,
    match,
  )
  const countryDidNotConflict =
    normalizeLowercase(match?.country) !== 'unmatched'
  const safeToAutofill = Boolean(
    completeForUsMail &&
      (featureType === 'address' || featureType === 'secondary_address') &&
      ['exact', 'high'].includes(normalizeLowercase(match?.confidence) ?? '') &&
      normalizeLowercase(match?.address_number) === 'matched' &&
      normalizeLowercase(match?.street) === 'matched' &&
      secondaryAddressIsExact &&
      suppliedMailingHintsMatch &&
      countryDidNotConflict,
  )

  return {
    candidate,
    safeToAutofill,
  }
}

function readExplicitMailingHints(query: string): ExplicitMailingHints {
  const postalCode = US_POSTAL_CODE_SEARCH_PATTERN.exec(query)?.[1] ?? null
  const withoutCountry = query.replace(TRAILING_US_COUNTRY_PATTERN, '').trim()
  const withoutPostalCode = postalCode
    ? withoutCountry
        .replace(new RegExp(`${escapeRegExp(postalCode)}\\s*$`, 'u'), '')
        .replace(/[\s,]+$/u, '')
    : withoutCountry
  const trailingState = findTrailingState(withoutPostalCode)
  const beforeState = trailingState
    ? withoutPostalCode
        .slice(0, trailingState.index)
        .replace(/[\s,]+$/u, '')
    : withoutPostalCode
  const parts = beforeState
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  let city: string | null = null
  if (parts.length >= 2) {
    const lastPart = parts.at(-1) ?? ''
    if (
      !looksLikeSecondaryAddress(lastPart) &&
      !US_POSTAL_CODE_SEARCH_PATTERN.test(lastPart)
    ) {
      city = lastPart
    }
  }

  return {
    city: normalizeComparableText(city),
    localityPrefix: trailingState && parts.length === 1
      ? normalizeComparableText(
          beforeState.replace(SECONDARY_ADDRESS_COMPONENT_PATTERN, ' '),
        )
      : null,
    postalCode,
    secondaryAddress: normalizeComparableText(
      SECONDARY_ADDRESS_COMPONENT_PATTERN.exec(query)?.[0],
    ),
    state: trailingState?.code ?? null,
  }
}

function findTrailingState(
  value: string,
): { code: string; index: number } | null {
  const normalized = value.trim()
  const labels = [
    ...US_STATE_NAMES_TO_CODES.entries(),
    ...[...US_STATE_CODES].map((code) => [code.toLowerCase(), code] as const),
  ].sort(([left], [right]) => right.length - left.length)

  for (const [label, code] of labels) {
    const match = new RegExp(
      `(?:^|[\\s,])(${escapeRegExp(label)})$`,
      'iu',
    ).exec(normalized)
    const matchedLabel = match?.[1]
    if (!match || !matchedLabel) {
      continue
    }

    return {
      code,
      index: match.index + match[0].lastIndexOf(matchedLabel),
    }
  }

  return null
}

function mailingHintsMatchCandidate(
  hints: ExplicitMailingHints,
  candidate: MapboxAddressCandidate,
  match: NonNullable<ProviderAddressFeature['properties']>['match_code'],
): boolean {
  if (
    hints.postalCode &&
    (
      candidate.postalCode !== hints.postalCode ||
      normalizeLowercase(match?.postcode) === 'unmatched'
    )
  ) {
    return false
  }
  if (
    hints.state &&
    (
      candidate.state !== hints.state ||
      normalizeLowercase(match?.region) === 'unmatched'
    )
  ) {
    return false
  }
  if (
    hints.city &&
    (
      normalizeComparableText(candidate.city) !== hints.city ||
      normalizeLowercase(match?.place) === 'unmatched'
    )
  ) {
    return false
  }
  if (hints.localityPrefix) {
    const addressLine1 = normalizeComparableText(candidate.addressLine1)
    const city = normalizeComparableText(candidate.city)
    if (!addressLine1 || hints.localityPrefix !== addressLine1) {
      if (
        !addressLine1 ||
        !city ||
        !hints.localityPrefix.startsWith(`${addressLine1} `) ||
        hints.localityPrefix.slice(addressLine1.length + 1) !== city ||
        normalizeLowercase(match?.place) === 'unmatched'
      ) {
        return false
      }
    }
  }

  const candidateSecondaryAddress = normalizeComparableText(
    candidate.addressLine2,
  )
  if (hints.secondaryAddress) {
    if (
      candidateSecondaryAddress !== hints.secondaryAddress ||
      normalizeLowercase(match?.secondary_address) !== 'matched'
    ) {
      return false
    }
  } else if (candidateSecondaryAddress) {
    return false
  }

  return true
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function looksLikeSecondaryAddress(value: string): boolean {
  return SECONDARY_ADDRESS_PREFIX_PATTERN.test(value.trim())
}

function normalizeComparableText(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
  return normalized || null
}

function dedupeCandidates(
  candidates: readonly ResolvedAddressCandidate[],
): ResolvedAddressCandidate[] {
  const candidatesByAddress = new Map<string, ResolvedAddressCandidate>()

  for (const candidate of candidates) {
    const key = Object.values(candidate.candidate)
      .map((value) => value?.toLowerCase() ?? '')
      .join('|')
    if (!candidatesByAddress.has(key)) {
      candidatesByAddress.set(key, candidate)
    }
  }

  return [...candidatesByAddress.values()]
}

function buildWarnings(
  candidates: readonly ResolvedAddressCandidate[],
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

  return [
    isCompleteCandidate(candidates[0]?.candidate)
      ? 'The mailing-address match was not strong enough to fill automatically.'
      : 'The mailing-address match did not include every required US mailing field.',
  ]
}

function isCompleteCandidate(
  candidate: MapboxAddressCandidate | undefined,
): boolean {
  return Boolean(
    candidate?.addressLine1 &&
      candidate.city &&
      candidate.state &&
      candidate.postalCode,
  )
}

function joinBoundedStrings(
  left: string | null | undefined,
  right: string | null | undefined,
  maxLength: number,
): string | null {
  const normalizedLeft = normalizeNullableString(left)
  const normalizedRight = normalizeNullableString(right)
  if (!normalizedLeft || !normalizedRight) {
    return null
  }

  return normalizeBoundedString(
    `${normalizedLeft} ${normalizedRight}`,
    maxLength,
  )
}

function normalizeUsStateCode(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeUppercase(value)
  if (!normalized) {
    return null
  }
  if (US_STATE_CODE_PATTERN.test(normalized)) {
    return normalized
  }

  return /^US-([A-Z]{2})$/u.exec(normalized)?.[1] ?? null
}

function normalizePostalCode(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)
  return normalized && US_POSTAL_CODE_PATTERN.test(normalized)
    ? normalized
    : null
}

function normalizeUppercase(
  value: string | null | undefined,
): string | null {
  return normalizeNullableString(value)?.toUpperCase() ?? null
}

function normalizeLowercase(
  value: string | null | undefined,
): string | null {
  return normalizeNullableString(value)?.toLowerCase() ?? null
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
