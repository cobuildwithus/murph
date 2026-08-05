import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.ts";

export const HOSTED_R2_CUTOVER_PHASE_ENV = "HOSTED_R2_CUTOVER_PHASE";
export const HOSTED_R2_CUTOVER_PROTOCOL_VERSION = "r2-oc-enam-v2";
export const HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256_ENV =
  "HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256";
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
  HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256?: unknown;
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

interface HostedR2ReadBucket {
  bucket: R2BucketLike;
  label: "BUNDLES" | "BUNDLES_ENAM";
  role: HostedR2BucketRole;
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

export function readHostedR2PausedCanaryConfigured(
  source: Readonly<Record<string, unknown>>,
): boolean {
  return readHostedR2PausedCanaryUserIdSha256(source) !== null;
}

export async function isHostedR2PausedCanaryUser(
  source: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<boolean> {
  if (
    readHostedR2WriteAdmission(source) !== "paused"
    || readOptionalString(source.HOSTED_R2_CUTOVER_PHASE) !== "destination_active"
  ) {
    return false;
  }
  const expectedSha256 = readHostedR2PausedCanaryUserIdSha256(source);
  return expectedSha256 !== null && await sha256Hex(userId) === expectedSha256;
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
  if (!context.coexisting) {
    return await requireHead(context.sourceBucket, "BUNDLES", key) ? "source" : null;
  }
  const [primary, fallback] = readHostedR2BucketOrder(context);
  if (await requireHead(primary.bucket, primary.label, key)) {
    return primary.role;
  }
  if (!await requireHead(fallback.bucket, fallback.label, key)) {
    return null;
  }
  emitFallbackObservation("head", primary.role, fallback.role);
  return fallback.role;
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
  const [primary, fallback] = readHostedR2BucketOrder(context);
  const bucket: R2BucketLike = {
    async get(key) {
      const primaryObject = await primary.bucket.get(key);
      if (primaryObject !== null) {
        return primaryObject;
      }
      const fallbackObject = await fallback.bucket.get(key);
      if (fallbackObject !== null) {
        emitFallbackObservation("get", primary.role, fallback.role);
      }
      return fallbackObject;
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
    const primaryObject = await requireHead(primary.bucket, primary.label, key);
    if (primaryObject !== null) {
      return primaryObject;
    }
    const fallbackObject = await requireHead(fallback.bucket, fallback.label, key);
    if (fallbackObject !== null) {
      emitFallbackObservation("head", primary.role, fallback.role);
    }
    return fallbackObject;
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

function readHostedR2BucketOrder(
  context: Pick<
    HostedR2CutoverContext,
    "destinationBucket" | "phase" | "sourceBucket"
  >,
): readonly [HostedR2ReadBucket, HostedR2ReadBucket] {
  const source = {
    bucket: context.sourceBucket,
    label: "BUNDLES",
    role: "source",
  } as const;
  const destination = {
    bucket: context.destinationBucket,
    label: "BUNDLES_ENAM",
    role: "destination",
  } as const;
  return context.phase === "source_active"
    ? [source, destination]
    : [destination, source];
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

function emitFallbackObservation(
  operation: "get" | "head",
  primaryBucketRole: HostedR2BucketRole,
  fallbackBucketRole: HostedR2BucketRole,
): void {
  emitHostedExecutionStructuredLog({
    component: "hosted.r2",
    details: {
      fallbackBucketRole,
      operation,
      primaryBucketRole,
    },
    message: "Hosted R2 explicit-key read used the fallback bucket after a definitive miss.",
    phase: "wake.running",
    userId: null,
  });
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readHostedR2PausedCanaryUserIdSha256(
  source: Readonly<Record<string, unknown>>,
): string | null {
  const value = readOptionalString(source.HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256);
  if (value !== null && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(
      `${HOSTED_R2_PAUSED_CANARY_USER_ID_SHA256_ENV} must be a lowercase SHA-256 hex digest.`,
    );
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
