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
  isVaultFilesystemCaseInsensitive,
  normalizeRelativeVaultPath,
  normalizeRelativeVaultPathForComparison,
  normalizeVaultRoot,
  resolveVaultPath,
  type VaultPathComparisonOptions,
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
  acquisitionQueueTail: Promise<void>;
  heldResourceStates: Map<string, HeldCanonicalResourceState>;
  heldResources: CanonicalMutationResource[];
  ownerToken: string;
  vaultRoot: string;
}

interface HeldCanonicalResourceState {
  depth: number;
  releaseUnderlying: () => Promise<void>;
}

interface AcquireCanonicalResourceLockInput {
  ownerToken?: string;
  timeoutMs?: number;
  resource: CanonicalMutationResource;
  vaultRoot: string;
}

const canonicalResourceLockContextStorage = new AsyncLocalStorage<CanonicalResourceLockContext>();
const processCanonicalResourceQueues = new Map<string, Promise<void>>();

function findHeldCanonicalResource(
  context: CanonicalResourceLockContext,
  resourceKey: string,
): CanonicalMutationResource | undefined {
  return context.heldResources.find((resource) => resource.key === resourceKey);
}

function getHeldCanonicalResourceDepth(
  context: CanonicalResourceLockContext,
  resourceKey: string,
): number {
  return context.heldResourceStates.get(resourceKey)?.depth ?? 0;
}

function trackHeldCanonicalResource(
  context: CanonicalResourceLockContext,
  resource: CanonicalMutationResource,
  releaseUnderlying: () => Promise<void>,
): void {
  const existingState = context.heldResourceStates.get(resource.key);
  if (existingState) {
    existingState.depth += 1;
    return;
  }

  context.heldResourceStates.set(resource.key, {
    depth: 1,
    releaseUnderlying,
  });
  context.heldResources = dedupeCanonicalResources([...context.heldResources, resource]);
}

async function releaseHeldCanonicalResource(
  context: CanonicalResourceLockContext,
  resourceKey: string,
): Promise<void> {
  const currentState = context.heldResourceStates.get(resourceKey);
  if (!currentState) {
    return;
  }

  if (currentState.depth > 1) {
    currentState.depth -= 1;
    return;
  }

  context.heldResourceStates.delete(resourceKey);
  const nextHeldResources = context.heldResources.filter((resource) => resource.key !== resourceKey);
  if (nextHeldResources.length !== context.heldResources.length) {
    context.heldResources = nextHeldResources;
  }

  await currentState.releaseUnderlying();
}

function assertCanonicalResourceLockOrdering(
  context: CanonicalResourceLockContext,
  resource: CanonicalMutationResource,
): CanonicalMutationResource | undefined {
  const heldResource = findHeldCanonicalResource(context, resource.key);
  if (heldResource) {
    return heldResource;
  }

  const highestHeldResource = context.heldResources[context.heldResources.length - 1];
  if (highestHeldResource && highestHeldResource.key.localeCompare(resource.key) > 0) {
    throw new VaultError(
      "CANONICAL_RESOURCE_LOCK_ORDER",
      buildCanonicalResourceLockOrderingMessage(resource, highestHeldResource),
      {
        highestHeldResourceKey: highestHeldResource.key,
        highestHeldResourceLabel: highestHeldResource.label,
        heldResourceKeys: context.heldResources.map((heldResource) => heldResource.key),
        resourceKey: resource.key,
        resourceLabel: resource.label,
      },
    );
  }

  return undefined;
}

async function acquireCanonicalResourceScopeQueueSlot(
  context: CanonicalResourceLockContext,
): Promise<() => void> {
  const prior = context.acquisitionQueueTail;
  let releaseQueue!: () => void;
  const queued = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const tail = prior.then(
    () => queued,
    () => queued,
  );
  context.acquisitionQueueTail = tail;

  await prior.catch(() => undefined);

  return () => {
    releaseQueue();
    if (context.acquisitionQueueTail === tail) {
      context.acquisitionQueueTail = Promise.resolve();
    }
  };
}

export function canonicalPathResource(
  relativePath: string,
  options: VaultPathComparisonOptions = {},
): CanonicalMutationResource {
  const normalizedRelativePath = normalizeRelativeVaultPath(relativePath);
  return {
    key: `path:${normalizeRelativeVaultPathForComparison(normalizedRelativePath, options)}`,
    label: normalizedRelativePath,
  };
}

export async function canonicalPathResourceForVault(
  vaultRoot: string,
  relativePath: string,
): Promise<CanonicalMutationResource> {
  return canonicalPathResource(relativePath, {
    caseInsensitive: await isVaultFilesystemCaseInsensitive(vaultRoot),
  });
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
          acquisitionQueueTail: Promise.resolve(),
          heldResourceStates: new Map(),
          heldResources: [],
          ownerToken,
          vaultRoot,
        };
  const executeWithLocks = async (): Promise<TResult> => {
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

      return await input.run();
    } finally {
      await releaseCanonicalResourceLocks(acquiredHandles);
    }
  };

  if (parentContext?.vaultRoot === vaultRoot) {
    return await executeWithLocks();
  }

  return await canonicalResourceLockContextStorage.run(context, executeWithLocks);
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
  const sameScopeContext =
    context?.vaultRoot === vaultRoot && context.ownerToken === ownerToken ? context : null;
  const releaseScopeQueue = sameScopeContext
    ? await acquireCanonicalResourceScopeQueueSlot(sameScopeContext)
    : null;
  const metadata = buildCanonicalResourceLockMetadata(input.resource);
  const ownerKey = `canonical-resource:${hashVaultRoot(vaultRoot)}:${input.resource.key}:${ownerToken}`;
  const { lockPath, metadataPath } = resolveCanonicalResourceLockPaths(vaultRoot, input.resource);
  const queueKey = `${hashVaultRoot(vaultRoot)}:${input.resource.key}`;

  try {
    const heldResource = sameScopeContext
      ? assertCanonicalResourceLockOrdering(sameScopeContext, input.resource)
      : undefined;
    if (heldResource && sameScopeContext) {
      trackHeldCanonicalResource(sameScopeContext, heldResource, async () => {});

      let released = false;
      return {
        metadata,
        resource: input.resource,
        async release() {
          if (released) {
            return;
          }

          released = true;
          await releaseHeldCanonicalResource(sameScopeContext, input.resource.key);
        },
      };
    }

    const releaseQueue = await acquireCanonicalResourceQueueSlot(queueKey);
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
          if (sameScopeContext) {
            trackHeldCanonicalResource(sameScopeContext, input.resource, async () => {
              try {
                await handle.release();
              } finally {
                releaseQueue();
              }
            });
          }

          return {
            metadata: handle.metadata,
            resource: input.resource,
            async release() {
              if (released) {
                return;
              }

              released = true;

              if (sameScopeContext) {
                await releaseHeldCanonicalResource(sameScopeContext, input.resource.key);
                return;
              }

              try {
                await handle.release();
              } finally {
                releaseQueue();
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
      releaseQueue();
      throw error;
    }
  } catch (error) {
    throw error;
  } finally {
    releaseScopeQueue?.();
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

function buildCanonicalResourceLockOrderingMessage(
  resource: CanonicalMutationResource,
  highestHeldResource: CanonicalMutationResource,
): string {
  return `Canonical resource "${resource.label}" cannot be acquired after already holding "${highestHeldResource.label}". Acquire canonical resources together in sorted order.`;
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
