import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import type { EventRecord, MealEventRecord } from "@murphai/contracts";

type Core = typeof import("../src/index.ts");
type ReadResult = Awaited<ReturnType<Core["readEvent"]>>;
type Timing = { wallMs: number; cpuMs: number };
type Encoding = "jsonl" | "gzip" | "brotli";
type Size = { shards: number; rows: number; decodedBytes: number; storedBytes: number };

class BenchmarkError extends Error {}

function check(condition: boolean, message: string): asserts condition {
  // Do not let failed assertions print events, IDs, or filesystem paths.
  if (!condition) throw new BenchmarkError(message);
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const text = process.env[name] ?? String(fallback);
  const value = Number(text);
  check(/^\d+$/.test(text) && Number.isSafeInteger(value) && value >= min && value <= max,
    `${name} must be an integer in ${min}..${max}`);
  return value;
}

async function measure<T>(work: () => Promise<T>): Promise<{ value: T; timing: Timing }> {
  const cpu = process.cpuUsage();
  const started = performance.now();
  const value = await work();
  const wallMs = performance.now() - started;
  const used = process.cpuUsage(cpu);
  return { value, timing: { wallMs, cpuMs: (used.user + used.system) / 1_000 } };
}

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0]!,
    median: sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2,
    max: sorted[sorted.length - 1]!,
  };
}

function summarize(samples: Timing[]) {
  return {
    wallMs: distribution(samples.map((sample) => sample.wallMs)),
    cpuMs: distribution(samples.map((sample) => sample.cpuMs)),
  };
}

function parity(actual: ReadResult, expected: ReadResult): void {
  check(isDeepStrictEqual(actual, expected), "full-read-result-parity-failed");
}

export async function seedFixture(core: Core, vaultRoot: string, rows: number, months: number, noteBytes: number) {
  // These runtime imports must follow the measured core import.
  const { CONTRACT_SCHEMA_VERSION, eventRecordSchema } = await import("@murphai/contracts");
  const { compressShard } = await import("../src/shard-compression.ts");
  await core.initializeVault({ vaultRoot, createdAt: "2026-02-01T00:00:00.000Z", timezone: "UTC" });

  const ownerId = core.deterministicContractId("meal", "synthetic-meal-read-owner");
  const oldOwnerId = core.deterministicContractId("meal", "synthetic-meal-read-previous-owner");
  const eventId = core.deterministicContractId("evt", "synthetic-meal-read-target");
  const monthStart = (month: number) => Date.UTC(2026, month - months + 1, 1);
  const timestamp = (month: number) => new Date(monthStart(month) + 12 * 86_400_000).toISOString();
  const shard = (month: number) => core.toMonthlyShardRelativePath("ledger/events", timestamp(month));
  const meal = (revision: number, month: number, mealId = ownerId): MealEventRecord => ({
    schemaVersion: CONTRACT_SCHEMA_VERSION.event,
    id: eventId, kind: "meal", mealId,
    occurredAt: timestamp(month), recordedAt: `2026-02-0${revision}T00:00:00.000Z`,
    dayKey: timestamp(month).slice(0, 10), timeZone: "UTC", source: "manual",
    title: "Synthetic meal", ingredients: ["synthetic grain", "synthetic vegetable"],
    lifecycle: { revision },
  });
  // Highest revision is in an archived shard, before the oldest revision in
  // traversal order. The old revision also has a different owner.
  const target = meal(3, 1);
  const revisions = new Map<number, MealEventRecord>([
    [0, meal(2, 0)], [1, target], [months - 1, meal(1, months - 1, oldOwnerId)],
  ]);
  const fresh = meal(4, months - 1);
  const sizes: Record<Encoding, Size> = {
    jsonl: { shards: 0, rows: 0, decodedBytes: 0, storedBytes: 0 },
    gzip: { shards: 0, rows: 0, decodedBytes: 0, storedBytes: 0 },
    brotli: { shards: 0, rows: 0, decodedBytes: 0, storedBytes: 0 },
  };
  const serialize = (record: EventRecord): string => {
    const parsed = eventRecordSchema.safeParse(record);
    check(parsed.success, "fixture-contract-invalid");
    return `${JSON.stringify(parsed.data)}\n`;
  };
  const metrics = [
    { metric: "synthetic-steps", unit: "count" },
    { metric: "synthetic-pulse", unit: "bpm" },
    { metric: "synthetic-mass", unit: "kg" },
  ];
  let noteRows = 0;
  for (let month = 0; month < months; month += 1) {
    const start = Math.floor(month * rows / months);
    const end = Math.floor((month + 1) * rows / months);
    const lines: string[] = [];
    for (let index = start; index < end; index += 1) {
      const occurredAt = new Date(monthStart(month)
        + Math.floor((index - start + 1) * 27 * 86_400_000 / (end - start + 1))).toISOString();
      const base = {
        schemaVersion: CONTRACT_SCHEMA_VERSION.event,
        id: core.deterministicContractId("evt", `synthetic-meal-read-unrelated-${index}`),
        occurredAt, recordedAt: occurredAt, dayKey: occurredAt.slice(0, 10), timeZone: "UTC",
        title: "Synthetic ledger history", tags: ["synthetic", "benchmark"],
      };
      if (index % 8 === 0) {
        const text = `Synthetic journal sample ${index}: walking, meals, rest, and daily activity. `;
        lines.push(serialize({
          ...base, kind: "note", source: "manual",
          note: text.repeat(Math.ceil(noteBytes / text.length)).slice(0, noteBytes),
        }));
        noteRows += 1;
      } else {
        lines.push(serialize({
          ...base, kind: "observation", source: "device", ...metrics[index % metrics.length]!,
          value: 50 + (index % 500) / 10,
          externalRef: {
            system: "synthetic", resourceType: "observation",
            resourceId: `sample-${index}`, version: occurredAt,
          },
        }));
      }
    }
    const revision = revisions.get(month);
    if (revision) lines.splice(Math.floor(lines.length / 2), 0, serialize(revision));
    const bytes = Buffer.from(lines.join(""), "utf8");
    check(bytes.byteLength <= core.MAX_EVENT_LEDGER_SHARD_BYTES, "fixture-shard-too-large");
    const encoding: Encoding = month === months - 1 ? "jsonl" : month % 2 === 0 ? "gzip" : "brotli";
    const stored = encoding === "jsonl" ? bytes : compressShard(bytes, encoding);
    check(encoding === "jsonl" || stored.byteLength <= core.MAX_EVENT_LEDGER_ARCHIVE_BYTES,
      "fixture-archive-too-large");
    const suffix = encoding === "jsonl" ? "" : encoding === "gzip" ? ".gz" : ".br";
    const destination = path.join(vaultRoot, `${shard(month)}${suffix}`);
    await mkdir(path.dirname(destination), { recursive: true });
    // One write per month; never scan accumulated history once per seeded row.
    await writeFile(destination, stored, { flag: "wx" });
    sizes[encoding].shards += 1;
    sizes[encoding].rows += lines.length;
    sizes[encoding].decodedBytes += bytes.byteLength;
    sizes[encoding].storedBytes += stored.byteLength;
  }
  return {
    ownerId, oldOwnerId,
    expected: { eventId, ledgerFile: shard(1), event: target } satisfies ReadResult,
    freshExpected: { eventId, ledgerFile: shard(months - 1), event: fresh } satisfies ReadResult,
    freshLine: serialize(fresh),
    counts: { rows: rows + 3, noteRows, observationRows: rows - noteRows, mealRevisionRows: 3 },
    sizes,
  };
}

let phase = "configuration";
async function main(): Promise<void> {
  const config = {
    rows: integer("MURPH_MEAL_READ_ROWS", 24_000, 30, 240_000),
    months: integer("MURPH_MEAL_READ_MONTHS", 24, 3, 120),
    noteBytes: integer("MURPH_MEAL_READ_NOTE_BYTES", 512, 64, 4_000),
    iterations: integer("MURPH_MEAL_READ_ITERATIONS", 10, 3, 40),
    warmups: integer("MURPH_MEAL_READ_WARMUPS", 2, 1, 10),
  };
  check(config.rows >= config.months, "rows-must-cover-every-month");
  console.log(JSON.stringify({ scenario: "configuration", fixtureVersion: 1,
    node: process.version, platform: process.platform, arch: process.arch, ...config }));

  phase = "core-import";
  const imported = await measure(() => import("../src/index.ts"));
  const core = imported.value;
  console.log(JSON.stringify({ scenario: "core-import", ...imported.timing,
    processToModuleReadyMs: performance.now(), samples: 1 }));

  phase = "fixture";
  await mkdir(".artifacts", { recursive: true });
  // No vault/path argument: this process owns only its unique synthetic child.
  const vaultRoot = await mkdtemp(path.resolve(".artifacts", "meal-read-"));
  try {
    const seeded = await measure(() => seedFixture(core, vaultRoot,
      config.rows, config.months, config.noteBytes));
    const fixture = seeded.value;
    console.log(JSON.stringify({ scenario: "fixture", ...seeded.timing,
      ...fixture.counts, byEncoding: fixture.sizes }));
    const reads = {
      owned: () => core.readOwnedEvent({ vaultRoot, kind: "meal", ownerId: fixture.ownerId }),
      control: () => core.readEvent({ vaultRoot, eventId: fixture.expected.eventId }),
    };
    const order = (iteration: number): Array<keyof typeof reads> =>
      iteration % 2 === 0 ? ["owned", "control"] : ["control", "owned"];
    phase = "warmup";
    for (let i = 0; i < config.warmups; i += 1) {
      for (const name of order(i)) parity(await reads[name](), fixture.expected);
    }
    phase = "warm-reads";
    const pairs: Array<{ first: string; owned: Timing; control: Timing }> = [];
    for (let i = 0; i < config.iterations; i += 1) {
      const names = order(i);
      const samples: Partial<Record<keyof typeof reads, Timing>> = {};
      for (const name of names) {
        const result = await measure(reads[name]);
        // Equality checking and reporting are outside the timed read.
        parity(result.value, fixture.expected);
        samples[name] = result.timing;
      }
      pairs.push({ first: names[0]!, owned: samples.owned!, control: samples.control! });
    }
    const owned = summarize(pairs.map((pair) => pair.owned));
    const control = summarize(pairs.map((pair) => pair.control));
    const ratio = (a: number, b: number) => b > 0 ? a / b : null;
    console.log(JSON.stringify({
      scenario: "warm-reads", iterations: config.iterations, parityPassed: true,
      readOwnedEvent: owned, readEventControl: control,
      ownedMinusControl: summarize(pairs.map((pair) => ({
        wallMs: pair.owned.wallMs - pair.control.wallMs,
        cpuMs: pair.owned.cpuMs - pair.control.cpuMs,
      }))),
      medianOwnedOverControl: {
        wall: ratio(owned.wallMs.median, control.wallMs.median),
        cpu: ratio(owned.cpuMs.median, control.cpuMs.median),
      },
      pairs,
    }));
    phase = "freshness";
    // Untimed append in the already-owned plain shard; both readers must see it.
    await appendFile(path.join(vaultRoot, fixture.freshExpected.ledgerFile), fixture.freshLine);
    for (const read of Object.values(reads)) parity(await read(), fixture.freshExpected);
    console.log(JSON.stringify({ scenario: "freshness", parityPassed: true }));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ scenario: "complete", fixtureRemoved: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch((error: unknown) => {
    console.error(JSON.stringify({ scenario: "failed", phase,
      reason: error instanceof BenchmarkError ? error.message : "setup-or-reader-error" }));
    process.exitCode = 1;
  });
}
