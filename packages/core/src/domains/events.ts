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
  addMeasurement,
} from "./events/attachment-backed.ts";
export type {
  AddActivitySessionInput,
  AddActivitySessionResult,
  AddBodyMeasurementInput,
  AddBodyMeasurementResult,
  AddCaptureInput,
  AddCaptureResult,
  AddMeasurementInput,
  AddMeasurementResult,
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
  upsertEvent,
} from "./events/ledger.ts";
export type {
  DeleteEventInput,
  DeleteEventResult,
  FindEventByExternalRefInput,
  UpsertEventDraftInput,
  UpsertEventInput,
  UpsertEventPayloadInput,
  UpsertEventResult,
} from "./events/ledger.ts";

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
