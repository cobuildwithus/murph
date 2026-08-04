import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.ts";

export const HOSTED_R2_CUTOVER_PHASE_ENV = "HOSTED_R2_CUTOVER_PHASE";
export const HOSTED_R2_CUTOVER_PROTOCOL_VERSION = "r2-oc-enam-v1";
export const HOSTED_R2_WRITE_ADMISSION_ENV = "HOSTED_R2_WRITE_ADMISSION";
export const HOSTED_R2_WRITE_ADMISSION_RETRY_DELAY_MS = 60_000;

const cutoverContextByEnvironment = new WeakMap<object, HostedR2CutoverContext>();

export type HostedR2BucketRole = "destination" | "source";
export type HostedR2CutoverPhase = "destination_active" | "source_active";
export type HostedR2WriteAdmission = "open" | "paused";

export interface HostedR2CutoverEnvironmentSource extends Readonly<Record<string, unknown>> {
  BUNDLES: R2BucketLike;
  BUNDLES_ENAM?: R2BucketLike;
  HOSTED_R2_CUTOVER_PHASE?: unknown;
  HOSTED_R2_WRITE_ADMISSION?: unknown;
}

export interface HostedR2CutoverContext {
  activeBucket: R2BucketLike;
  bucket: R2BucketLike;
  coexisting: boolean;
  destinationBucket: R2BucketLike;
  phase: HostedR2CutoverPhase;
  sourceBucket: R2BucketLike;
  writeBucketRole: HostedR2BucketRole;
}

export function resolveHostedR2CutoverContext(
  source: HostedR2CutoverEnvironmentSource,
): HostedR2CutoverContext {
  const cached = cutoverContextByEnvironment.get(source);
  if (cached) {
    return cached;
  }

  const phaseValue = readOptionalString(source.HOSTED_R2_CUTOVER_PHASE);
  const destinationBucket = source.BUNDLES_ENAM;

  if (!phaseValue && destinationBucket === undefined) {
    const context = createLegacySingleBucketContext(source.BUNDLES);
    cutoverContextByEnvironment.set(source, context);
    return context;
  }
  if (!phaseValue) {
    throw new TypeError(
      `${HOSTED_R2_CUTOVER_PHASE_ENV} is required when BUNDLES_ENAM is configured.`,
    );
  }
  if (phaseValue !== "source_active" && phaseValue !== "destination_active") {
    throw new TypeError(
      `${HOSTED_R2_CUTOVER_PHASE_ENV} must be source_active or destination_active.`,
    );
  }
  if (!destinationBucket) {
    throw new TypeError("BUNDLES_ENAM is required while the R2 cutover bridge is active.");
  }
  if (destinationBucket === source.BUNDLES) {
    throw new TypeError("BUNDLES and BUNDLES_ENAM must be distinct fixed-role bindings.");
  }
  assertBridgeBucketCapabilities(source.BUNDLES, "BUNDLES");
  assertBridgeBucketCapabilities(destinationBucket, "BUNDLES_ENAM");

  const contextWithoutBucket = {
    activeBucket: phaseValue === "source_active" ? source.BUNDLES : destinationBucket,
    coexisting: true,
    destinationBucket,
    phase: phaseValue,
    sourceBucket: source.BUNDLES,
    writeBucketRole: phaseValue === "source_active" ? "source" : "destination",
  } satisfies Omit<HostedR2CutoverContext, "bucket">;

  const context: HostedR2CutoverContext = {
    ...contextWithoutBucket,
    bucket: createHostedR2CutoverBucket(contextWithoutBucket),
  };
  cutoverContextByEnvironment.set(source, context);
  return context;
}

export function withHostedR2CutoverBucket<
  TSource extends HostedR2CutoverEnvironmentSource,
>(
  source: TSource,
  context: HostedR2CutoverContext = resolveHostedR2CutoverContext(source),
): TSource & { BUNDLES: R2BucketLike } {
  const wrapped = Object.assign({}, source, {
    BUNDLES: context.bucket,
  });
  cutoverContextByEnvironment.set(wrapped, context);
  return wrapped;
}

export function readHostedR2CutoverStatus(
  context: HostedR2CutoverContext,
): { coexisting: boolean; phase: HostedR2CutoverPhase; protocolVersion: string } {
  return {
    coexisting: context.coexisting,
    phase: context.phase,
    protocolVersion: HOSTED_R2_CUTOVER_PROTOCOL_VERSION,
  };
}

export function readHostedR2WriteAdmission(
  source: Readonly<Record<string, unknown>>,
): HostedR2WriteAdmission {
  const value = readOptionalString(source.HOSTED_R2_WRITE_ADMISSION) ?? "open";
  if (value !== "open" && value !== "paused") {
    throw new TypeError(`${HOSTED_R2_WRITE_ADMISSION_ENV} must be open or paused.`);
  }
  return value;
}

export function createHostedR2WriteAdmissionPausedResponse(
  nowMs = Date.now(),
): { kind: "retry_later"; retryAt: string } {
  return {
    kind: "retry_later",
    retryAt: new Date(nowMs + HOSTED_R2_WRITE_ADMISSION_RETRY_DELAY_MS).toISOString(),
  };
}

export function readHostedR2BucketForRole(
  context: HostedR2CutoverContext,
  role: HostedR2BucketRole,
): R2BucketLike {
  return role === "source" ? context.sourceBucket : context.destinationBucket;
}

export async function locateHostedR2ObjectBucketRole(
  context: HostedR2CutoverContext,
  key: string,
): Promise<HostedR2BucketRole | null> {
  if (context.phase === "source_active") {
    return await requireHead(context.sourceBucket, "BUNDLES", key) ? "source" : null;
  }

  if (await requireHead(context.destinationBucket, "BUNDLES_ENAM", key)) {
    return "destination";
  }
  const sourceObject = await requireHead(context.sourceBucket, "BUNDLES", key);
  if (!sourceObject) {
    return null;
  }
  emitFallbackObservation("head");
  return "source";
}

function createLegacySingleBucketContext(bucket: R2BucketLike): HostedR2CutoverContext {
  return {
    activeBucket: bucket,
    bucket,
    coexisting: false,
    destinationBucket: bucket,
    phase: "source_active",
    sourceBucket: bucket,
    writeBucketRole: "source",
  };
}

function createHostedR2CutoverBucket(
  context: Omit<HostedR2CutoverContext, "bucket">,
): R2BucketLike {
  const bucket: R2BucketLike = {
    async get(key) {
      if (context.phase === "source_active") {
        return await context.sourceBucket.get(key);
      }
      const destinationObject = await context.destinationBucket.get(key);
      if (destinationObject !== null) {
        return destinationObject;
      }
      const sourceObject = await context.sourceBucket.get(key);
      if (sourceObject !== null) {
        emitFallbackObservation("get");
      }
      return sourceObject;
    },
    async put(key, value, options) {
      await context.activeBucket.put(key, value, options);
    },
  };

  bucket.delete = async (key): Promise<void> => {
    const sourceDelete = requireDelete(context.sourceBucket, "BUNDLES");
    const destinationDelete = requireDelete(context.destinationBucket, "BUNDLES_ENAM");
    await sourceDelete(key);
    try {
      await destinationDelete(key);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.r2",
        details: {
          destinationDeleteFailed: true,
          sourceDeleteCompleted: true,
        },
        error,
        level: "error",
        message: "Hosted R2 dual-bucket delete did not complete in the destination bucket.",
        phase: "wake.running",
        userId: null,
      });
      throw error;
    }
  };

  bucket.head = async (key) => {
    if (context.phase === "source_active") {
      return await requireHead(context.sourceBucket, "BUNDLES", key);
    }
    const destinationObject = await requireHead(context.destinationBucket, "BUNDLES_ENAM", key);
    if (destinationObject !== null) {
      return destinationObject;
    }
    const sourceObject = await requireHead(context.sourceBucket, "BUNDLES", key);
    if (sourceObject !== null) {
      emitFallbackObservation("head");
    }
    return sourceObject;
  };

  bucket.list = async (input) => {
    const list = requireList(
      context.activeBucket,
      context.phase === "source_active" ? "BUNDLES" : "BUNDLES_ENAM",
    );
    return await list(input);
  };

  return bucket;
}

function assertBridgeBucketCapabilities(bucket: R2BucketLike, label: string): void {
  requireDelete(bucket, label);
  requireHeadMethod(bucket, label);
  requireList(bucket, label);
}

function requireDelete(
  bucket: R2BucketLike,
  label: string,
): NonNullable<R2BucketLike["delete"]> {
  if (!bucket.delete) {
    throw new TypeError(`${label} must support R2 object deletion during the cutover bridge.`);
  }
  return bucket.delete.bind(bucket);
}

function requireHeadMethod(
  bucket: R2BucketLike,
  label: string,
): NonNullable<R2BucketLike["head"]> {
  if (!bucket.head) {
    throw new TypeError(`${label} must support R2 HEAD during the cutover bridge.`);
  }
  return bucket.head.bind(bucket);
}

function requireList(
  bucket: R2BucketLike,
  label: string,
): NonNullable<R2BucketLike["list"]> {
  if (!bucket.list) {
    throw new TypeError(`${label} must support R2 listing during the cutover bridge.`);
  }
  return bucket.list.bind(bucket);
}

async function requireHead(
  bucket: R2BucketLike,
  label: string,
  key: string,
): ReturnType<NonNullable<R2BucketLike["head"]>> {
  return await requireHeadMethod(bucket, label)(key);
}

function emitFallbackObservation(operation: "get" | "head"): void {
  emitHostedExecutionStructuredLog({
    component: "hosted.r2",
    details: {
      fallbackBucketRole: "source",
      operation,
      primaryBucketRole: "destination",
    },
    message: "Hosted R2 destination read used the source fallback after a definitive miss.",
    phase: "wake.running",
    userId: null,
  });
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
