import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import {
  acquireDirectoryLock,
  buildProcessCommand,
  DirectoryLockHeldError,
  fingerprintHost,
  hashVaultRoot,
  isProcessRunning,
  type DirectoryLockHandle,
} from "@murphai/runtime-state/node";

import { VaultError } from "../errors.ts";
import {
  normalizeRelativeVaultPath,
  normalizeVaultRoot,
  resolveVaultPath,
} from "../path-safety.ts";
import { toIsoTimestamp } from "../time.ts";

export const CANONICAL_RESOURCE_LOCK_DIRECTORY = ".runtime/locks/canonical-resources";
export const CANONICAL_RESOURCE_LOCK_METADATA_BASENAME = "owner.json";
const DEFAULT_CANONICAL_RESOURCE_LOCK_TIMEOUT_MS = 30_000;
const MAX_CANONICAL_RESOURCE_LOCK_WAIT_MS = 250;
const CANONICAL_RESOURCE_LOCK_CLEANUP_RETRIES = 8;
const CANONICAL_RESOURCE_LOCK_CLEANUP_RETRY_DELAY_MS = 25;

export interface CanonicalMutationResource {
  key: string;
  label: string;
}

export interface CanonicalResourceLockMetadata {
  command: string;
  host: string;
  pid: number;
  resourceKey: string;
  resourceLabel: string;
  startedAt: string;
}

export interface CanonicalResourceLockHandle {
  readonly metadata: CanonicalResourceLockMetadata;
  readonly resource: CanonicalMutationResource;
  release(): Promise<void>;
}

interface CanonicalResourceLockContext {
  ownerToken: string;
  vaultRoot: string;
}

interface AcquireCanonicalResourceLockInput {
  ownerToken?: string;
  timeoutMs?: number;
  resource: CanonicalMutationResource;
  vaultRoot: string;
}

const canonicalResourceLockContextStorage = new AsyncLocalStorage<CanonicalResourceLockContext>();
const processCanonicalResourceQueues = new Map<string, Promise<void>>();

export function canonicalPathResource(relativePath: string): CanonicalMutationResource {
  const normalizedRelativePath = normalizeRelativeVaultPath(relativePath);
  return {
    key: `path:${normalizedRelativePath}`,
    label: normalizedRelativePath,
  };
}

export function canonicalLogicalResource(key: string, label = key): CanonicalMutationResource {
  const normalizedKey = String(key).trim();
  const normalizedLabel = String(label).trim();
  if (normalizedKey.length === 0 || normalizedLabel.length === 0) {
    throw new VaultError(
      "CANONICAL_RESOURCE_INVALID",
      "Canonical logical resource keys and labels must be non-empty.",
    );
  }

  return {
    key: `logical:${normalizedKey}`,
    label: normalizedLabel,
  };
}

export function dedupeCanonicalResources(
  resources: readonly CanonicalMutationResource[],
): CanonicalMutationResource[] {
  const unique = new Map<string, CanonicalMutationResource>();
  for (const resource of resources) {
    if (!unique.has(resource.key)) {
      unique.set(resource.key, resource);
    }
  }

  return [...unique.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export function isCanonicalResourceLockScopeActive(vaultRoot: string): boolean {
  const context = canonicalResourceLockContextStorage.getStore();
  return context?.vaultRoot === normalizeVaultRoot(vaultRoot);
}

export async function withCanonicalResourceLocks<TResult>(input: {
  vaultRoot: string;
  timeoutMs?: number;
  resources: readonly CanonicalMutationResource[];
  run: () => Promise<TResult>;
}): Promise<TResult> {
  const vaultRoot = normalizeVaultRoot(input.vaultRoot);
  const resources = dedupeCanonicalResources(input.resources);
  if (resources.length === 0) {
    return await input.run();
  }

  const parentContext = canonicalResourceLockContextStorage.getStore();
  const ownerToken =
    parentContext?.vaultRoot === vaultRoot ? parentContext.ownerToken : randomUUID().replace(/-/g, "");
  const context: CanonicalResourceLockContext =
    parentContext?.vaultRoot === vaultRoot
      ? parentContext
      : {
          ownerToken,
          vaultRoot,
        };
  const acquiredHandles: CanonicalResourceLockHandle[] = [];

  try {
    for (const resource of resources) {
      acquiredHandles.push(await acquireCanonicalResourceLock({
        vaultRoot,
        resource,
        timeoutMs: input.timeoutMs,
        ownerToken,
      }));
    }

    if (parentContext?.vaultRoot === vaultRoot) {
      return await input.run();
    }

    return await canonicalResourceLockContextStorage.run(context, input.run);
  } finally {
    await releaseCanonicalResourceLocks(acquiredHandles);
  }
}

export async function acquireCanonicalResourceLock(
  input: AcquireCanonicalResourceLockInput,
): Promise<CanonicalResourceLockHandle> {
  const vaultRoot = normalizeVaultRoot(input.vaultRoot);
  const context = canonicalResourceLockContextStorage.getStore();
  const ownerToken =
    input.ownerToken ??
    context?.ownerToken ??
    randomUUID().replace(/-/g, "");
  const isReentrantOwner = context?.vaultRoot === vaultRoot && context.ownerToken === ownerToken;
  const metadata = buildCanonicalResourceLockMetadata(input.resource);
  const ownerKey = `canonical-resource:${hashVaultRoot(vaultRoot)}:${input.resource.key}:${ownerToken}`;
  const { lockPath, metadataPath } = resolveCanonicalResourceLockPaths(vaultRoot, input.resource);
  const queueKey = `${hashVaultRoot(vaultRoot)}:${input.resource.key}`;
  const releaseQueue = isReentrantOwner
    ? null
    : await acquireCanonicalResourceQueueSlot(queueKey);
  const startedAt = Date.now();
  let attempt = 0;

  try {
    while (true) {
      try {
        const handle = await acquireDirectoryLock({
          ownerKey,
          lockPath,
          metadataPath,
          metadata,
          cleanupRetries: CANONICAL_RESOURCE_LOCK_CLEANUP_RETRIES,
          cleanupRetryDelayMs: CANONICAL_RESOURCE_LOCK_CLEANUP_RETRY_DELAY_MS,
          parseMetadata(value) {
            return isCanonicalResourceLockMetadata(value) ? value : null;
          },
          invalidMetadataReason: "Canonical resource lock metadata is malformed.",
          inspectStale(lockMetadata) {
            if (lockMetadata.host === fingerprintHost() && !isProcessRunning(lockMetadata.pid)) {
              return `Process ${lockMetadata.pid} is no longer running.`;
            }

            return null;
          },
        });

        let released = false;
        return {
          metadata: handle.metadata,
          resource: input.resource,
          async release() {
            if (released) {
              return;
            }

            released = true;

            try {
              await handle.release();
            } finally {
              releaseQueue?.();
            }
          },
        };
      } catch (error) {
        if (!(error instanceof DirectoryLockHeldError)) {
          throw error;
        }

        if (Date.now() - startedAt >= (input.timeoutMs ?? DEFAULT_CANONICAL_RESOURCE_LOCK_TIMEOUT_MS)) {
          throw new VaultError(
            "CANONICAL_RESOURCE_LOCKED",
            buildCanonicalResourceLockTimeoutMessage(input.resource, error.inspection.metadata),
            {
              resourceKey: input.resource.key,
              resourceLabel: input.resource.label,
              metadata: error.inspection.metadata ?? null,
            },
          );
        }

        const waitMs = Math.min(MAX_CANONICAL_RESOURCE_LOCK_WAIT_MS, 25 * 2 ** Math.min(attempt, 3));
        attempt += 1;
        await sleep(waitMs);
      }
    }
  } catch (error) {
    releaseQueue?.();
    throw error;
  }
}

async function acquireCanonicalResourceQueueSlot(queueKey: string): Promise<() => void> {
  const prior = processCanonicalResourceQueues.get(queueKey) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const tail = prior.then(
    () => queued,
    () => queued,
  );
  processCanonicalResourceQueues.set(queueKey, tail);

  await prior.catch(() => undefined);

  return () => {
    releaseQueue();
    if (processCanonicalResourceQueues.get(queueKey) === tail) {
      processCanonicalResourceQueues.delete(queueKey);
    }
  };
}

async function releaseCanonicalResourceLocks(handles: readonly CanonicalResourceLockHandle[]): Promise<void> {
  for (const handle of [...handles].reverse()) {
    await handle.release();
  }
}

function buildCanonicalResourceLockMetadata(
  resource: CanonicalMutationResource,
): CanonicalResourceLockMetadata {
  return {
    command: buildProcessCommand(),
    host: fingerprintHost(),
    pid: process.pid,
    resourceKey: resource.key,
    resourceLabel: resource.label,
    startedAt: toIsoTimestamp(new Date(), "startedAt"),
  };
}

function resolveCanonicalResourceLockPaths(
  vaultRoot: string,
  resource: CanonicalMutationResource,
): {
  lockPath: string;
  metadataPath: string;
} {
  const resourceHash = createHash("sha1").update(resource.key).digest("hex");
  const lockRelativePath = `${CANONICAL_RESOURCE_LOCK_DIRECTORY}/${resourceHash}`;
  const lockPath = resolveVaultPath(vaultRoot, lockRelativePath).absolutePath;
  const metadataPath = resolveVaultPath(
    vaultRoot,
    `${lockRelativePath}/${CANONICAL_RESOURCE_LOCK_METADATA_BASENAME}`,
  ).absolutePath;

  return {
    lockPath,
    metadataPath,
  };
}

function buildCanonicalResourceLockTimeoutMessage(
  resource: CanonicalMutationResource,
  metadata: CanonicalResourceLockMetadata | null,
): string {
  if (!metadata) {
    return `Timed out waiting for canonical resource "${resource.label}".`;
  }

  return `Timed out waiting for canonical resource "${resource.label}" held by pid=${metadata.pid}, startedAt=${metadata.startedAt}, command=${metadata.command}.`;
}

function isCanonicalResourceLockMetadata(value: unknown): value is CanonicalResourceLockMetadata {
  return Boolean(
    value &&
      typeof value === "object" &&
      "command" in value &&
      typeof (value as { command?: unknown }).command === "string" &&
      "host" in value &&
      typeof (value as { host?: unknown }).host === "string" &&
      "pid" in value &&
      typeof (value as { pid?: unknown }).pid === "number" &&
      Number.isInteger((value as { pid: number }).pid) &&
      "resourceKey" in value &&
      typeof (value as { resourceKey?: unknown }).resourceKey === "string" &&
      "resourceLabel" in value &&
      typeof (value as { resourceLabel?: unknown }).resourceLabel === "string" &&
      "startedAt" in value &&
      typeof (value as { startedAt?: unknown }).startedAt === "string",
  );
}
