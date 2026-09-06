/** Private-safe diagnostic wire contract. No command arguments or result data. */
export const CLI_TIMING_ENDPOINT_ENV = "MURPH_CLI_TIMING_ENDPOINT";
export const CLI_TIMING_SCHEMA = "murph.cli-timing.v1";
export const CLI_TIMING_MAX_COMMANDS = 32;
export const CLI_TIMING_MAX_SPANS = 64;
export const CLI_TIMING_MAX_REPORTS = 256;
export const CLI_TIMING_EVENT_METHOD = "murph/cliTiming";
// Complete UDP envelope, including key/ticks. Keep below the supported macOS
// 9 KiB datagram limit; large summaries are trimmed, not split or retried.
export const CLI_TIMING_MAX_REPORT_BYTES = 8_192;
export const CLI_TIMING_BUCKET_UPPER_US = [
  250_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 30_000_000, 60_000_000,
] as const;
export const CLI_TIMING_PHASES = [
  "total", "setup", "dispatch", "post-dispatch", "teardown", "unattributed",
  "query-freshness", "query-manifest", "query-status", "query-rebuild", "query-wait",
] as const;
export type CliTimingPhase = typeof CLI_TIMING_PHASES[number];
export type CliTimingOutcome = "ok" | "error" | "unknown";

// Registered paths from the source-owned CLI catalog (incur.generated.ts).
// New names require consumer-first admission here; until then they become other.
// The CLI test compares this vocabulary to the real registered command tree.
const commandGroups: Readonly<Record<string, string>> = {
  "age": "calculate|calculate-bundle|evidence|inputs|model-cards|preview|preview-view|report|scaffold",
  "allergy": "import-json|list|save|scaffold|show",
  "assertion": "import-json|payload-schema|save|scaffold",
  "assistant": "ask|chat|deliver|doctor|onboarding complete|onboarding reopen|onboarding resume-context|onboarding status|run|self-target clear|self-target list|self-target set|self-target show|session list|session show|status|stop",
  "audit": "list|show|tail",
  "automation": "edit|import-json|list|reconcile-support-series|save|scaffold|set-status|show",
  "batch": "",
  "blood-test": "import-json|list|payload-schema|save|scaffold|show",
  "capture": "add|import-json|list|manifest|payload-schema|show",
  "chat": "",
  "clinical-note": "import-json|payload-schema|scaffold",
  "commons": "goal list|goal show|knowledge search|protocol explore|protocol list|protocol show",
  "condition": "import-json|list|payload-schema|save|scaffold|show",
  "device": "account disconnect|account list|account reconcile|account show|connect|daemon start|daemon status|daemon stop|provider list",
  "diagnostic-test": "import-json|payload-schema|save|scaffold",
  "doctor": "",
  "document": "delete|edit|import|list|manifest|show|workout-import-status",
  "encounter": "import-json|payload-schema|scaffold",
  "event": "adverse-effect add|dedupe-device-imports|delete|edit|encounter add|exposure add|import-json|import-jsonl|list|medication-intake add|note add|observation add|payload-schema|procedure add|scaffold|show|supplement-intake add|symptom add",
  "exercise": "facets|list|show",
  "experiment": "checkpoint|context log|edit|followup due|list|outcome analyze|outcome write|progress|progress-card|session attach|session detach|session log|show|start|stop",
  "export": "pack create|pack list|pack materialize|pack prune|pack show",
  "family": "import-json|list|save|scaffold|show",
  "food": "delete|edit|import-json|list|rename|save|scaffold|schedule|search-labels|search-labels-batch|show|unschedule",
  "genetics": "import-json|list|save|scaffold|show",
  "goal": "import-json|list|save|scaffold|show",
  "habitat": "catalog|coverage|list|save|show",
  "immunization": "import-json|list|payload-schema|save|scaffold|show",
  "init": "",
  "intake": "import|list|manifest|project|show",
  "intervention": "add|delete|edit",
  "journal": "append|ensure|link|list|show|unlink",
  "knowledge": "append-section|index rebuild|lint|list|log tail|score-challenge|search|show|upsert",
  "list": "",
  "meal": "add|closeout-work|delete|edit|import-json|list|manifest|nutrients|remove-photo|show|totals",
  "measurement": "add|entry list|import-json|list|manifest|show",
  "medication": "history add",
  "memory": "forget|set-name|show|update|upsert",
  "model": "",
  "protocol": "import-json|list|show",
  "provider": "delete|edit|import-json|list|save|scaffold|show",
  "query": "projection rebuild|projection status",
  "recipe": "delete|edit|import-json|list|save|scaffold|show",
  "regimen": "import-json|list|save|scaffold|show|stop",
  "research": "payload-schema|scout|scout-batch|scout-batch-payload-schema",
  "route": "estimate|resolve-address",
  "run": "",
  "samples": "add|batch list|batch show|csv import|csv profile|import-csv|import-json|list|show|summarize",
  "scheduled-log": "archive|import-json|list|pause|resume|save|scaffold|show",
  "search": "query",
  "show": "",
  "social-history": "import-json|payload-schema|scaffold",
  "status": "",
  "stop": "",
  "supplement": "compound list|compound show|list|save|search-labels|search-labels-batch|show|stop",
  "timeline": "",
  "validate": "",
  "vault": "compact-inbox-parser-attempts|repair|repair-experiment-media|repair-inbox-envelopes|repair-integration-ingests|repair-junction-hr-zones|repair-wearable-storage|show|stats|update",
  "vitals": "import-json|payload-schema|save|scaffold",
  "wearables": "activity list|body list|day|drift|latest|metric latest|metric trend|patterns|recovery list|sleep list|sleep pattern|sources list",
  "workout": "add|defaults set|defaults show|delete|edit|exercise add|exercise set-reps|finish|format import-json|format list|format log|format save|format show|import csv|import inspect|import-json|list|manifest|payload-schema|set clear|set log|show|start|units set|units show",
};
const commandNames = new Set([
  "other",
  ...Object.entries(commandGroups).flatMap(([root, leaves]) =>
    leaves.split("|").map((leaf) => leaf ? `${root} ${leaf}` : root)),
]);
export function cliTimingCommand(value: unknown): string {
  return typeof value === "string" && commandNames.has(value) ? value : "other";
}
export interface CliPhaseTiming {
  phase: CliTimingPhase;
  count: number;
  sumUs: number;
  maxUs: number;
  buckets: number[];
}
export interface CliCommandTiming {
  command: string;
  outcome: CliTimingOutcome;
  calls: number;
  phases: CliPhaseTiming[];
}
export interface CliTiming {
  schema: typeof CLI_TIMING_SCHEMA;
  commands: CliCommandTiming[];
  reportCount: number;
  transportTruncated: boolean;
  outOfWindowReports: number;
  batchContainers: number;
  droppedCalls: number;
  droppedSpans: number;
}
export function emptyCliTiming(): CliTiming {
  return { schema: CLI_TIMING_SCHEMA, commands: [], reportCount: 0, transportTruncated: false, outOfWindowReports: 0, batchContainers: 0,
    droppedCalls: 0, droppedSpans: 0 };
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function phaseName(value: unknown): value is CliTimingPhase {
  return CLI_TIMING_PHASES.some((phase) => phase === value);
}

/** Validate the histogram after the phase's scalar/array shape is established. */
function validPhaseHistogram(phase: CliPhaseTiming): boolean {
  const count = phase.buckets.reduce((sum, bucket) => sum + bucket, 0);
  if (!integer(count) || count !== phase.count) return false;
  // The maximum lies in the highest occupied bucket. The sum must be feasible
  // without multiplying unsafe integers; nested phases are checked independently.
  let highest = 7;
  while (highest > 0 && phase.buckets[highest] === 0) highest -= 1;
  if (bucketIndex(phase.maxUs) !== highest || phase.sumUs / phase.count > phase.maxUs) return false;
  let minimum = 0;
  for (let index = 1; index < 8; index += 1) {
    minimum += phase.buckets[index]! * CLI_TIMING_BUCKET_UPPER_US[index - 1]!;
  }
  return integer(minimum) && minimum <= phase.sumUs;
}

function normalizePhaseTiming(value: unknown): CliPhaseTiming | null {
  const phase = record(value);
  if (!phase || !phaseName(phase.phase) || !integer(phase.count) || phase.count < 1 ||
      !integer(phase.sumUs) || !integer(phase.maxUs) || phase.maxUs > phase.sumUs ||
      !Array.isArray(phase.buckets) || phase.buckets.length !== 8 || !phase.buckets.every(integer)) return null;
  const timing = { phase: phase.phase, count: phase.count, sumUs: phase.sumUs,
    maxUs: phase.maxUs, buckets: [...phase.buckets] };
  return validPhaseHistogram(timing) ? timing : null;
}

function normalizeCommandTiming(value: unknown): CliCommandTiming | null {
  const command = record(value);
  if (!command || typeof command.command !== "string" ||
      cliTimingCommand(command.command) !== command.command || command.command === "batch" ||
      (command.outcome !== "ok" && command.outcome !== "error" && command.outcome !== "unknown") ||
      !integer(command.calls) || command.calls < 1 || !Array.isArray(command.phases) ||
      command.phases.length > CLI_TIMING_PHASES.length) return null;
  const phases: CliPhaseTiming[] = [];
  const names = new Set<CliTimingPhase>();
  for (const entry of command.phases) {
    const phase = normalizePhaseTiming(entry);
    if (!phase || names.has(phase.phase)) return null;
    names.add(phase.phase);
    phases.push(phase);
  }
  return { command: command.command, outcome: command.outcome, calls: command.calls, phases };
}

/** Strip extras and reject malformed optional telemetry, never legacy accounting. */
export function normalizeCliTiming(value: unknown): CliTiming | null {
  try {
    const source = record(value);
    if (!source || source.schema !== CLI_TIMING_SCHEMA ||
        !Array.isArray(source.commands) || source.commands.length > CLI_TIMING_MAX_COMMANDS ||
        !integer(source.reportCount) || !integer(source.outOfWindowReports) || typeof source.transportTruncated !== "boolean" ||
        !integer(source.batchContainers) || !integer(source.droppedCalls) ||
        !integer(source.droppedSpans)) return null;
    const commands: CliCommandTiming[] = [];
    const identities = new Set<string>();
    for (const entry of source.commands) {
      const command = normalizeCommandTiming(entry);
      if (!command) return null;
      const identity = `${command.command}:${command.outcome}`;
      if (identities.has(identity)) return null;
      identities.add(identity);
      commands.push(command);
    }
    return { schema: CLI_TIMING_SCHEMA, commands, reportCount: source.reportCount,
      transportTruncated: source.transportTruncated, outOfWindowReports: source.outOfWindowReports, batchContainers: source.batchContainers,
      droppedCalls: source.droppedCalls, droppedSpans: source.droppedSpans };
  } catch { return null; }
}

function bucketIndex(us: number): number {
  const index = CLI_TIMING_BUCKET_UPPER_US.findIndex((upper) => us < upper);
  return index < 0 ? 7 : index;
}
export function addCliPhaseSample(phases: CliPhaseTiming[], phase: CliTimingPhase, us: number): boolean {
  if (!phaseName(phase) || !integer(us)) return false;
  let target = phases.find((entry) => entry.phase === phase);
  if (!target) {
    if (phases.length >= CLI_TIMING_PHASES.length) return false;
    target = { phase, count: 0, sumUs: 0, maxUs: 0, buckets: Array<number>(8).fill(0) };
    phases.push(target);
  }
  if (!integer(target.sumUs + us) || !integer(target.count + 1)) return false;
  target.count += 1;
  target.sumUs += us;
  target.maxUs = Math.max(target.maxUs, us);
  target.buckets[bucketIndex(us)]! += 1;
  return true;
}
export function incrementCliTimingDrop(value: number, count = 1): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + count);
}
/** Merge bounded summaries atomically per command; an overflow drops that command. */
export function mergeCliTiming(target: CliTiming, source: CliTiming): void {
  target.reportCount = incrementCliTimingDrop(target.reportCount, source.reportCount);
  target.outOfWindowReports = incrementCliTimingDrop(target.outOfWindowReports, source.outOfWindowReports);
  target.transportTruncated ||= source.transportTruncated;
  target.batchContainers = incrementCliTimingDrop(target.batchContainers, source.batchContainers);
  target.droppedCalls = incrementCliTimingDrop(target.droppedCalls, source.droppedCalls);
  target.droppedSpans = incrementCliTimingDrop(target.droppedSpans, source.droppedSpans);
  for (const entry of source.commands) {
    const index = target.commands.findIndex((item) =>
      item.command === entry.command && item.outcome === entry.outcome);
    const current = target.commands[index];
    if (!current) {
      if (target.commands.length >= CLI_TIMING_MAX_COMMANDS) {
        target.droppedCalls = incrementCliTimingDrop(target.droppedCalls, entry.calls);
      } else {
        target.commands.push({ ...entry, phases: entry.phases.map((phase) =>
          ({ ...phase, buckets: [...phase.buckets] })) });
      }
      continue;
    }
    const merged = { ...current, calls: current.calls + entry.calls,
      phases: current.phases.map((phase) => ({ ...phase, buckets: [...phase.buckets] })) };
    let valid = integer(merged.calls);
    for (const phase of entry.phases) {
      const old = merged.phases.find((item) => item.phase === phase.phase);
      if (!old) { merged.phases.push({ ...phase, buckets: [...phase.buckets] }); continue; }
      old.count += phase.count;
      old.sumUs += phase.sumUs;
      old.maxUs = Math.max(old.maxUs, phase.maxUs);
      old.buckets = old.buckets.map((count, index) => count + phase.buckets[index]!);
      valid &&= integer(old.count) && integer(old.sumUs) && old.buckets.every(integer);
    }
    if (valid) target.commands[index] = merged;
    else target.droppedCalls = incrementCliTimingDrop(target.droppedCalls, entry.calls);
  }
}
