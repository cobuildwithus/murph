import { describe, expect, it } from "vitest";
import { inventoryHostedLegacyRuntime, migrateHostedLegacyRuntime, type RuntimeMigrationOperator } from "../scripts/runtime-migration.ts";

const first = "a".repeat(64);
const second = "b".repeat(64);
function harness(options: { drift?: boolean; split?: boolean; held?: boolean } = {}) {
  const sent: string[] = [];
  let scans = 0;
  let gate: Record<string, unknown> = {};
  let imported = 0;
  const input: RuntimeMigrationOperator = {
    accountId: "a".repeat(32), scriptName: "synthetic-worker", workerVersion: "synthetic-version",
    cloudflareToken: "synthetic-token", workerBaseUrl: "https://worker.example.test",
    workerAuthorization: async () => new Headers({ authorization: "Bearer synthetic-oidc" }),
    fetchImpl: async (request, init) => {
      const url = new URL(String(request));
      if (url.hostname === "api.cloudflare.com") {
        expect(init?.method ?? "GET").toBe("GET");
        if (url.pathname.endsWith("/deployments")) return Response.json({ success: true, result: { deployments: [{ versions: [{ percentage: options.split ? 50 : 100, version_id: "synthetic-version" }] }] } });
        if (url.pathname.endsWith("/namespaces")) return Response.json({ success: true, result: [{ id: "c".repeat(32), script: "synthetic-worker", class: "UserRunnerDurableObject", use_sqlite: true }], result_info: { total_pages: 1 } });
        if (url.searchParams.get("cursor") === "next") return Response.json({ success: true, result: [{ id: second, hasStoredData: false }], result_info: {} });
        scans++;
        return Response.json({ success: true, result: [{ id: options.drift && scans > 1 ? "d".repeat(64) : first, hasStoredData: true }], result_info: { cursor: "next" } });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-oidc");
      const command = JSON.parse(String(init?.body));
      sent.push(command.operation);
      if (command.operation === "begin") {
        const { createHash } = await import("node:crypto");
        gate = { phase: "draining", inventoryAfter: "", inventoryCount: 0, inventoryHash: createHash("sha256").update("").digest("hex") };
      } else if (command.operation === "inventory") {
        const { createHash } = await import("node:crypto");
        let hash = String(gate.inventoryHash);
        for (const id of command.objectIds) hash = createHash("sha256").update(`${hash}\n${id}`).digest("hex");
        gate = { ...gate, inventoryCount: command.objectIds.length, inventoryHash: hash, inventorySealedAt: "2026-01-01T00:00:00.000Z" };
      } else if (command.operation === "read_object") {
        imported++;
        return Response.json(options.held ? { draining: true } : { object: { completedAt: "2026-01-01T00:00:00.000Z" } });
      } else if (command.operation === "activate") gate.phase = "postgres";
      return Response.json({ gate });
    },
  };
  return { input, sent, imported: () => imported };
}

describe("legacy fleet migration operator", () => {
  it("requires a converged release and follows namespace cursors including objects without stored data", async () => {
    const h = harness();
    expect((await inventoryHostedLegacyRuntime(h.input)).objectIds).toEqual([first, second]);
    await expect(inventoryHostedLegacyRuntime(harness({ split: true }).input)).rejects.toThrow("100% of traffic");
  });
  it("keeps activation separate and refuses inventory drift or held uploads", async () => {
    const imported = harness();
    expect(await migrateHostedLegacyRuntime({ ...imported.input, activate: false })).toEqual({ phase: "imported", importedObjects: 2 });
    expect(imported.sent).not.toContain("activate");
    const changed = harness({ drift: true });
    await expect(migrateHostedLegacyRuntime({ ...changed.input, activate: true })).rejects.toThrow("inventory changed");
    expect(changed.sent).not.toContain("activate");
    const held = harness({ held: true });
    expect(await migrateHostedLegacyRuntime({ ...held.input, activate: true })).toEqual({ phase: "draining", importedObjects: 0 });
    expect(held.sent).not.toContain("activate");
    const complete = harness();
    expect(await migrateHostedLegacyRuntime({ ...complete.input, activate: true })).toEqual({ phase: "postgres", importedObjects: 2 });
  });
});
