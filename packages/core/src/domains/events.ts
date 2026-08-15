import type { ExperimentEventRecord } from "@murphai/contracts";
import { eventRecordSchema } from "@murphai/contracts";

import { buildEventSpineEnvelope } from "../history/event-spine.ts";
import {
  compactObject,
  normalizeOptionalText,
  validateContract,
} from "./shared.ts";

export {
  addActivitySession,
  addBodyMeasurement,
  addCapture,
  addCaptureWithLookup,
  addMeasurement,
  findCaptureByLookup,
} from "./events/attachment-backed.ts";
export type {
  AddActivitySessionInput,
  AddActivitySessionResult,
  AddBodyMeasurementInput,
  AddBodyMeasurementResult,
  AddCaptureInput,
  AddCaptureResult,
  AddCaptureWithLookupInput,
  AddCaptureWithLookupResult,
  AddMeasurementInput,
  AddMeasurementResult,
  FindCaptureByLookupResult,
} from "./events/attachment-backed.ts";
export {
  buildActivitySessionEventDraft,
  buildBodyMeasurementEventDraft,
  buildClinicalAssertionEventDraft,
  buildExperimentContextEventDraft,
  buildInterventionSessionEventDraft,
  buildMeasurementEventDraft,
  buildMedicationIntakeEventDraft,
  buildNoteEventDraft,
  buildObservationEventDraft,
  buildPublicEventRecord,
  buildSleepSessionEventDraft,
  buildSupplementIntakeEventDraft,
  buildSymptomEventDraft,
} from "./events/drafts.ts";
export type {
  EventDraftByKind,
  PublicEventDraft,
  PublicWritableEventKind,
} from "./events/drafts.ts";
export {
  deleteEvent,
  findEventByExternalRef,
  findEventsByRawRefs,
  upsertEvent,
} from "./events/ledger.ts";
export {
  removeAutomaticMealPhoto,
} from "./events/automatic-meal-photo-retention.ts";
export {
  GENERATED_IMAGE_CAPTURE_RETENTION_DAYS,
  GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS,
  GENERATED_IMAGE_CAPTURE_PROVENANCE_SCHEMA,
  GENERATED_IMAGE_CAPTURE_SOURCE,
  GENERATED_IMAGE_CAPTURE_TAGS,
  runGeneratedImageCaptureRetention,
} from "./events/generated-image-capture-retention.ts";
export {
  CAPTURE_LOOKUP_INDEX_PATH,
  readStoredCaptureLookupIndex,
} from "./events/capture-lookup.ts";
export type {
  StoredCaptureLookup,
  StoredCaptureLookupIndex,
} from "./events/capture-lookup.ts";
export type {
  DeleteEventInput,
  DeleteEventResult,
  EventRawRefMatch,
  FindEventByExternalRefInput,
  FindEventsByRawRefsInput,
  UpsertEventDraftInput,
  UpsertEventInput,
  UpsertEventPayloadInput,
  UpsertEventResult,
} from "./events/ledger.ts";
export type {
  RemoveAutomaticMealPhotoInput,
  RemoveAutomaticMealPhotoResult,
} from "./events/automatic-meal-photo-retention.ts";
export type {
  RunGeneratedImageCaptureRetentionInput,
  RunGeneratedImageCaptureRetentionResult,
} from "./events/generated-image-capture-retention.ts";

export function buildExperimentEventRecord(input: {
  occurredAt: string;
  title: string;
  note?: string;
  experimentId: string;
  experimentSlug: string;
  phase: ExperimentEventRecord["phase"];
  timeZone?: string;
}): ExperimentEventRecord {
  return validateContract(
    eventRecordSchema,
    compactObject({
      ...buildEventSpineEnvelope({
        occurredAt: input.occurredAt,
        timeZone: input.timeZone,
        source: "manual",
        title: input.title.trim(),
        note: normalizeOptionalText(input.note) ?? undefined,
        links: [{ type: "related_to", targetId: input.experimentId }],
      }),
      kind: "experiment_event",
      experimentId: input.experimentId,
      experimentSlug: input.experimentSlug,
      phase: input.phase,
    }),
    "EVENT_CONTRACT_INVALID",
    'Event payload for kind "experiment_event" is invalid.',
  ) as ExperimentEventRecord;
}
