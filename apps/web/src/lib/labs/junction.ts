import "server-only";

import { JunctionClient as JunctionSdkClient, type BaseRequestOptions } from "@junction-api/sdk";

import type {
  HostedRuntimeLabsLocation,
  HostedRuntimeLabsLocationsRequest,
  HostedRuntimeLabsLocationsResponse,
  HostedRuntimeLabsOffering,
  HostedRuntimeLabsSearchRequest,
  HostedRuntimeLabsSearchResponse,
  HostedRuntimeLabsToolRequest,
  HostedRuntimeLabsToolResponse,
} from "@murphai/hosted-execution/labs";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isRecord } from "../primitives";

const JUNCTION_LABS_BASE_URL = "https://api.us.junction.com";
const JUNCTION_LABS_TIMEOUT_MS = 8_000;
const JUNCTION_SEARCH_RESPONSE_MAX_BYTES = 1_024 * 1_024;
const JUNCTION_AREA_RESPONSE_MAX_BYTES = 256 * 1_024;
const JUNCTION_PSC_RESPONSE_MAX_BYTES = 512 * 1_024;
const JUNCTION_MAX_PSC_LABS = 4;
const JUNCTION_PSC_CONCURRENCY = 3;
const JUNCTION_INCLUDED_MARKER_LIMIT = 40;
const JUNCTION_API_KEY_MAX_LENGTH = 512;

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface JunctionLabsDependencies {
  env?: EnvSource;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface JunctionLabsRuntime {
  apiKey: string;
  fetchImpl: typeof fetch;
  now: () => Date;
  signal?: AbortSignal;
  timeoutMs: number;
}

interface JunctionAreaLabsProjection {
  hadMalformedEntries: boolean;
  labIds: number[];
}

interface JunctionPscProjection {
  hadMalformedEntries: boolean;
  locations: JunctionLocationProjection[];
}

interface JunctionOfferingProjection {
  identity: string;
  offering: HostedRuntimeLabsOffering;
}

interface JunctionLocationProjection {
  identity: string;
  location: HostedRuntimeLabsLocation;
}

const RESPONSE_BASE = {
  orderableThroughMurph: false,
  orderingStatus: "discovery_only",
} as const;

export async function executeJunctionLabsTool(
  request: HostedRuntimeLabsToolRequest,
  dependencies: JunctionLabsDependencies = {},
): Promise<HostedRuntimeLabsToolResponse> {
  const runtime = createJunctionLabsRuntime(dependencies);

  switch (request.action) {
    case "search":
      return await searchJunctionLabs(request, runtime);
    case "locations":
      return await findJunctionLabLocations(request, runtime);
  }
}

async function searchJunctionLabs(
  request: HostedRuntimeLabsSearchRequest,
  runtime: JunctionLabsRuntime,
): Promise<HostedRuntimeLabsSearchResponse> {
  const limit = request.limit ?? 10;
  const kind = request.kind ?? "all";
  const providerSize = kind === "all"
    ? limit
    : Math.min(100, Math.max(50, limit * 5));
  const payload = await requestJunctionResource(
    runtime,
    JUNCTION_SEARCH_RESPONSE_MAX_BYTES,
    (client, requestOptions) => {
      requestOptions.queryParams = { include_pricing: "true" };
      return client.labTests.getMarkers(
        {
          aLaCarteEnabled: true,
          name: request.query,
          page: 1,
          size: providerSize,
        },
        requestOptions,
      );
    },
  );
  if (!isRecord(payload)) {
    throw labsUnavailableError(true);
  }
  const candidates = readMarkerArray(payload);
  const normalizedOfferings = candidates
    .map(normalizeJunctionOffering)
    .filter((offering): offering is JunctionOfferingProjection => offering !== null);
  if (candidates.length > 0 && normalizedOfferings.length === 0) {
    throw labsUnavailableError(true);
  }
  const items = dedupeOfferings(normalizedOfferings)
    .filter(({ offering }) => kind === "all" || offering.kind === kind)
    .slice(0, limit)
    .map(({ offering }) => offering);

  return {
    action: "search",
    ...RESPONSE_BASE,
    checkedAt: runtime.now().toISOString(),
    items,
  };
}

async function findJunctionLabLocations(
  request: HostedRuntimeLabsLocationsRequest,
  runtime: JunctionLabsRuntime,
): Promise<HostedRuntimeLabsLocationsResponse> {
  const radiusMiles = request.radiusMiles ?? 25;
  const limit = request.limit ?? 5;
  const areaPayload = await requestJunctionResource(
    runtime,
    JUNCTION_AREA_RESPONSE_MAX_BYTES,
    (client, requestOptions) => client.labTests.getAreaInfo(
      {
        radius: toJunctionAllowedRadius(radiusMiles),
        zipCode: request.zipCode,
      },
      requestOptions,
    ),
  );
  const homeCollectionAvailable = readHomeCollectionAvailable(areaPayload);
  const areaLabs = readEligibleAreaLabIds(areaPayload);
  const eligibleLabIds = areaLabs.labIds.slice(0, JUNCTION_MAX_PSC_LABS);
  const locationGroups: JunctionLocationProjection[][] = [];
  let hadMalformedCoverageData = areaLabs.hadMalformedEntries;

  for (let index = 0; index < eligibleLabIds.length; index += JUNCTION_PSC_CONCURRENCY) {
    const batch = eligibleLabIds.slice(index, index + JUNCTION_PSC_CONCURRENCY);
    const batchLocations = await Promise.all(batch.map(async (labId) => {
      const payload = await requestJunctionResource(
        runtime,
        JUNCTION_PSC_RESPONSE_MAX_BYTES,
        (client, requestOptions) => client.labTests.getPscInfo(
          {
            labId,
            radius: toJunctionAllowedRadius(radiusMiles),
            zipCode: request.zipCode,
          },
          requestOptions,
        ),
      );
      return normalizeJunctionPscLocations(payload, labId);
    }));
    for (const projection of batchLocations) {
      hadMalformedCoverageData ||= projection.hadMalformedEntries;
      locationGroups.push(projection.locations);
    }
  }

  const locations = dedupeAndSortLocations(locationGroups.flat())
    .slice(0, limit)
    .map(({ location }) => location);
  const status = homeCollectionAvailable || locations.length > 0
    ? "available"
    : "not_served";

  if (status === "not_served" && hadMalformedCoverageData) {
    throw labsUnavailableError(true);
  }

  return {
    action: "locations",
    ...RESPONSE_BASE,
    checkedAt: runtime.now().toISOString(),
    homeCollectionAvailable,
    locations,
    radiusMiles,
    status,
    zipCode: request.zipCode,
  };
}

function createJunctionLabsRuntime(
  dependencies: JunctionLabsDependencies,
): JunctionLabsRuntime {
  return {
    apiKey: requireJunctionLabsApiKey(dependencies.env ?? process.env),
    fetchImpl: dependencies.fetchImpl ?? fetch,
    now: dependencies.now ?? (() => new Date()),
    ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    timeoutMs: dependencies.timeoutMs ?? JUNCTION_LABS_TIMEOUT_MS,
  };
}

function requireJunctionLabsApiKey(source: EnvSource): string {
  const candidate = source.JUNCTION_API_KEY;

  if (
    typeof candidate !== "string"
    || candidate !== candidate.trim()
    || candidate.length === 0
    || candidate.length > JUNCTION_API_KEY_MAX_LENGTH
  ) {
    throw labsUnavailableError(false);
  }

  return candidate;
}

function toJunctionAllowedRadius(
  radiusMiles: 10 | 20 | 25 | 50,
): "10" | "20" | "25" | "50" {
  switch (radiusMiles) {
    case 10:
      return "10";
    case 20:
      return "20";
    case 25:
      return "25";
    case 50:
      return "50";
  }
}

async function requestJunctionResource<T>(
  runtime: JunctionLabsRuntime,
  maxResponseBytes: number,
  invoke: (
    client: JunctionSdkClient,
    requestOptions: BaseRequestOptions,
  ) => PromiseLike<T>,
): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();

  if (runtime.signal?.aborted) {
    controller.abort();
  } else {
    runtime.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs);
  const sdkFetch: typeof fetch = async (input, init) => {
    const response = await runtime.fetchImpl(input, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      return new Response(null, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      });
    }

    const body = await readBoundedResponseBody(response, maxResponseBytes);
    const headers = new Headers(response.headers);
    // Fetch exposes decoded bytes while retaining the wire encoding/length
    // headers. The reconstructed response contains the decoded bounded body.
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };

  const timeoutInSeconds = runtime.timeoutMs / 1_000;
  const client = new JunctionSdkClient({
    apiKey: runtime.apiKey,
    baseUrl: JUNCTION_LABS_BASE_URL,
    fetch: sdkFetch,
    headers: { accept: "application/json" },
    maxRetries: 0,
    timeoutInSeconds,
  });

  try {
    const payload = await invoke(client, {
      abortSignal: controller.signal,
      maxRetries: 0,
      timeoutInSeconds,
    });
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    return payload;
  } catch {
    throw labsUnavailableError(true);
  } finally {
    clearTimeout(timeout);
    runtime.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      await cancelResponseBody(response);
      throw new RangeError("Junction response exceeded the allowed size.");
    }
  }

  if (!response.body) {
    throw new TypeError("Junction returned an empty response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RangeError("Junction response exceeded the allowed size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The provider response is intentionally discarded.
  }
}

function readMarkerArray(value: unknown): unknown[] {
  if (!isRecord(value)) {
    throw labsUnavailableError(true);
  }

  const candidates = Array.isArray(value.data)
    ? value.data
    : Array.isArray(value.markers)
      ? value.markers
      : null;

  if (!candidates) {
    throw labsUnavailableError(true);
  }

  return candidates;
}

function normalizeJunctionOffering(value: unknown): JunctionOfferingProjection | null {
  if (!isRecord(value)) {
    return null;
  }

  const labId = readPositiveInteger(value, "lab_id", "labId");
  const providerId = readBoundedText(value.provider_id ?? value.providerId, 120);
  const name = readBoundedText(value.name, 240);
  const kind = value.type === "panel" || value.type === "biomarker"
    ? value.type
    : null;

  if (
    labId === null
    || providerId === null
    || name === null
    || kind === null
    || (value.a_la_carte_enabled ?? value.aLaCarteEnabled) !== true
    || (value.is_orderable ?? value.isOrderable) !== true
  ) {
    return null;
  }

  const includedMarkerProjection = readIncludedMarkers(value.expected_results ?? value.expectedResults);
  const providerIncludedCount = readNonnegativeInteger(
    value,
    "expected_results_count",
    "expectedResultsCount",
  );

  return {
    identity: `${labId}:${providerId}`,
    offering: {
      catalogPrice: normalizeCatalogPrice(value.price),
      commonTurnaroundDays: readNonnegativeInteger(value, "common_tat_days", "commonTatDays"),
      description: readNullableBoundedText(value.description, 8_000),
      includedMarkerCount: Math.max(
        providerIncludedCount ?? includedMarkerProjection.total,
        includedMarkerProjection.total,
      ),
      includedMarkers: includedMarkerProjection.markers,
      kind,
      maximumTurnaroundDays: readNonnegativeInteger(
        value,
        "worst_case_tat_days",
        "worstCaseTatDays",
      ),
      name,
      unit: readNullableBoundedText(value.unit, 120),
    },
  };
}

function normalizeCatalogPrice(
  value: unknown,
): HostedRuntimeLabsOffering["catalogPrice"] {
  const amount = typeof value === "string"
    ? value.trim()
    : typeof value === "number" && Number.isFinite(value) && value >= 0
      ? String(value)
      : null;

  if (
    amount === null
    || amount.length > 32
    || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(amount)
  ) {
    return null;
  }

  return {
    amount,
    currency: "USD",
  };
}

function readIncludedMarkers(value: unknown): {
  markers: HostedRuntimeLabsOffering["includedMarkers"];
  total: number;
} {
  if (!Array.isArray(value)) {
    return { markers: [], total: 0 };
  }

  const markers = value.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }
    const name = readBoundedText(candidate.name, 240);
    if (name === null) {
      return [];
    }
    return [{ name }];
  });

  return {
    markers: markers.slice(0, JUNCTION_INCLUDED_MARKER_LIMIT),
    total: markers.length,
  };
}

function readEligibleAreaLabIds(value: unknown): JunctionAreaLabsProjection {
  if (!isRecord(value)) {
    throw labsUnavailableError(true);
  }

  const centralLabs = isRecord(value.central_labs ?? value.centralLabs)
    ? value.central_labs ?? value.centralLabs
    : isRecord(value.data) && isRecord(value.data.central_labs ?? value.data.centralLabs)
      ? value.data.central_labs ?? value.data.centralLabs
      : null;

  if (!centralLabs) {
    throw labsUnavailableError(true);
  }

  let hadMalformedEntries = false;
  const labIds = Object.values(centralLabs).flatMap((candidate) => {
    if (!isRecord(candidate)) {
      hadMalformedEntries = true;
      return [];
    }

    const labId = readPositiveInteger(candidate, "lab_id", "labId");
    const rawPatientServiceCenters =
      candidate.patient_service_centers ?? candidate.patientServiceCenters;
    const patientServiceCenters = isRecord(rawPatientServiceCenters)
      ? rawPatientServiceCenters
      : candidate;
    const withinRadius = readNonnegativeInteger(
      patientServiceCenters,
      "within_radius",
      "withinRadius",
    );

    if (labId === null || withinRadius === null) {
      hadMalformedEntries = true;
      return [];
    }

    return withinRadius > 0 ? [labId] : [];
  });
  const uniqueLabIds = [...new Set(labIds)].sort((left, right) => left - right);

  return {
    hadMalformedEntries,
    labIds: uniqueLabIds,
  };
}

function readHomeCollectionAvailable(value: unknown): boolean {
  if (!isRecord(value)) {
    throw labsUnavailableError(true);
  }

  const root = isRecord(value.data) ? value.data : value;
  if (
    !isRecord(root.phlebotomy)
    || typeof (root.phlebotomy.is_served ?? root.phlebotomy.isServed) !== "boolean"
  ) {
    throw labsUnavailableError(true);
  }

  return (root.phlebotomy.is_served ?? root.phlebotomy.isServed) as boolean;
}

function normalizeJunctionPscLocations(
  value: unknown,
  requestedLabId: number,
): JunctionPscProjection {
  if (!isRecord(value)) {
    throw labsUnavailableError(true);
  }

  const root = isRecord(value.data) ? value.data : value;
  const responseLabId = readPositiveInteger(root, "lab_id", "labId");
  if (responseLabId !== null && responseLabId !== requestedLabId) {
    throw labsUnavailableError(true);
  }

  const patientServiceCenters = root.patient_service_centers ?? root.patientServiceCenters;
  if (!Array.isArray(patientServiceCenters)) {
    throw labsUnavailableError(true);
  }

  let hadMalformedEntries = false;
  const locations = patientServiceCenters.flatMap((candidate) => {
    const location = normalizeJunctionPscLocation(candidate, requestedLabId);
    if (!location) {
      hadMalformedEntries = true;
      return [];
    }
    return [location];
  });

  return { hadMalformedEntries, locations };
}

function normalizeJunctionPscLocation(
  value: unknown,
  labId: number,
): JunctionLocationProjection | null {
  if (!isRecord(value) || !isRecord(value.metadata)) {
    return null;
  }

  const metadata = value.metadata;
  const siteCode = readBoundedText(value.site_code ?? value.siteCode, 120);
  const name = readBoundedText(metadata.name, 240);
  const line1 = readBoundedText(metadata.first_line ?? metadata.firstLine, 240);
  const city = readBoundedText(metadata.city, 120);
  const state = normalizeState(metadata.state);
  const postalCode = normalizePostalCode(metadata.zip_code ?? metadata.zipCode);
  const distanceMiles = readNonnegativeFiniteNumber(value.distance);

  if (
    siteCode === null
    || name === null
    || line1 === null
    || city === null
    || state === null
    || postalCode === null
    || distanceMiles === null
    || distanceMiles > 1_000
  ) {
    return null;
  }

  return {
    identity: `${labId}:${siteCode}`,
    location: {
      address: {
        city,
        line1,
        line2: readNullableBoundedText(metadata.second_line ?? metadata.secondLine, 240),
        postalCode,
        state,
      },
      coordinates: normalizeCoordinates(value.location),
      distanceMiles,
      name,
      phoneNumber: readNullableBoundedText(metadata.phone_number ?? metadata.phoneNumber, 40),
    },
  };
}

function normalizeCoordinates(
  value: unknown,
): HostedRuntimeLabsLocation["coordinates"] {
  if (!isRecord(value)) {
    return null;
  }

  const latitude = readFiniteNumber(value.lat ?? value.latitude);
  const longitude = readFiniteNumber(value.lng ?? value.longitude);

  if (
    latitude === null
    || longitude === null
    || latitude < -90
    || latitude > 90
    || longitude < -180
    || longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function dedupeAndSortLocations(
  locations: JunctionLocationProjection[],
): JunctionLocationProjection[] {
  const bySite = new Map<string, JunctionLocationProjection>();

  for (const projection of locations) {
    const previous = bySite.get(projection.identity);
    if (!previous || projection.location.distanceMiles < previous.location.distanceMiles) {
      bySite.set(projection.identity, projection);
    }
  }

  return [...bySite.values()].sort((left, right) =>
    left.location.distanceMiles - right.location.distanceMiles
      || left.location.name.localeCompare(right.location.name)
      || left.identity.localeCompare(right.identity));
}

function dedupeOfferings(
  offerings: JunctionOfferingProjection[],
): JunctionOfferingProjection[] {
  const seen = new Set<string>();
  return offerings.filter((offering) => {
    if (seen.has(offering.identity)) {
      return false;
    }
    seen.add(offering.identity);
    return true;
  });
}

function readPositiveInteger(
  value: Record<string, unknown>,
  ...keys: readonly string[]
): number | null {
  const candidate = keys.map((key) => value[key]).find((entry) => entry !== undefined);
  return typeof candidate === "number"
    && Number.isSafeInteger(candidate)
    && candidate > 0
    ? candidate
    : null;
}

function readNonnegativeInteger(
  value: Record<string, unknown>,
  ...keys: readonly string[]
): number | null {
  const candidate = keys.map((key) => value[key]).find((entry) => entry !== undefined);
  return typeof candidate === "number"
    && Number.isSafeInteger(candidate)
    && candidate >= 0
    ? candidate
    : null;
}

function readBoundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : null;
}

function readNullableBoundedText(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return readBoundedText(value, maxLength);
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readNonnegativeFiniteNumber(value: unknown): number | null {
  const candidate = readFiniteNumber(value);
  return candidate !== null && candidate >= 0 ? candidate : null;
}

function normalizeState(value: unknown): string | null {
  const candidate = readBoundedText(value, 2)?.toUpperCase() ?? null;
  return candidate && /^[A-Z]{2}$/u.test(candidate) ? candidate : null;
}

function normalizePostalCode(value: unknown): string | null {
  const candidate = readBoundedText(value, 10);
  return candidate && /^\d{5}(?:-\d{4})?$/u.test(candidate) ? candidate : null;
}

function labsUnavailableError(retryable: boolean) {
  return hostedOnboardingError({
    code: "LABS_TEMPORARILY_UNAVAILABLE",
    httpStatus: 503,
    message: "Labs are temporarily unavailable. Please try again later.",
    retryable,
  });
}
