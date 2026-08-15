import { normalizeJunctionProviderSlug } from "./config/connect-routes.ts";
import { isDeviceSyncSourceDisconnectFenced } from "./public-account.ts";
import { sha256Text } from "./shared.ts";

import type { DeviceSyncJobInput } from "./types.ts";

const JUNCTION_WORKOUT_STREAM_RESOURCE = "workout_stream";
const JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_MAX_LENGTH = 512;
const JUNCTION_WORKOUT_SOURCE_LIFECYCLE_ENTRY_PATTERN = /^([a-z0-9][a-z0-9_-]{0,79}):([0-9a-z]+)$/u;

export const JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_PAYLOAD_KEY =
  "sourceLifecycleEpochs";

export interface JunctionWorkoutLifecycleSource {
  lastErrorCode?: string | null;
  lifecycleEpoch?: number | null;
  sourceProviderSlug: string;
  status: string;
}

/**
 * Binds exact-workout work to the source consent lifetime visible while the
 * durable acceptance owner holds its existing transaction or admission lock.
 * The compact multi-source proof lets a source-less stream select only the
 * fetched source's admission-time epoch after the bounded stream request.
 */
export function bindJunctionWorkoutJobsToSourceLifecycles(
  jobs: readonly DeviceSyncJobInput[],
  sources: readonly JunctionWorkoutLifecycleSource[],
): DeviceSyncJobInput[] {
  const epochs = collectAdmittedJunctionWorkoutSourceLifecycleEpochs(sources);
  const serializedEpochs = serializeJunctionWorkoutSourceLifecycleEpochs(epochs);

  return jobs.map((job) => {
    if (!isJunctionWorkoutStreamJob(job)) {
      return job;
    }

    const payload = { ...(job.payload ?? {}) };
    delete payload.sourceLifecycleEpoch;
    delete payload[JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_PAYLOAD_KEY];

    const sourceProviderSlug = normalizeJunctionProviderSlug(payload.sourceProviderSlug);
    if (sourceProviderSlug) {
      const sourceLifecycleEpoch = epochs.get(sourceProviderSlug);
      if (sourceLifecycleEpoch !== undefined) {
        payload.sourceLifecycleEpoch = sourceLifecycleEpoch;
      }
    } else if (serializedEpochs) {
      payload[JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_PAYLOAD_KEY] = serializedEpochs;
    }

    const lifecycleIdentity = sourceProviderSlug
      ? [sourceProviderSlug, readPositiveInteger(payload.sourceLifecycleEpoch)]
      : [null, payload[JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_PAYLOAD_KEY] ?? null];

    return {
      ...job,
      dedupeKey: sha256Text(JSON.stringify([
        "junction-workout-source-lifecycle",
        job.dedupeKey ?? null,
        lifecycleIdentity,
      ])),
      payload,
    };
  });
}

export function isJunctionWorkoutStreamJob(
  job: Pick<DeviceSyncJobInput, "kind" | "payload">,
): boolean {
  return job.kind === "resource"
    && job.payload?.resource === JUNCTION_WORKOUT_STREAM_RESOURCE;
}

export function readJunctionWorkoutSourceLifecycleEpoch(
  payload: Record<string, unknown>,
  sourceProviderSlug: string,
): number | null {
  const normalizedSourceProviderSlug = normalizeJunctionProviderSlug(sourceProviderSlug);
  if (!normalizedSourceProviderSlug) {
    return null;
  }

  const attributedSourceProviderSlug = normalizeJunctionProviderSlug(payload.sourceProviderSlug);
  if (attributedSourceProviderSlug) {
    return attributedSourceProviderSlug === normalizedSourceProviderSlug
      ? readPositiveInteger(payload.sourceLifecycleEpoch)
      : null;
  }

  return parseJunctionWorkoutSourceLifecycleEpochs(
    payload[JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_PAYLOAD_KEY],
  )?.get(normalizedSourceProviderSlug) ?? null;
}

export function hasJunctionWorkoutSourceLifecycleAuthority(
  payload: Record<string, unknown>,
): boolean {
  const sourceProviderSlug = normalizeJunctionProviderSlug(payload.sourceProviderSlug);
  if (sourceProviderSlug) {
    return readJunctionWorkoutSourceLifecycleEpoch(payload, sourceProviderSlug) !== null;
  }

  const epochs = parseJunctionWorkoutSourceLifecycleEpochs(
    payload[JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_PAYLOAD_KEY],
  );
  return epochs !== null && epochs.size > 0;
}

function collectAdmittedJunctionWorkoutSourceLifecycleEpochs(
  sources: readonly JunctionWorkoutLifecycleSource[],
): Map<string, number> {
  const epochs = new Map<string, number>();
  const ambiguous = new Set<string>();

  for (const source of sources) {
    const sourceProviderSlug = normalizeJunctionProviderSlug(source.sourceProviderSlug);
    const sourceLifecycleEpoch = readPositiveInteger(source.lifecycleEpoch ?? 1);
    if (
      !sourceProviderSlug
      || sourceLifecycleEpoch === null
      || source.status !== "connected"
      || isDeviceSyncSourceDisconnectFenced(source)
      || ambiguous.has(sourceProviderSlug)
    ) {
      continue;
    }

    const existing = epochs.get(sourceProviderSlug);
    if (existing !== undefined && existing !== sourceLifecycleEpoch) {
      epochs.delete(sourceProviderSlug);
      ambiguous.add(sourceProviderSlug);
      continue;
    }
    epochs.set(sourceProviderSlug, sourceLifecycleEpoch);
  }

  return epochs;
}

function serializeJunctionWorkoutSourceLifecycleEpochs(
  epochs: ReadonlyMap<string, number>,
): string | null {
  const serialized = [...epochs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourceProviderSlug, sourceLifecycleEpoch]) =>
      `${sourceProviderSlug}:${sourceLifecycleEpoch.toString(36)}`
    )
    .join(",");

  return serialized.length > 0
      && serialized.length <= JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_MAX_LENGTH
    ? serialized
    : null;
}

function parseJunctionWorkoutSourceLifecycleEpochs(value: unknown): Map<string, number> | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > JUNCTION_WORKOUT_SOURCE_LIFECYCLE_EPOCHS_MAX_LENGTH
  ) {
    return null;
  }

  const epochs = new Map<string, number>();
  for (const entry of value.split(",")) {
    const match = JUNCTION_WORKOUT_SOURCE_LIFECYCLE_ENTRY_PATTERN.exec(entry);
    if (!match) {
      return null;
    }
    const sourceProviderSlug = normalizeJunctionProviderSlug(match[1]);
    const sourceLifecycleEpoch = Number.parseInt(match[2] ?? "", 36);
    if (
      !sourceProviderSlug
      || epochs.has(sourceProviderSlug)
      || !Number.isSafeInteger(sourceLifecycleEpoch)
      || sourceLifecycleEpoch < 1
      || sourceLifecycleEpoch.toString(36) !== match[2]
    ) {
      return null;
    }
    epochs.set(sourceProviderSlug, sourceLifecycleEpoch);
  }

  return epochs;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}
