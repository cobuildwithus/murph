import type { DeviceDataOrigin as ContractDeviceDataOrigin, EventSource, MealNutrition } from "@murphai/contracts";

export interface DocumentImportPayload {
  vaultRoot?: string;
  sourcePath: string;
  title: string;
  occurredAt?: string;
  note?: string;
  source?: EventSource;
  reuseExact?: boolean;
}

export interface MealImportPayload {
  vaultRoot?: string;
  photoPath?: string;
  audioPath?: string;
  occurredAt?: string;
  note?: string;
  source?: EventSource;
  ingredients?: string[];
  nutrition?: MealNutrition;
  externalRef?: DeviceExternalRefPayload;
}

export interface SampleImportRecord {
  recordedAt: string;
  value: number;
}

export interface SampleImportSkipReasonCount {
  count: number;
  reason: string;
}

export interface SampleImportConfig {
  presetId?: string;
  delimiter: string;
  tsColumn: string;
  valueColumn: string;
  metadataColumns?: string[];
}

export interface SampleImportBatchProvenance {
  sourceFileName?: string;
  importConfig?: SampleImportConfig;
  rowCount?: number;
  skippedCount?: number;
  skipReasons?: SampleImportSkipReasonCount[];
}

export interface SampleImportPayload {
  vaultRoot?: string;
  stream: string;
  unit: string;
  source?: string;
  sourcePath: string;
  importConfig: SampleImportConfig;
  samples: SampleImportRecord[];
  batchProvenance?: SampleImportBatchProvenance;
}

export interface DeviceExternalRefPayload {
  system: string;
  resourceType: string;
  resourceId: string;
  version?: string;
  facet?: string;
}

export type DeviceDataOrigin = ContractDeviceDataOrigin;

export interface DeviceEventLinkPayload {
  type: string;
  targetId: string;
}

export interface DeviceEventPayload {
  kind: string;
  occurredAt: string;
  recordedAt?: string;
  dayKey?: string;
  timeZone?: string;
  source?: string;
  title?: string;
  note?: string;
  tags?: string[];
  links?: DeviceEventLinkPayload[];
  evidenceRoles?: string[];
  externalRef?: DeviceExternalRefPayload;
  externalRefUpdatePolicy?: "immutable";
  legacyExternalRefs?: DeviceExternalRefPayload[];
  dataOrigin?: DeviceDataOrigin;
  fields?: Record<string, unknown>;
}

export interface DeviceSampleValuePayload {
  recordedAt?: string;
  occurredAt?: string;
  value?: number;
  stage?: string;
  startAt?: string;
  endAt?: string;
  durationMinutes?: number;
}

export interface DeviceSamplePayload {
  stream: string;
  recordedAt?: string;
  dayKey?: string;
  timeZone?: string;
  source?: string;
  quality?: string;
  unit: string;
  externalRef?: DeviceExternalRefPayload;
  dataOrigin?: DeviceDataOrigin;
  sample: DeviceSampleValuePayload;
}

export interface DeviceEvidencePartPayload {
  role: string;
  fileName: string;
  mediaType?: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}

export interface DeviceAuthoritativeEventSetPayload {
  system: string;
  resourceType: string;
  resourceId: string;
  version: string;
  facetPrefixes: string[];
  currentFacets: string[];
}

export interface DeviceBatchImportPayload {
  vaultRoot?: string;
  provider: string;
  accountId?: string;
  importedAt?: string;
  source?: string;
  dataOrigin?: DeviceDataOrigin;
  events?: DeviceEventPayload[];
  samples?: DeviceSamplePayload[];
  evidenceParts?: DeviceEvidencePartPayload[];
  authoritativeEventSets?: DeviceAuthoritativeEventSetPayload[];
  ingestReceipt?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface CanonicalWritePort {
  importDocument(payload: DocumentImportPayload): unknown;
  addMeal(payload: MealImportPayload): unknown;
  importSamples(payload: SampleImportPayload): unknown;
  importDeviceBatch(payload: DeviceBatchImportPayload): unknown;
}

export type CanonicalWriteMethod = keyof CanonicalWritePort;

type PortLike = Partial<Record<CanonicalWriteMethod, (...args: readonly unknown[]) => unknown>>;

const DEFAULT_REQUIRED_METHODS = Object.freeze([
  "importDocument",
  "addMeal",
  "importSamples",
  "importDeviceBatch",
] satisfies readonly CanonicalWriteMethod[]);

export function assertCanonicalWritePort<T extends CanonicalWriteMethod>(
  port: unknown,
  requiredMethods: readonly T[] = DEFAULT_REQUIRED_METHODS as readonly T[],
): Pick<CanonicalWritePort, T> {
  if (!port || typeof port !== "object") {
    throw new TypeError("corePort must be an object");
  }

  const candidatePort = port as PortLike;
  const resolvedPort: Partial<CanonicalWritePort> = {};

  for (const method of requiredMethods) {
    const handler = candidatePort[method];
    if (typeof handler !== "function") {
      throw new TypeError(`corePort.${method} must be a function`);
    }

    resolvedPort[method] = handler.bind(port) as CanonicalWritePort[T];
  }

  return resolvedPort as Pick<CanonicalWritePort, T>;
}
