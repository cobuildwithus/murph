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

export interface SampleImportConfig {
  presetId?: string;
  delimiter: string;
  tsColumn: string;
  valueColumn: string;
  metadataColumns?: string[];
}

export interface SampleImportPayload {
  vaultRoot?: string;
  stream: string;
  unit: string;
  source?: string;
  sourcePath: string;
  importConfig: SampleImportConfig;
  samples: SampleImportRecord[];
}

export interface CanonicalWritePort {
  importDocument(payload: DocumentImportPayload): unknown;
  importMeal(payload: MealImportPayload): unknown;
  importSamples(payload: SampleImportPayload): unknown;
}

export type CanonicalWriteMethod = keyof CanonicalWritePort;

type CanonicalWriteAlias = CanonicalWriteMethod | "addMeal";
type PortLike = Partial<Record<CanonicalWriteAlias, (...args: readonly unknown[]) => unknown>>;

const METHOD_ALIASES = Object.freeze({
  importDocument: ["importDocument"],
  importMeal: ["importMeal", "addMeal"],
  importSamples: ["importSamples"],
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
