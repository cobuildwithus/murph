import { generateContractId } from "@murphai/contracts";
import { analyzeExperimentOutcome, buildMetricProjection, createVaultReadModel, type CanonicalEntity } from "@murphai/query";
import { createBrowserVaultReplica } from "@murphai/query/browser-replica-server";

function entity(family: "experiment" | "event", kind: string, date: string, attributes: Record<string, unknown>): CanonicalEntity {
  const id = generateContractId(family === "experiment" ? "exp" : "evt");
  return {
    entityId: id, primaryLookupId: id, lookupIds: [id], family, kind, attributes,
    recordClass: family === "experiment" ? "bank" : "ledger", occurredAt: date + "T12:00:00Z", date,
    path: `fixture/${id}`, title: null, body: null, frontmatter: null, status: null, stream: null,
    experimentSlug: null, links: [], relatedIds: [], tags: [],
  };
}

function experiment(modality: string, month: string, targetSessions: number) {
  const slug = modality.toLowerCase();
  const runPlan = { modality, baselineStart: month + "-01", baselineEnd: month + "-04",
    interventionStart: month + "-05", interventionEnd: month + "-23", targetSessions,
    schedule: { kind: "dailyLocal", localTime: "08:30", timeZone: "UTC" } };
  const row = entity("experiment", "experiment", runPlan.baselineStart, {});
  row.experimentSlug = slug;
  row.status = "completed";
  row.attributes = { docType: "experiment", schemaVersion: "murph.frontmatter.experiment.v1", experimentId: row.entityId,
    title: modality, slug, status: row.status, startedOn: runPlan.baselineStart, runPlan,
    analysisPlan: { primaryBiomarkerKey: "biomarker:resting-heart-rate", desiredDirection: "decrease" } };
  return row;
}

/** Use real daily adherence, banked outcomes and core event projection in both the adapter and route proofs. */
export async function experimentReplica() {
  const manual = experiment("Meditation", "2025-04", 10);
  const running = experiment("Running", "2025-05", 15);
  const session = (day: number, link: Record<string, unknown>, status = "completed", source = "manual") =>
    entity("event", "intervention_session", "2025-04-24", {
      sessionLocalDate: "2025-04-" + String(day).padStart(2, "0"), interventionType: "meditation", source, sessionStatus: status, ...link,
    });
  const byId = { experimentId: manual.entityId };
  const bySlug = { experimentSlug: manual.experimentSlug };
  const entities = [manual, running,
    ...[5, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 23].map((day, i) => session(day, i % 2 ? byId : bySlug)),
    session(4, byId), session(24, bySlug), session(7, {}), session(8, { experimentId: running.entityId }),
    session(8, byId, "partial"), session(9, byId, "missed"), session(10, byId, "skipped"), session(20, byId, "completed", "derived"),
    ...Array.from({ length: 11 }, (_, i) => entity("event", "activity_session", "2025-05-" + String(5 + i).padStart(2, "0"),
      { activityType: "running", durationMinutes: 30, source: "device" })),
    ...["2025-04", "2025-05"].flatMap(month => ["02", "18"].map(day =>
      entity("event", "observation", month + "-" + day, { dayKey: month + "-" + day, metric: "resting_heart_rate",
        unit: "bpm", value: day === "02" ? 66 : 61, source: "device" }))),
  ];
  const vault = createVaultReadModel({ vaultRoot: "/virtual/experiment-logs", entities, metadata: { timezone: "UTC" } });
  const asOf = "2025-05-27";
  const { metricPoints } = buildMetricProjection(vault);
  const experimentOutcomes = ["meditation", "running"].map(slug => analyzeExperimentOutcome(vault, slug, { asOf, metricPoints }));
  return createBrowserVaultReplica({ vault, metricPoints, experimentOutcomes, generatedAt: asOf + "T12:00:00Z", sourceBundleHash: "a".repeat(64) });
}
