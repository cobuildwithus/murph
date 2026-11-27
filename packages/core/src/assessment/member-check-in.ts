import { isDeepStrictEqual } from "node:util";
import {
  assessmentResponseSchema, combineProtocolKey, projectedCheckInSchema, resolveLocalDateAtNoon, toLocalDayKey,
  type MemberActionRequestV1, type MemberActionV1, type MeasurementEntry,
} from "@murphai/contracts";
import { resolveMetricDefinition } from "@murphai/health-metrics";
import { emitAuditRecord } from "../audit.ts";
import { ID_PREFIXES } from "../constants.ts";
import { buildTypedEventRecord } from "../domains/events/drafts.ts";
import { loadEventLedgerShardsById, toEventLedgerFile } from "../domains/events/ledger.ts";
import { walkVaultFiles } from "../fs.ts";
import { deterministicContractId } from "../ids.ts";
import { visitJsonlRecordsInterruptible } from "../jsonl.ts";
import { withCanonicalWriteLock } from "../operations/canonical-write-lock.ts";
import { WriteBatch } from "../operations/write-batch.ts";
import { prepareInlineRawArtifact } from "../raw.ts";
import { loadVault } from "../vault.ts";
import { stageAssessmentResponse } from "./storage.ts";
import { ASSESSMENT_LEDGER_DIRECTORY, ASSESSMENT_RESPONSE_SCHEMA_VERSION } from "./types.ts";

type CheckInAction = Extract<MemberActionV1, { kind: "measurement.blood-pressure" | "assessment.respond" }>;

function measurement(metric: string, value: number, qualifiers?: MeasurementEntry["qualifiers"]): MeasurementEntry {
  const unit = resolveMetricDefinition(metric)?.canonicalUnit;
  if (!unit) throw new TypeError("Check-in metric needs a canonical unit.");
  return { metric, value, unit, ...(qualifiers && { qualifiers }) };
}

async function findResponse(vaultRoot: string, id: string) {
  for (const relativePath of await walkVaultFiles(vaultRoot, ASSESSMENT_LEDGER_DIRECTORY, { extension: ".jsonl" })) {
    let match: ReturnType<typeof assessmentResponseSchema.parse> | undefined;
    await visitJsonlRecordsInterruptible({
      vaultRoot, relativePath, shouldContinue: () => !match,
      visit: row => { if (row.id === id) match = assessmentResponseSchema.parse(row); },
    });
    if (match) return match;
  }
  return undefined;
}

function checkInEvidence(action: CheckInAction, receivedAt: string, zone: string) {
  if (action.kind === "measurement.blood-pressure") {
    const occurredAt = new Date(action.takenAt).toISOString();
    const qualifiers = action.setting && { setting: action.setting, ...(action.setting === "home" && { validated: true }) };
    return {
      occurredAt, date: action.date ?? toLocalDayKey(occurredAt, zone),
      measurements: [measurement("systolic-blood-pressure", action.systolic, qualifiers), measurement("diastolic-blood-pressure", action.diastolic, qualifiers)],
    };
  }
  const response = action.response;
  if (response.instrument === "combine") {
    return {
      response, date: response.date, occurredAt: resolveLocalDateAtNoon(response.date, zone),
      measurements: response.tests.flatMap(row => row.skipped || row.value === undefined
        ? [] : [measurement(combineProtocolKey(row).replaceAll("_", "-"), row.value)]),
    };
  }
  return { response, date: toLocalDayKey(receivedAt, zone), occurredAt: receivedAt, measurements: [] };
}

/** Check identity and commit all evidence under one vault lock, including the optional session measurements. */
export async function saveMemberCheckIn(vaultRoot: string, action: CheckInAction,
  { actionId, requestedAt }: Pick<MemberActionRequestV1, "actionId" | "requestedAt">,
): Promise<"applied" | "unchanged" | "rejected"> {
  return withCanonicalWriteLock(vaultRoot, async () => {
    const seed = `member-action:${actionId}`;
    const assessmentId = deterministicContractId(ID_PREFIXES.assessment, seed);
    const eventId = deterministicContractId(ID_PREFIXES.event, seed);
    const prior = await findResponse(vaultRoot, assessmentId);
    if (prior) {
      return action.kind === "assessment.respond" && isDeepStrictEqual(prior.responses.response, action.response)
        ? "unchanged" : "rejected";
    }
    const zone = (await loadVault({ vaultRoot })).metadata.timezone;
    const { response, occurredAt, date, measurements } = checkInEvidence(action, requestedAt, zone);
    const matches = await loadEventLedgerShardsById(vaultRoot, eventId);
    if (matches.length) {
      const original = matches.flatMap(shard => shard.matchingRecords).find(row => (row.lifecycle?.revision ?? 1) === 1);
      return action.kind === "measurement.blood-pressure" && original?.kind === "measurement"
        && original.occurredAt === occurredAt && (action.date === undefined || original.dayKey === action.date)
        && isDeepStrictEqual(original.measurements, measurements) ? "unchanged" : "rejected";
    }
    const batch = await WriteBatch.create({ vaultRoot, operationType: "member_check_in", summary: "Record member check-in", occurredAt });
    if (response) {
      const owner = { kind: "assessment", id: assessmentId } as const;
      const raw = prepareInlineRawArtifact({ fileName: "source.json", owner, occurredAt: requestedAt });
      const answers = projectedCheckInSchema.parse({ id: actionId, date, response });
      const assessment = assessmentResponseSchema.parse({
        schemaVersion: ASSESSMENT_RESPONSE_SCHEMA_VERSION, id: assessmentId, assessmentType: response.instrument,
        recordedAt: requestedAt, questionnaireSlug: `${response.instrument}-v${response.instrumentVersion}`,
        rawPath: raw.relativePath, source: "manual", responses: answers,
        ...(measurements.length ? { relatedIds: [eventId] } : {}),
      });
      const staged = await batch.stageRawText({
        targetRelativePath: raw.relativePath, originalFileName: raw.originalFileName, mediaType: raw.mediaType,
        content: JSON.stringify(answers),
      });
      await stageAssessmentResponse(batch, assessment, staged);
    }
    if (measurements.length) {
      const event = buildTypedEventRecord({
        kind: "measurement", id: eventId, title: response ? "Combine session" : "Blood pressure", source: "manual",
        dayKey: date, timeZone: zone, occurredAt, recordedAt: requestedAt, measurements,
      }, zone, { revision: 1 });
      const ledger = toEventLedgerFile(occurredAt);
      await batch.stageJsonlAppend(ledger, JSON.stringify(event) + "\n");
      await emitAuditRecord({ vaultRoot, batch, action: "event_upsert", commandName: "core.saveMemberCheckIn",
        occurredAt, summary: "Recorded check-in measurements.", targetIds: [eventId], files: [ledger] });
    }
    await batch.commit();
    return "applied";
  });
}
