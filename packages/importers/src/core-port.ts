export interface DocumentImportPayload {
  vaultRoot?: string;
  sourcePath: string;
  title: string;
  occurredAt?: string;
  note?: string;
  source?: string;
}

export interface MealImportPayload {
  vaultRoot?: string;
  photoPath: string;
  audioPath?: string;
  occurredAt?: string;
  note?: string;
  source?: string;
}

export interface SampleImportRecord {
  recordedAt: string;
  value: number;
}

export interface SampleImportRowProvenance {
  rowNumber: number;
  recordedAt: string;
  value: number;
  rawRecordedAt: string;
  rawValue: string;
  metadata?: Record<string, string>;
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
  rows?: SampleImportRowProvenance[];
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

export interface DeviceEventPayload {
  kind: string;
  occurredAt: string;
  recordedAt?: string;
  source?: string;
  title?: string;
  note?: string;
  tags?: string[];
  relatedIds?: string[];
  rawArtifactRoles?: string[];
  externalRef?: DeviceExternalRefPayload;
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
  source?: string;
  quality?: string;
  unit: string;
  externalRef?: DeviceExternalRefPayload;
  sample: DeviceSampleValuePayload;
}

export interface DeviceRawArtifactPayload {
  role: string;
  fileName: string;
  mediaType?: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}

export interface DeviceBatchImportPayload {
  vaultRoot?: string;
  provider: string;
  accountId?: string;
  importedAt?: string;
  source?: string;
  events?: DeviceEventPayload[];
  samples?: DeviceSamplePayload[];
  rawArtifacts?: DeviceRawArtifactPayload[];
  provenance?: Record<string, unknown>;
}

export interface CanonicalWritePort {
  importDocument(payload: DocumentImportPayload): unknown;
  importMeal(payload: MealImportPayload): unknown;
  importSamples(payload: SampleImportPayload): unknown;
  importDeviceBatch(payload: DeviceBatchImportPayload): unknown;
}

export type CanonicalWriteMethod = keyof CanonicalWritePort;

type CanonicalWriteAlias = CanonicalWriteMethod | "addMeal";
type PortLike = Partial<Record<CanonicalWriteAlias, (...args: readonly unknown[]) => unknown>>;

const METHOD_ALIASES = Object.freeze({
  importDocument: ["importDocument"],
  importMeal: ["importMeal", "addMeal"],
  importSamples: ["importSamples"],
  importDeviceBatch: ["importDeviceBatch"],
} satisfies Record<CanonicalWriteMethod, readonly CanonicalWriteAlias[]>);

const DEFAULT_REQUIRED_METHODS = Object.freeze(
  Object.keys(METHOD_ALIASES) as CanonicalWriteMethod[],
);

export function assertCanonicalWritePort<T extends CanonicalWriteMethod>(
  port: unknown,
  requiredMethods: readonly T[] = DEFAULT_REQUIRED_METHODS as readonly T[],
): Pick<CanonicalWritePort, T> {
  if (!port || typeof port !== "object") {
    throw new TypeError("corePort must be an object");
  }

  const candidatePort = port as PortLike;
  const resolvedPort = {} as Partial<CanonicalWritePort>;

  for (const method of requiredMethods) {
    const aliases = METHOD_ALIASES[method];
    const implementation = aliases.find((alias) => typeof candidatePort[alias] === "function");

    if (!implementation) {
      throw new TypeError(`corePort.${aliases.join(" or corePort.")} must be a function`);
    }

    const handler = candidatePort[implementation];

    if (!handler) {
      throw new TypeError(`corePort.${implementation} must be a function`);
    }

    resolvedPort[method] = handler.bind(port) as CanonicalWritePort[T];
  }

  return resolvedPort as Pick<CanonicalWritePort, T>;
}
