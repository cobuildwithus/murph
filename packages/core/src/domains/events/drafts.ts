import type { EventRecord } from "@murphai/contracts";
import { eventRecordSchema } from "@murphai/contracts";

import { VaultError } from "../../errors.ts";
import { buildEventSpineEnvelope } from "../../history/event-spine.ts";
import type { DateInput } from "../../types.ts";
import {
  compactObject,
  normalizeOptionalText,
  normalizeTimestampInput,
  uniqueTrimmedStringList,
  validateContract,
} from "../shared.ts";

export type EventRecordByKind<K extends EventRecord["kind"]> = Extract<EventRecord, { kind: K }>;
export type EventLifecycle = NonNullable<EventRecord["lifecycle"]>;

export const PUBLIC_EVENT_WRITE_KIND_LIST = [
  "symptom",
  "note",
  "observation",
  "clinical_assertion",
  "exposure",
  "measurement",
  "test",
  "medication_intake",
  "supplement_intake",
  "activity_session",
  "body_measurement",
  "sleep_session",
  "intervention_session",
  "experiment_context",
] as const;

export type PublicWritableEventKind = (typeof PUBLIC_EVENT_WRITE_KIND_LIST)[number];
export type EventDraftByKind<K extends PublicWritableEventKind> = Omit<
  EventRecordByKind<K>,
  "schemaVersion" | "id" | "kind" | "occurredAt" | "recordedAt" | "dayKey" | "source" | "lifecycle"
> & {
  kind: K;
  id?: string;
  occurredAt: DateInput;
  recordedAt?: DateInput;
  dayKey?: string;
  source?: EventRecordByKind<K>["source"];
};
export type PublicEventDraft = {
  [K in PublicWritableEventKind]: EventDraftByKind<K>;
}[PublicWritableEventKind];

export function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function requireText(value: unknown, message: string): string {
  const normalized = normalizeOptionalText(valueAsString(value));
  if (!normalized) {
    throw new VaultError("INVALID_INPUT", message);
  }

  return normalized;
}

export function normalizeDraftEventId(value: unknown): string | undefined {
  return typeof value === "string" ? normalizeOptionalText(value) ?? undefined : undefined;
}

export function buildBaseEventContractInput(
  draft: PublicEventDraft,
  fallbackTimeZone?: string,
): Omit<EventRecord, "kind"> {
  const occurredAt = normalizeTimestampInput(draft.occurredAt);
  if (!occurredAt) {
    throw new VaultError("EVENT_OCCURRED_AT_MISSING", "Event draft requires occurredAt.");
  }

  return compactObject({
    ...buildEventSpineEnvelope({
      id: normalizeDraftEventId(draft.id),
      occurredAt,
      recordedAt: normalizeTimestampInput(draft.recordedAt),
      dayKey: valueAsString(draft.dayKey),
      timeZone: valueAsString(draft.timeZone),
      fallbackTimeZone,
      source: valueAsString(draft.source),
      title: requireText(draft.title, "Event draft requires a title."),
      note: normalizeOptionalText(valueAsString(draft.note)) ?? undefined,
      tags: uniqueTrimmedStringList(draft.tags) ?? undefined,
      experimentSlug: valueAsString(
        "experimentSlug" in draft ? draft.experimentSlug : undefined,
      ),
      links: draft.links,
      rawRefs: uniqueTrimmedStringList(draft.rawRefs) ?? undefined,
      evidence: draft.evidence,
      attachments: draft.attachments,
      lifecycle: undefined,
    }),
    externalRef: draft.externalRef,
  }) as Omit<EventRecord, "kind">;
}

export function buildTypedEventRecord(
  draft: PublicEventDraft,
  fallbackTimeZone?: string,
  lifecycle?: EventLifecycle,
): EventRecord {
  const base = buildBaseEventContractInput(draft, fallbackTimeZone);

  const record = (() => {
    switch (draft.kind) {
      case "note":
        return compactObject({
          ...base,
          kind: "note",
          experimentId: draft.experimentId,
          noteType: draft.noteType,
          authoredAt: draft.authoredAt,
          signedAt: draft.signedAt,
          author: draft.author,
          providerId: draft.providerId,
          facility: draft.facility,
          encounterId: draft.encounterId,
          sections: draft.sections,
        });
      case "symptom":
        return compactObject({
          ...base,
          kind: "symptom",
          symptom: draft.symptom,
          intensity: draft.intensity,
          bodySite: draft.bodySite,
        });
      case "observation":
        return compactObject({
          ...base,
          kind: "observation",
          metric: draft.metric,
          value: draft.value,
          unit: draft.unit,
        });
      case "clinical_assertion":
        return compactObject({
          ...base,
          kind: "clinical_assertion",
          assertion: draft.assertion,
          domain: draft.domain,
          polarity: draft.polarity,
          subject: draft.subject,
          assertionText: draft.assertionText,
          bodySite: draft.bodySite,
          code: draft.code,
          codeSystem: draft.codeSystem,
          assertedOn: draft.assertedOn,
          sourceLabel: draft.sourceLabel,
        });
      case "measurement":
        return compactObject({
          ...base,
          kind: "measurement",
          measurements: draft.measurements,
          media: draft.media,
        });
      case "test":
        return compactObject({
          ...base,
          kind: "test",
          testName: draft.testName,
          resultStatus: draft.resultStatus,
          summary: draft.summary,
          testCategory: draft.testCategory,
          specimenType: draft.specimenType,
          labName: draft.labName,
          labPanelId: draft.labPanelId,
          collectedAt: draft.collectedAt,
          reportedAt: draft.reportedAt,
          fastingStatus: draft.fastingStatus,
          results: draft.results,
        });
      case "medication_intake":
        return compactObject({
          ...base,
          kind: "medication_intake",
          medicationName: draft.medicationName,
          dose: draft.dose,
          unit: draft.unit,
        });
      case "supplement_intake":
        return compactObject({
          ...base,
          kind: "supplement_intake",
          experimentId: draft.experimentId,
          supplementName: draft.supplementName,
          dose: draft.dose,
          unit: draft.unit,
        });
      case "activity_session":
        return compactObject({
          ...base,
          kind: "activity_session",
          experimentId: draft.experimentId,
          activityType: draft.activityType,
          durationMinutes: draft.durationMinutes,
          distanceKm: draft.distanceKm,
          workout: draft.workout,
        });
      case "body_measurement":
        return compactObject({
          ...base,
          kind: "body_measurement",
          measurements: draft.measurements,
          media: draft.media,
        });
      case "sleep_session":
        return compactObject({
          ...base,
          kind: "sleep_session",
          startAt: draft.startAt,
          endAt: draft.endAt,
          durationMinutes: draft.durationMinutes,
        });
      case "intervention_session":
        return compactObject({
          ...base,
          kind: "intervention_session",
          experimentId: draft.experimentId,
          interventionType: draft.interventionType,
          durationMinutes: draft.durationMinutes,
          protocolId: draft.protocolId,
          regimenId: draft.regimenId,
          sessionStatus: draft.sessionStatus,
          temperatureC: draft.temperatureC,
          timing: draft.timing,
          afterExercise: draft.afterExercise,
          symptoms: draft.symptoms,
          confounders: draft.confounders,
        });
      case "experiment_context":
        return compactObject({
          ...base,
          kind: "experiment_context",
          experimentId: draft.experimentId,
          contextType: draft.contextType,
          severity: draft.severity,
        });
    }
  })();

  return validateContract(
    eventRecordSchema,
    compactObject({
      ...record,
      lifecycle,
    }),
    "EVENT_CONTRACT_INVALID",
    `Event draft for kind "${draft.kind}" is invalid.`,
  );
}

function buildTypedEventDraft<K extends PublicWritableEventKind>(
  kind: K,
  input: Omit<EventDraftByKind<K>, "kind">,
): EventDraftByKind<K> {
  return {
    kind,
    ...input,
  } as EventDraftByKind<K>;
}

export function buildSymptomEventDraft(
  input: Omit<EventDraftByKind<"symptom">, "kind">,
): EventDraftByKind<"symptom"> {
  return buildTypedEventDraft("symptom", input);
}

export function buildNoteEventDraft(
  input: Omit<EventDraftByKind<"note">, "kind">,
): EventDraftByKind<"note"> {
  return buildTypedEventDraft("note", input);
}

export function buildObservationEventDraft(
  input: Omit<EventDraftByKind<"observation">, "kind">,
): EventDraftByKind<"observation"> {
  return buildTypedEventDraft("observation", input);
}

export function buildClinicalAssertionEventDraft(
  input: Omit<EventDraftByKind<"clinical_assertion">, "kind">,
): EventDraftByKind<"clinical_assertion"> {
  return buildTypedEventDraft("clinical_assertion", input);
}

export function buildMeasurementEventDraft(
  input: Omit<EventDraftByKind<"measurement">, "kind">,
): EventDraftByKind<"measurement"> {
  return buildTypedEventDraft("measurement", input);
}

export function buildMedicationIntakeEventDraft(
  input: Omit<EventDraftByKind<"medication_intake">, "kind">,
): EventDraftByKind<"medication_intake"> {
  return buildTypedEventDraft("medication_intake", input);
}

export function buildSupplementIntakeEventDraft(
  input: Omit<EventDraftByKind<"supplement_intake">, "kind">,
): EventDraftByKind<"supplement_intake"> {
  return buildTypedEventDraft("supplement_intake", input);
}

export function buildActivitySessionEventDraft(
  input: Omit<EventDraftByKind<"activity_session">, "kind">,
): EventDraftByKind<"activity_session"> {
  return buildTypedEventDraft("activity_session", input);
}

export function buildBodyMeasurementEventDraft(
  input: Omit<EventDraftByKind<"body_measurement">, "kind">,
): EventDraftByKind<"body_measurement"> {
  return buildTypedEventDraft("body_measurement", input);
}

export function buildSleepSessionEventDraft(
  input: Omit<EventDraftByKind<"sleep_session">, "kind">,
): EventDraftByKind<"sleep_session"> {
  return buildTypedEventDraft("sleep_session", input);
}

export function buildInterventionSessionEventDraft(
  input: Omit<EventDraftByKind<"intervention_session">, "kind">,
): EventDraftByKind<"intervention_session"> {
  return buildTypedEventDraft("intervention_session", input);
}

export function buildExperimentContextEventDraft(
  input: Omit<EventDraftByKind<"experiment_context">, "kind">,
): EventDraftByKind<"experiment_context"> {
  return buildTypedEventDraft("experiment_context", input);
}

export function buildPublicEventRecord<K extends PublicWritableEventKind>(
  draft: EventDraftByKind<K>,
  fallbackTimeZone?: string,
): EventRecordByKind<K> {
  return buildTypedEventRecord(draft as PublicEventDraft, fallbackTimeZone) as EventRecordByKind<K>;
}
