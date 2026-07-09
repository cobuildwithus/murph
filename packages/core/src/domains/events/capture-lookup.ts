import type { EventRecord } from "@murphai/contracts";

export const CAPTURE_LOOKUP_BACKED_TAG = "capture-lookup-backed";
export const CAPTURE_LOOKUP_INDEX_PATH = "derived/captures/generated-image-lookups.json";
export const CAPTURE_LOOKUP_SCHEMA = "murph.capture-lookup.v1";

export function isCaptureLookupBackedEvent(record: EventRecord): boolean {
  return record.kind === "note" && record.tags?.includes(CAPTURE_LOOKUP_BACKED_TAG) === true;
}
