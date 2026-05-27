import type { CanonicalEntity } from "./canonical-entities.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDenseProviderObservationEntity(entity: CanonicalEntity): boolean {
  if (entity.family !== "event" || entity.kind !== "observation") {
    return false;
  }

  const attributes = isRecord(entity.attributes) ? entity.attributes : {};
  const externalRef = attributes.externalRef;
  const dataOrigin = attributes.dataOrigin;

  return (
    attributes.source === "device" &&
    typeof attributes.metric === "string" &&
    typeof attributes.value === "number" &&
    Number.isFinite(attributes.value) &&
    (externalRef !== undefined || dataOrigin !== undefined)
  );
}
