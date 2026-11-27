import { request } from "node:http";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { it, vi } from "vitest";
import { activeIdentities, observeSnapshot, retainFixtures, vaultFamilyCounts, verifyDocuments } from "./evidence";
import { initializeVault } from "@murphai/core";
import { restoreHostedBundleRoots, sha256HostedBundleHex } from "@murphai/runtime-state/node";
import { checkpointClinicalMailboxItem, type ClinicalCheckpointInput } from "@murphai/assistant-runtime/clinical-connector-testkit";
import type * as Importer from "@murphai/importers/clinical-records";
import { check, families } from "./policy";

const documents = new Map<string, number>();
const counts = Object.fromEntries([...families, "review", "retract", "upsert", "downloaded", "parsed", "queued"].map(k => [k, 0]));
// Observe the actual plan passed to the writer, including intentional raw-only records.
vi.mock("@murphai/importers/clinical-records", async importOriginal => {
  const importer = await importOriginal<typeof Importer>();
  return { ...importer, buildClinicalImportPlanFromSnapshot(input: Parameters<typeof Importer.buildClinicalImportPlanFromSnapshot>[0]) {
    const plan = importer.buildClinicalImportPlanFromSnapshot(input);
    const resources = observeSnapshot(input, counts, documents);
    check(plan.decisions.length >= resources);
    for (const decision of plan.decisions) {
      counts[decision.action]!++;
      if (decision.action !== "upsert") check(decision.reason.trim());
    }
    return plan;
  } };
});
const dir = process.env.PROOF_DIR!;
async function rpc<T>(name: string, value?: unknown): Promise<T> {
  return new Promise((done, fail) => {
    const req = request({ socketPath: process.env.PROOF_SOCKET, method: "POST", path: "/" + name }, async res => {
      try {
        check(res.statusCode === 200);
        const chunks: Buffer[] = [];
        for await (const chunk of res) chunks.push(chunk);
        done(JSON.parse(Buffer.concat(chunks).toString()));
      } catch { fail(new Error("Clinical runtime callback failed.")); }
    });
    req.on("error", fail);
    req.end(JSON.stringify(value));
  });
}

it("publishes and restores the clinical mailbox checkpoint", async () => {
  const generation = Number(process.env.PROOF_GENERATION);
  check([1, 2, 3].includes(generation) && !Object.keys(process.env).some(k => k.startsWith("EPIC_SMART_")));
  const vaultRoot = join(dir, "vault-" + (generation - 1));
  if (generation === 1) await initializeVault({ vaultRoot, timezone: "UTC" });
  const previous = generation > 1 ? await activeIdentities(vaultRoot) : null;
  const restored = join(dir, "vault-" + generation);
  const wake = await rpc<Pick<ClinicalCheckpointInput, "wake" | "item"> & { connection: string }>("wake");
  await checkpointClinicalMailboxItem({ ...wake, workspaceRoot: dir, vaultRoot,
    port: { readRun: v => rpc("readRun", v), fetchPage: v => rpc("fetchPage", v),
      fetchDocument: v => rpc("fetchDocument", v), recordOutcome: v => rpc("recordOutcome", v) },
    publishAndRestore: async ref => {
      const published = await rpc<typeof ref>("publish", ref);
      check(published.key === ref.key && published.hash === ref.hash);
      const bytes = await readFile(join(dir, ref.key));
      check(bytes.length === published.size && sha256HostedBundleHex(bytes) === published.hash);
      await restoreHostedBundleRoots({ bytes, expectedKind: "vault", roots: { vault: restored } });
      return restored;
    } });
  await verifyDocuments(restored, documents, counts);
  const identities = await activeIdentities(restored);
  if (previous) check(identities === previous);
  if (generation === 1 && process.env.PROOF_CAPTURE === "1") await retainFixtures(dir, restored, wake.wake.runId, wake.connection);
  const vault = await vaultFamilyCounts(restored, wake.connection);
  await writeFile(join(dir, "counts.json"), JSON.stringify({ plan: counts, vault }), { mode: 0o600 });
});
