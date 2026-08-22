import { Buffer } from "node:buffer";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, vi } from "vitest";

const STATE_CARDINALITIES = [1, 8, 128, 256] as const;
const PATH_METADATA_READ_METHODS = [
  "access",
  "lstat",
  "readlink",
  "realpath",
  "stat",
] as const;
const PATH_METADATA_SYNC_READ_METHODS = [
  "accessSync",
  "existsSync",
  "lstatSync",
  "readlinkSync",
  "realpathSync",
  "statSync",
] as const;

interface FileSystemReadWork {
  directoryEntries: number;
  largestReadBytes: number;
  readBytes: number;
  readOperations: number;
}

export function describeStateCardinality(
  name: string,
  factory: () => void,
): void {
  const suite = process.env.MURPH_TEST_STATE_CARDINALITY === "1"
    ? describe
    : describe.skip;
  suite(name, factory);
}

/**
 * Covers one foreground boundary against one unrelated persisted-state family.
 * `prepare` creates valid unrelated records through production writers.
 * Production code under measurement loads only from `loadOperation`, after the
 * shared filesystem meter is installed.
 */
export interface StateCardinalityProbe {
  name: string;
  prepare(cardinality: number): Promise<{
    root: string;
    loadOperation(): Promise<() => Promise<void>>;
  }>;
}

export async function assertStateCardinalityInvariant(
  input: StateCardinalityProbe,
): Promise<void> {
  const samples: Array<{
    cardinality: number;
    metrics: FileSystemReadWork;
  }> = [];
  for (const cardinality of STATE_CARDINALITIES) {
    samples.push({
      cardinality,
      metrics: await measureFileSystemReadWork(
        await input.prepare(cardinality),
      ),
    });
  }

  const failures = validateSamples(samples);
  const plateauReference = samples.at(-2)!;
  const largestSample = samples.at(-1)!;
  for (
    const metricName of Object.keys(plateauReference.metrics) as Array<
      keyof FileSystemReadWork
    >
  ) {
    const referenceValue = plateauReference.metrics[metricName];
    const largestValue = largestSample.metrics[metricName];
    if (largestValue !== referenceValue) {
      failures.push(
        `${metricName} changed from ${referenceValue} at cardinality ${plateauReference.cardinality} to ${largestValue} at cardinality ${largestSample.cardinality}; foreground work must be fully saturated above the shared bound`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error([
      `State-cardinality invariant failed for ${input.name}.`,
      ...failures.map((failure) => `- ${failure}`),
      "Samples:",
      ...samples.map((sample) =>
        `- ${sample.cardinality}: ${JSON.stringify(sample.metrics)}`
      ),
    ].join("\n"));
  }
}

function validateSamples(
  samples: ReadonlyArray<{
    cardinality: number;
    metrics: FileSystemReadWork;
  }>,
): string[] {
  const failures: string[] = [];
  for (const sample of samples) {
    for (
      const metricName of Object.keys(sample.metrics) as Array<
        keyof FileSystemReadWork
      >
    ) {
      const value = sample.metrics[metricName];
      if (!Number.isFinite(value) || value < 0) {
        failures.push(
          `${metricName}=${String(value)} at cardinality ${sample.cardinality} is invalid`,
        );
      }
    }
  }
  return failures;
}

async function measureFileSystemReadWork(input: {
  root: string;
  loadOperation(): Promise<() => Promise<void>>;
}): Promise<FileSystemReadWork> {
  const measuredRoot = path.resolve(input.root);
  const work: FileSystemReadWork = {
    directoryEntries: 0,
    largestReadBytes: 0,
    readBytes: 0,
    readOperations: 0,
  };

  vi.resetModules();
  const restoreFileSystem = installFileSystemReadMeter(measuredRoot, work);
  try {
    const operation = await input.loadOperation();
    await operation();
    return { ...work };
  } finally {
    restoreFileSystem();
    vi.resetModules();
  }
}

function installFileSystemReadMeter(
  measuredRoot: string,
  work: FileSystemReadWork,
): () => void {
  const restorers: Array<() => void> = [];
  let supportedSyncReadDepth = 0;
  const patch = (
    target: object,
    property: string,
    replacement: (...args: unknown[]) => unknown,
  ): void => {
    restorers.push(replaceMethod(target, property, replacement));
  };

  const promiseReadFile = readMethod(fs.promises, "readFile");
  patch(fs.promises, "readFile", async (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const result: unknown = await Reflect.apply(
      promiseReadFile,
      fs.promises,
      args,
    );
    if (measured) {
      recordReadBytes(result, work);
    }
    return result;
  });

  const promiseReaddir = readMethod(fs.promises, "readdir");
  patch(fs.promises, "readdir", async (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const entries: unknown = await Reflect.apply(
      promiseReaddir,
      fs.promises,
      args,
    );
    if (!Array.isArray(entries)) {
      throw new TypeError("Expected readdir to return an array.");
    }
    if (measured) {
      recordDirectoryEntries(entries, work);
    }
    return entries;
  });

  const promiseOpen = readMethod(fs.promises, "open");
  patch(fs.promises, "open", async (...args: unknown[]) => {
    const measured = openFlagsMayRead(args[1])
      ? beginMeasuredRead(args[0], measuredRoot, work)
      : false;
    const handle = await Reflect.apply(promiseOpen, fs.promises, args);
    return measured ? wrapFileHandle(handle, work) : handle;
  });

  const promiseOpendir = readMethod(fs.promises, "opendir");
  patch(fs.promises, "opendir", async (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const directory = await Reflect.apply(promiseOpendir, fs.promises, args);
    return measured ? wrapDirectoryHandle(directory, work) : directory;
  });

  for (const method of PATH_METADATA_READ_METHODS) {
    const promiseMethod = readMethod(fs.promises, method);
    patch(fs.promises, method, async (...args: unknown[]) => {
      beginMeasuredRead(args[0], measuredRoot, work);
      return await Reflect.apply(promiseMethod, fs.promises, args);
    });
  }

  const readFile = readMethod(fs, "readFile");
  patch(fs, "readFile", (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const callbackIndex = typeof args[1] === "function" ? 1 : 2;
    const callback = args[callbackIndex];
    if (typeof callback !== "function") {
      return Reflect.apply(readFile, fs, args);
    }
    const measuredArgs = [...args];
    measuredArgs[callbackIndex] = (error: unknown, result: unknown) => {
      if (error == null && measured) {
        recordReadBytes(result, work);
      }
      Reflect.apply(callback, undefined, [error, result]);
    };
    return Reflect.apply(readFile, fs, measuredArgs);
  });

  const readdir = readMethod(fs, "readdir");
  patch(fs, "readdir", (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const callbackIndex = typeof args[1] === "function" ? 1 : 2;
    const callback = args[callbackIndex];
    if (typeof callback !== "function") {
      return Reflect.apply(readdir, fs, args);
    }
    const measuredArgs = [...args];
    measuredArgs[callbackIndex] = (error: unknown, entries: unknown) => {
      if (error == null && measured) {
        if (!Array.isArray(entries)) {
          throw new TypeError("Expected readdir to return an array.");
        }
        recordDirectoryEntries(entries, work);
      }
      Reflect.apply(callback, undefined, [error, entries]);
    };
    return Reflect.apply(readdir, fs, measuredArgs);
  });

  const opendir = readMethod(fs, "opendir");
  patch(fs, "opendir", (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const callbackIndex = typeof args[1] === "function" ? 1 : 2;
    const callback = args[callbackIndex];
    if (typeof callback !== "function") {
      return Reflect.apply(opendir, fs, args);
    }
    const measuredArgs = [...args];
    measuredArgs[callbackIndex] = (error: unknown, directory: unknown) => {
      Reflect.apply(callback, undefined, [
        error,
        error == null && measured
          ? wrapDirectoryHandle(directory, work)
          : directory,
      ]);
    };
    return Reflect.apply(opendir, fs, measuredArgs);
  });

  const callbackOpen = readMethod(fs, "open");
  patch(fs, "open", (...args: unknown[]) => {
    failUnsupportedPathRead(
      args[0],
      openFlagsMayRead(args[1]),
      "callback open/read",
      measuredRoot,
    );
    return Reflect.apply(callbackOpen, fs, args);
  });

  const createReadStream = readMethod(fs, "createReadStream");
  patch(fs, "createReadStream", (...args: unknown[]) => {
    failUnsupportedPathRead(
      args[0],
      true,
      "createReadStream",
      measuredRoot,
    );
    return Reflect.apply(createReadStream, fs, args);
  });

  for (const method of PATH_METADATA_READ_METHODS) {
    const callbackMethod = readMethod(fs, method);
    patch(fs, method, (...args: unknown[]) => {
      beginMeasuredRead(args[0], measuredRoot, work);
      return Reflect.apply(callbackMethod, fs, args);
    });
  }

  const readFileSync = readMethod(fs, "readFileSync");
  patch(fs, "readFileSync", (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    supportedSyncReadDepth += 1;
    try {
      const result: unknown = Reflect.apply(readFileSync, fs, args);
      if (measured) {
        recordReadBytes(result, work);
      }
      return result;
    } finally {
      supportedSyncReadDepth -= 1;
    }
  });

  const readdirSync = readMethod(fs, "readdirSync");
  patch(fs, "readdirSync", (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const entries: unknown = Reflect.apply(readdirSync, fs, args);
    if (!Array.isArray(entries)) {
      throw new TypeError("Expected readdirSync to return an array.");
    }
    if (measured) {
      recordDirectoryEntries(entries, work);
    }
    return entries;
  });

  const opendirSync = readMethod(fs, "opendirSync");
  patch(fs, "opendirSync", (...args: unknown[]) => {
    const measured = beginMeasuredRead(args[0], measuredRoot, work);
    const directory = Reflect.apply(opendirSync, fs, args);
    return measured ? wrapDirectoryHandle(directory, work) : directory;
  });

  const openSync = readMethod(fs, "openSync");
  patch(fs, "openSync", (...args: unknown[]) => {
    if (supportedSyncReadDepth === 0) {
      failUnsupportedPathRead(
        args[0],
        openFlagsMayRead(args[1]),
        "openSync/readSync",
        measuredRoot,
      );
    }
    return Reflect.apply(openSync, fs, args);
  });

  for (const method of PATH_METADATA_SYNC_READ_METHODS) {
    const syncMethod = readMethod(fs, method);
    patch(fs, method, (...args: unknown[]) => {
      beginMeasuredRead(args[0], measuredRoot, work);
      return Reflect.apply(syncMethod, fs, args);
    });
  }

  syncBuiltinESMExports();

  return () => {
    for (const restore of restorers.reverse()) {
      restore();
    }
    syncBuiltinESMExports();
  };
}

function wrapFileHandle(handle: unknown, work: FileSystemReadWork): unknown {
  if (!handle || typeof handle !== "object") {
    throw new TypeError("Expected open to return a FileHandle.");
  }
  return new Proxy(handle, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") {
        return value;
      }
      if (property === "read" || property === "readv") {
        return async (...args: unknown[]) => {
          work.readOperations += 1;
          const result = await Reflect.apply(value, target, args);
          recordReadByteCount(readBytesRead(result), work);
          return result;
        };
      }
      if (property === "readFile") {
        return async (...args: unknown[]) => {
          work.readOperations += 1;
          const result = await Reflect.apply(value, target, args);
          recordReadBytes(result, work);
          return result;
        };
      }
      if (property === "stat") {
        return async (...args: unknown[]) => {
          work.readOperations += 1;
          return await Reflect.apply(value, target, args);
        };
      }
      if (
        property === "createReadStream" ||
        property === "readableWebStream" ||
        property === "readLines"
      ) {
        return () => {
          throw new Error(
            `State-cardinality meter does not support FileHandle.${String(property)}; extend the shared meter before admitting this foreground read primitive.`,
          );
        };
      }
      return value.bind(target);
    },
  });
}

function wrapDirectoryHandle(
  directory: unknown,
  work: FileSystemReadWork,
): unknown {
  if (!directory || typeof directory !== "object") {
    throw new TypeError("Expected opendir to return a Dir.");
  }
  return new Proxy(directory, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") {
        return value;
      }
      if (property === "read") {
        return (...args: unknown[]) => {
          const callback = args.at(-1);
          if (typeof callback === "function") {
            const measuredArgs = [...args];
            measuredArgs[measuredArgs.length - 1] = (
              error: unknown,
              entry: unknown,
            ) => {
              if (error == null) {
                recordDirectoryEntry(entry, work);
              }
              Reflect.apply(callback, undefined, [error, entry]);
            };
            return Reflect.apply(value, target, measuredArgs);
          }
          return Promise.resolve(Reflect.apply(value, target, args)).then(
            (entry) => {
              recordDirectoryEntry(entry, work);
              return entry;
            },
          );
        };
      }
      if (property === "readSync") {
        return (...args: unknown[]) => {
          const entry = Reflect.apply(value, target, args);
          recordDirectoryEntry(entry, work);
          return entry;
        };
      }
      if (property === Symbol.asyncIterator) {
        return async function* () {
          const entries = Reflect.apply(value, target, []) as AsyncIterable<unknown>;
          for await (const entry of entries) {
            recordDirectoryEntry(entry, work);
            yield entry;
          }
        };
      }
      return value.bind(target);
    },
  });
}

function readBytesRead(result: unknown): number {
  if (
    !result ||
    typeof result !== "object" ||
    !("bytesRead" in result) ||
    typeof result.bytesRead !== "number"
  ) {
    throw new TypeError("Expected FileHandle read to report bytesRead.");
  }
  return result.bytesRead;
}

function openFlagsMayRead(flags: unknown): boolean {
  if (typeof flags === "number") {
    return (flags & 0b11) !== fs.constants.O_WRONLY;
  }
  if (typeof flags === "string") {
    return flags.startsWith("r") || flags.includes("+");
  }
  return true;
}

function failUnsupportedPathRead(
  candidate: unknown,
  readable: boolean,
  primitive: string,
  root: string,
): void {
  if (readable && isPathWithinRoot(candidate, root)) {
    throw new Error(
      `State-cardinality meter does not support ${primitive}; extend the shared meter before admitting this foreground read primitive.`,
    );
  }
}

function readMethod(
  target: object,
  property: string,
): (...args: unknown[]) => unknown {
  const value = Reflect.get(target, property);
  if (typeof value !== "function") {
    throw new Error(`Expected filesystem method ${property}.`);
  }
  return value;
}

function replaceMethod(
  target: object,
  property: string,
  replacement: (...args: unknown[]) => unknown,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  if (!descriptor || !("value" in descriptor)) {
    throw new Error(`Expected writable filesystem method ${property}.`);
  }
  Object.defineProperty(target, property, {
    ...descriptor,
    value: replacement,
  });
  return () => {
    Object.defineProperty(target, property, descriptor);
  };
}

function beginMeasuredRead(
  candidate: unknown,
  root: string,
  work: FileSystemReadWork,
): boolean {
  if (!isPathWithinRoot(candidate, root)) {
    return false;
  }
  work.readOperations += 1;
  return true;
}

function recordReadBytes(
  result: unknown,
  work: FileSystemReadWork,
): void {
  const bytes = typeof result === "string"
    ? Buffer.byteLength(result, "utf8")
    : Buffer.isBuffer(result)
      ? result.byteLength
      : result instanceof Uint8Array
        ? result.byteLength
        : null;
  if (bytes === null) {
    throw new TypeError("Expected a filesystem read to return text or bytes.");
  }
  recordReadByteCount(bytes, work);
}

function recordReadByteCount(bytes: number, work: FileSystemReadWork): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new TypeError(`Invalid filesystem byte count: ${String(bytes)}.`);
  }
  work.readBytes += bytes;
  work.largestReadBytes = Math.max(work.largestReadBytes, bytes);
}

function recordDirectoryEntries(
  entries: readonly unknown[],
  work: FileSystemReadWork,
): void {
  work.directoryEntries += entries.length;
}

function recordDirectoryEntry(entry: unknown, work: FileSystemReadWork): void {
  if (entry !== null && entry !== undefined) {
    work.directoryEntries += 1;
  }
}

function isPathWithinRoot(candidate: unknown, root: string): boolean {
  const candidatePath = normalizeFileSystemPath(candidate);
  if (!candidatePath) {
    return false;
  }
  const relative = path.relative(root, path.resolve(candidatePath));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function normalizeFileSystemPath(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof URL) {
    return value.protocol === "file:" ? fileURLToPath(value) : null;
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : null;
}
