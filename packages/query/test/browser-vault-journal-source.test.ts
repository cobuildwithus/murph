import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { test } from "vitest";
import { readBrowserVaultReplicaSource } from "../src/browser-replica/source.ts";
import { createBrowserVaultReplica } from "../src/browser.ts";

test("persisted nap observations cannot replace selected overnight Journal metrics", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-journal-source-"));
  try {
    const events: Record<string, unknown>[] = [];
    for (const [id, startAt, endAt, sleepType, deep, rem] of [
      ["overnight", "2026-08-24T23:00:00Z", "2026-08-25T07:00:00Z", "main_sleep", 57, 83.5],
      ["nap", "2026-08-25T14:00:00Z", "2026-08-25T14:30:00Z", "nap", 0, 0],
    ] as const) {
      const base = {
        schemaVersion: "murph.event.v1", source: "device", dayKey: "2026-08-25",
        occurredAt: startAt, recordedAt: endAt, title: "Synthetic sleep evidence",
        externalRef: { system: "oura", resourceType: "sleep", resourceId: id },
      };
      events.push({
        ...base, id: `evt_${id}`, kind: "sleep_session", startAt, endAt, sleepType,
        durationMinutes: (Date.parse(endAt) - Date.parse(startAt)) / 60_000,
      });
      for (const [metric, value] of [["sleep-deep-minutes", deep], ["sleep-rem-minutes", rem]] as const) {
        events.push({
          ...base, id: `evt_${id}_${metric}`, kind: "observation", metric, value,
          unit: "min", observationGrain: "summary",
          externalRef: { ...base.externalRef, facet: metric },
        });
      }
    }
    await mkdir(path.join(vaultRoot, "ledger/events/2026"), { recursive: true });
    await writeFile(path.join(vaultRoot, "vault.json"), JSON.stringify({
      createdAt: "2026-08-01T00:00:00Z", formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      timezone: "UTC", title: "Synthetic Journal fixture", vaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4P",
    }));
    await writeFile(path.join(vaultRoot, "ledger/events/2026/2026-08.jsonl"),
      events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    const source = await readBrowserVaultReplicaSource(vaultRoot);
    assert.equal(source.vault.entities.filter((event) => event.kind === "observation").length, 4);
    const replica = await createBrowserVaultReplica({
      ...source, generatedAt: "2026-08-25T20:00:00Z", sourceBundleHash: "a".repeat(64),
    });
    assert.ok(replica.journal);
    const journalEvents = replica.journal.days.flatMap((day) => day.events);
    const overnight = journalEvents.find((event) => event.kind === "sleep");
    assert.ok(overnight);
    assert.equal(overnight.metrics.deepSleepMinutes, 57);
    assert.equal(overnight.metrics.remSleepMinutes, 83.5);
    assert.ok(journalEvents.some((event) => event.kind === "nap"));
    assert.ok(journalEvents.flatMap((event) => event.records)
      .every((record) => record.kind !== "observation"));
    assert.ok(replica.entities.every((entity) => entity.kind !== "observation"));
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
