import { classifyClinicalRun, type LifecycleRun } from "./run-lifecycle";
import { CLINICAL_RECORD_CONNECTION_STATUSES, CLINICAL_RECORD_MAX_SOURCES } from "./client-contracts";

type RecordsSourceState = "getting_records" | "ready" | "ready_partial" | "nothing_new"
  | "sign_in_again" | "could_not_add" | "disconnected";

export function countedSourceFilter(memberId: string) {
  return { memberId, status: { not: "disconnected" } };
}

export function hasImportCapacity(count: number) {
  return count < CLINICAL_RECORD_MAX_SOURCES;
}

// The hosted runtime's terminal outcomes for a retrieval whose import stopped
// (hosted-runtime/clinical-records-maintenance.ts); they keep raw evidence, so
// the run is partial even when nothing was saved.
const TERMINAL_IMPORT_FAILURES = new Set(["snapshot_rejected", "cursor_cycle", "invalid_fhir_page"]);

function count(receipt: unknown, key: string): number | null {
  if (!receipt || typeof receipt !== "object") return null;
  const value: unknown = Reflect.get(receipt, key);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function classifyClinicalSource(status: string, run: LifecycleRun | undefined, lastErrorCode: string | null, canAdd = true, now = new Date()) {
  const lifecycle = classifyClinicalRun(run, now);
  const unknownStatus = !CLINICAL_RECORD_CONNECTION_STATUSES.some(value => value === status) || lifecycle === "unknown";
  const receipt = run?.outcomeCountsJson;
  const addedCount = count(receipt, "createdCount");
  const lastImport = addedCount === null ? null : { addedCount, labResultCount: count(receipt, "labResultCount") };
  const effects = [addedCount, count(receipt, "supersededCount"), count(receipt, "retractedCount")];
  function resolveState(): RecordsSourceState {
    if (unknownStatus) return "could_not_add";
    if (status === "disconnected") return "disconnected";
    if (status === "needs_reauth" || run?.status === "needs_reauth") return "sign_in_again";
    if (status === "error" || !run) return "could_not_add";
    switch (run.status) {
      case "queued":
      case "retrieving": return run.completedAt ? "could_not_add" : "getting_records";
      case "partial":
        if (effects.some(n => n !== null && n > 0)) return "ready_partial";
        // A partial reread that changed nothing still saved what it could
        // reach, unless the runtime stopped importing the snapshot.
        return effects.every(n => n === 0) && !TERMINAL_IMPORT_FAILURES.has(lastErrorCode ?? "") ? "ready_partial" : "could_not_add";
      case "complete":
        if (effects.some(n => n !== null && n > 0)) return "ready";
        return effects.every(n => n === 0) ? "nothing_new" : "could_not_add";
      default: return "could_not_add";
    }
  }
  const state = resolveState();
  const actions: ("import_again" | "sign_in_again" | "start_over" | "remove")[] = [];
  if (!unknownStatus && (status !== "disconnected" || canAdd) && lifecycle !== "awaiting_counts") {
    if (state === "sign_in_again" || state === "disconnected") actions.push("sign_in_again");
    else if (lifecycle === "busy" || lifecycle === "recoverable") actions.push("start_over");
    else actions.push("import_again");
  }
  if (status !== "disconnected") actions.push("remove");
  const reason = run?.status === "partial" && lastErrorCode === "provider-search-incomplete" && status === "active"
    ? "limited_by_hospital" as const : null;
  return { state, reason, lastImport, actions, unknownStatus };
}
