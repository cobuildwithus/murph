import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryHostedLegacyRuntime, migrateHostedLegacyRuntime, type RuntimeMigrationOperator } from "../scripts/runtime-migration.ts";

const first = "a".repeat(64);
const second = "b".repeat(64);
const intentOnly = "c".repeat(64);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function harness(options: { drift?: boolean; split?: boolean; held?: boolean; intent?: boolean; loseAdvance?: boolean; loseSeal?: boolean; pending?: string[] } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const known = new Set<string>(options.intent ? [intentOnly] : []);
  const imported = new Set<string>();
  const activated = new Set<string>();
  const tokens = new Map<string, string>();
  let scans = 0; let authorizations = 0;
  let gate: Record<string, unknown> = { phase: "legacy" };
  const input: RuntimeMigrationOperator = {
    accountId: "a".repeat(32), scriptName: "synthetic-worker", workerVersion: "synthetic-version",
    cloudflareToken: "synthetic-token", workerBaseUrl: "https://worker.example.test",
    workerAuthorization: async () => { authorizations++; return new Headers({ authorization: "Bearer synthetic-oidc" }); },
    fetchImpl: async (request, init) => {
      const url = new URL(String(request));
      if (url.hostname === "api.cloudflare.com") {
        expect(init?.method ?? "GET").toBe("GET");
        if (url.pathname.endsWith("/deployments")) return Response.json({ success: true, result: { deployments: [{ versions: [{ percentage: options.split ? 50 : 100, version_id: "synthetic-version" }] }] } });
        if (url.pathname.endsWith("/namespaces")) return Response.json({ success: true, result: [{ id: "c".repeat(32), script: "synthetic-worker", class: "UserRunnerDurableObject", use_sqlite: true }], result_info: { total_pages: 1 } });
        if (url.searchParams.get("cursor") === "next") return Response.json({ success: true, result: [{ id: second, hasStoredData: false }], result_info: {} });
        scans++;
        return Response.json({ success: true, result: [{ id: options.drift && scans > 2 ? "d".repeat(64) : first, hasStoredData: true }], result_info: { cursor: "next" } });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-oidc");
      const command = JSON.parse(String(init?.body));
      sent.push(command);
      if (command.operation === "begin_rolling") {
        if (gate.phase === "legacy") gate = { phase: "rolling", inventoryAfter: "", inventoryCount: 0, inventoryHash: digest("") };
      } else if (command.operation === "discover") {
        expect(gate.inventorySealedAt).toBeUndefined();
        for (const id of command.objectIds) known.add(id);
      } else if (command.operation === "close_legacy_creation") {
        gate.creationClosedAt = "2026-09-15T00:00:00.000Z";
      } else if (command.operation === "list_inventory") {
        return Response.json({ objects: [...known].sort().filter(id => id > command.after).map(objectId => ({ objectId })), nextAfter: null });
      } else if (command.operation === "inventory") {
        expect(gate.creationClosedAt).toBeTruthy();
        let hash = String(gate.inventoryHash);
        for (const id of command.objectIds) hash = digest(`${hash}\n${id}`);
        gate = { ...gate, inventoryCount: Number(gate.inventoryCount) + command.objectIds.length, inventoryHash: hash,
          inventoryAfter: command.objectIds.at(-1) ?? gate.inventoryAfter, inventorySealedAt: command.complete ? "2026-09-15T00:00:00.000Z" : null };
        if (options.loseSeal) { options.loseSeal = false; throw new Error("synthetic lost seal response"); }
      } else if (command.operation === "next_object") {
        return Response.json({ objectId: [...known].sort().find(id => !activated.has(id)) ?? null });
      } else if (command.operation === "inspect_object") {
        return Response.json({ objectId: command.objectId, observation: { kind: "observed", userId: command.objectId === first ? "synthetic-member" : null } });
      } else if (command.operation === "advance_member" || command.operation === "advance_empty") {
        expect(command.objectId).toBe([...known].sort().find(id => !activated.has(id)));
        if (command.operation === "advance_member") {
          if (tokens.has(command.objectId)) expect(command.migrationId).toBe(tokens.get(command.objectId));
          tokens.set(command.objectId, command.migrationId);
          if (options.held) return Response.json({ pending: "readiness" });
          const pending = options.pending?.shift();
          if (pending) return Response.json({ pending });
          if (!imported.has(command.objectId)) {
            imported.add(command.objectId);
            if (options.loseAdvance) { options.loseAdvance = false; throw new Error("synthetic lost import response"); }
            return Response.json({ object: { completedAt: "2026-09-15T00:00:00.000Z" } });
          }
        }
        activated.add(command.objectId);
        return Response.json({ member: { migrationPhase: "postgres" } });
      } else if (command.operation === "settle_unmaterialized") {
        expect(activated.size).toBe(known.size);
        return Response.json({ done: true });
      } else throw new Error(`Unexpected synthetic operator command: ${command.operation}`);
      return Response.json({ gate });
    },
  };
  return { input, sent, options, known, imported, activated, tokens, authorizations: () => authorizations };
}

describe("rolling runtime migration operator", () => {
  afterEach(() => vi.useRealTimers());
  it("requires a converged release and lists objects without stored data", async () => {
    const h = harness();
    expect((await inventoryHostedLegacyRuntime(h.input)).objectIds).toEqual([first, second]);
    await expect(inventoryHostedLegacyRuntime(harness({ split: true }).input)).rejects.toThrow("100% of traffic");
  });

  it("migrates serially through activation and includes intents absent from provider listing", async () => {
    const h = harness({ intent: true });
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false })).toEqual({ phase: "members_migrated", steps: 5 });
    expect(h.sent.filter(c => String(c.operation).startsWith("advance_")).map(c => c.objectId)).toEqual([first, first, second, intentOnly]);
    expect(h.sent.some(c => ["begin", "read_object", "import"].includes(String(c.operation)))).toBe(false);
    expect(h.activated.size).toBe(3);
    expect(h.authorizations()).toBe(h.sent.length);
  });

  it("holds only the selected source while readiness is pending and resumes its exact token", async () => {
    const h = harness({ held: true });
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false })).toMatchObject({ phase: "rolling", pending: "readiness" });
    expect(h.activated.size).toBe(0);
    expect(h.sent.some(c => c.operation === "advance_empty")).toBe(false);
    const token = h.tokens.get(first);
    h.options.held = false;
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false })).toMatchObject({ phase: "members_migrated" });
    expect(h.tokens.get(first)).toBe(token);
  });

  it.each(["loseAdvance", "loseSeal"] as const)("recovers %s from durable receipts without moving past an unactivated member", async fault => {
    const h = harness({ [fault]: true });
    await expect(migrateHostedLegacyRuntime({ ...h.input, activate: false })).rejects.toThrow("synthetic lost");
    expect(h.activated.size).toBe(0);
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false })).toMatchObject({ phase: "members_migrated" });
    expect(h.sent.filter(c => c.operation === "inventory")).toHaveLength(1);
  });

  it("bounds each invocation and retains individual ownership after all handoffs", async () => {
    const h = harness();
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false, maxSteps: 1 })).toEqual({ phase: "rolling", steps: 1, pending: "step_budget" });
    expect(h.imported.has(first)).toBe(true);
    expect(h.activated.has(first)).toBe(false);
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false })).toMatchObject({ phase: "members_migrated" });
    expect(h.sent.some(c => c.operation === "activate")).toBe(false);
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false })).toMatchObject({ phase: "members_migrated" });
  });

  it("rejects a global finalization request before any source or campaign mutation", async () => {
    const h = harness();
    await expect(migrateHostedLegacyRuntime({ ...h.input, activate: true })).rejects.toThrow("cannot finalize the namespace");
    expect(h.sent).toEqual([]);
    expect(h.activated.size).toBe(0);
  });

  it("finishes one canary through checkpoint, drain, import and activation in the same run", async () => {
    vi.useFakeTimers();
    const h = harness({ pending: ["checkpoint", "freeze"] });
    const result = migrateHostedLegacyRuntime({ ...h.input, activate: false, maxObjects: 1, waitForPending: true });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await result).toEqual({ phase: "rolling", steps: 4, pending: "object_budget" });
    expect([...h.activated]).toEqual([first]);
    expect(h.sent.filter(c => String(c.operation).startsWith("advance_")).map(c => c.objectId)).toEqual([first, first, first, first]);
    expect(h.sent.some(c => c.operation === "activate")).toBe(false);
  });

  it("bounds polling without activating or moving past an unresolved handoff", async () => {
    vi.useFakeTimers();
    const h = harness({ pending: ["freeze", "freeze"] });
    const result = migrateHostedLegacyRuntime({ ...h.input, activate: false, waitForPending: true, maxDurationMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual({ phase: "rolling", steps: 1, pending: "time_budget" });
    expect(h.activated.size).toBe(0);
    expect(h.sent.some(c => c.operation === "advance_empty")).toBe(false);
    h.options.pending = [];
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false })).toMatchObject({ phase: "members_migrated" });
  });

  it("leaves a readiness-held member live instead of polling or moving to another source", async () => {
    const h = harness({ held: true });
    expect(await migrateHostedLegacyRuntime({ ...h.input, activate: false, waitForPending: true })).toEqual({ phase: "rolling", steps: 1, pending: "readiness" });
    expect(h.sent.filter(c => c.operation === "advance_member")).toHaveLength(1);
  });

  it("recovers an interrupted handoff before unrelated late provider objects block final accounting", async () => {
    const h = harness({ loseAdvance: true, drift: true });
    await expect(migrateHostedLegacyRuntime({ ...h.input, activate: false })).rejects.toThrow("synthetic lost import");
    expect(h.imported.has(first)).toBe(true);
    expect(h.activated.size).toBe(0);
    const resumeStart = h.sent.length;
    await expect(migrateHostedLegacyRuntime({ ...h.input, activate: false })).rejects.toThrow("inventory changed");
    expect(h.activated.has(first)).toBe(true);
    expect(h.sent.slice(resumeStart).filter(c => String(c.operation).startsWith("advance_"))[0]?.objectId).toBe(first);
    expect(h.sent.some(c => c.operation === "activate")).toBe(false);
  });

  it("refuses final closure when a new provider object is outside the sealed census", async () => {
    const h = harness({ drift: true });
    await expect(migrateHostedLegacyRuntime({ ...h.input, activate: false })).rejects.toThrow("inventory changed");
    expect(h.activated.size).toBe(2);
    expect(h.sent.some(c => c.operation === "activate")).toBe(false);
  });
});
