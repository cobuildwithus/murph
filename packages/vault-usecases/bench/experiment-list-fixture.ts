import assert from "node:assert/strict";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type * as Core from "@murphai/core";
import type { VaultServices } from "@murphai/vault-usecases/vault-services";
import { seedSleepFixture } from "./wearable-sleep-fixture.ts";

export const experimentDays = 30;
export const experimentCount = 12;
export const experimentNow = "2026-04-01T12:00:00.000Z";
export const experimentPath = (index: number) => `bank/experiments/synthetic-list-${index}.md`;

// Reuse the real wearable/event factory: 720 observations, 90 sessions, 30 notes.
// Experiment documents use the current authoring contract and serializer.
export async function seedExperimentListFixture(core: typeof Core, vault: string, count = experimentCount) {
  const wearable = await seedSleepFixture(core, vault, experimentDays);
  const { EXPERIMENT_STATUSES, experimentFrontmatterSchema } = await import("@murphai/contracts");
  await core.withCanonicalWriteLock(vault, async () => {
    await mkdir(path.join(vault, "bank/experiments"), { recursive: true });
    // Reverse creation order plus tied dates exercises canonical sorting, not readdir order.
    for (let index = count - 1; index >= 0; index--) {
      const attributes = experimentFrontmatterSchema.parse({
        schemaVersion: "murph.frontmatter.experiment.v1", docType: "experiment",
        experimentId: core.deterministicContractId("exp", `synthetic-list-${index}`),
        slug: `synthetic-list-${index}`, title: `Synthetic experiment ${index}`,
        status: EXPERIMENT_STATUSES[index % EXPERIMENT_STATUSES.length],
        startedOn: `2026-01-${String(1 + Math.floor(index / 2)).padStart(2, "0")}`,
        ...(index % 2 === 0 ? {} : {
          hypothesis: "A regular evening walk may support a consistent routine. ".repeat(5),
          tags: ["synthetic", "evening-routine"],
          commonsProtocolRef: { key: "protocol_variant:synthetic-walk/standard",
            pageRevisionId: `sha256:${"1".repeat(64)}`, runSpecRevisionId: `sha256:${"2".repeat(64)}` },
          protocolRef: { protocolId: core.deterministicContractId("prot", "synthetic-walk"),
            protocolRevisionId: `sha256:${"3".repeat(64)}`, effectiveSpecHash: `sha256:${"4".repeat(64)}` },
          effectiveProtocolSnapshot: { effectiveSpecHash: `sha256:${"4".repeat(64)}`,
            doseSignature: "Twelve short evening walks during the synthetic month" },
          runPlan: { interventionStart: "2026-01-01", interventionEnd: "2026-01-30",
            modality: "walking", targetSessions: 12, minimumUsefulSessions: 8 },
          analysisPlan: { primaryBiomarkerKey: "biomarker:sleep-efficiency",
            secondaryBiomarkerKeys: ["biomarker:resting-heart-rate"],
            expectedDirections: [{ biomarkerKey: "biomarker:sleep-efficiency", direction: "increase" }] },
        }),
      });
      await writeFile(path.join(vault, experimentPath(index)), core.stringifyFrontmatterDocument({ attributes,
        body: `# Synthetic experiment ${index}\n\nA private-free synthetic plan with [context](bank/journal/2026/2026-01-01.md).\n` }));
    }
    const event = { schemaVersion: "murph.event.v1", id: "evt_synthetic_list_history", kind: "note",
      source: "manual", title: "Synthetic retired context", occurredAt: "2026-01-01T12:00:00Z",
      recordedAt: "2026-01-01T12:00:00Z", experimentSlug: "synthetic-list-1" };
    await appendFile(path.join(vault, "ledger/events/2026/2026-01.jsonl"),
      [1, 2, 3].map(revision => JSON.stringify({ ...event,
        recordedAt: `2026-01-0${revision}T12:00:00Z`,
        lifecycle: { revision, ...(revision === 3 ? { state: "deleted" } : {}) },
      })).join("\n") + "\n");
  });
  return { ...wearable, experiments: count, historyRows: 3 };
}

export async function readExperimentListProof(services: VaultServices, vault: string, edited = false) {
  const result = await services.query.listExperiments({ vault, requestId: "synthetic-experiment-list-benchmark", limit: 100 });
  assert.equal(result.count, result.items.length);
  assert.equal(result.count, experimentCount);
  assert.equal(result.nextCursor, null);
  const first = result.items.find(item => item.data.slug === "synthetic-list-0");
  assert.ok(first);
  assert.equal(first.title, edited ? "Revised synthetic experiment" : "Synthetic experiment 0");
  assert.equal(first.data.status, edited ? "paused" : "planned");
  return result;
}
