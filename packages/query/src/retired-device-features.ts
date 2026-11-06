import { eventRevisionFromLifecycle } from "@murphai/contracts";

import type { CanonicalEntity } from "./canonical-entities.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

// Canonical evidence remains available. Only untouched importer-owned v1
// analytics retire from default queries; later revisions may be member edits.
export function isRetiredDeviceFeature(entity: CanonicalEntity): boolean {
  if (entity.family !== "event" || entity.kind !== "measurement") return false;
  const attributes = asRecord(entity.attributes);
  if (!attributes || attributes.source !== "device"
    || eventRevisionFromLifecycle(attributes.lifecycle) !== 1) return false;
  const externalRef = asRecord(attributes.externalRef);
  const origin = asRecord(attributes.dataOrigin);
  return externalRef?.system === "junction"
    && externalRef.facet === "features"
    && origin?.normalizerVersion === "junction.blood_oxygen_feature_envelope.v1";
}
