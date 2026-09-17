import { describe, expect, it, vi } from "vitest";
import { readUserRunnerNamespaceRetirement, assertUserRunnerNamespaceRetirementGate } from "../scripts/retire-user-runner-namespace.ts";

const migration = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../src/runtime-migration-client.ts", () => ({ commandHostedRuntimeMigration: migration.command }));
const namespaceId = "a".repeat(32);
const config = { migrations: [{ tag: "v10", deleted_classes: ["UserRunnerDurableObject"] }], durable_objects: { bindings: [] } };
const binding = { type: "durable_object_namespace", class_name: "UserRunnerDurableObject", namespace_id: namespaceId };
const candidate = { config, currentVersion: { resources: { bindings: [binding] } }, expectedNamespace: namespaceId, retainServingRunner: true };
const gate = { namespaceId, phase: "postgres", activatedAt: "2026-09-17T00:00:00Z", creationClosedAt: "2026-09-17T00:00:00Z", inventorySealedAt: "2026-09-17T00:00:00Z" };

describe("UserRunner namespace retirement admission", () => {
  it("requires the exact live namespace and retains the member container release", () => {
    expect(readUserRunnerNamespaceRetirement(candidate)).toBe(namespaceId);
    expect(() => readUserRunnerNamespaceRetirement({ ...candidate, retainServingRunner: false })).toThrow("worker-only");
  });
  it.each([undefined, "true", "b".repeat(32)])("refuses absent, generic or wrong approval %s", expectedNamespace => {
    expect(() => readUserRunnerNamespaceRetirement({ ...candidate, expectedNamespace })).toThrow("exact live namespace");
  });
  it("rejects ambiguous bindings and a retained class binding", () => {
    expect(() => readUserRunnerNamespaceRetirement({ ...candidate, currentVersion: { resources: { bindings: [binding, binding] } } })).toThrow("exact live namespace");
    expect(() => readUserRunnerNamespaceRetirement({ ...candidate, config: { ...config, durable_objects: { bindings: [{ name: "USER_RUNNER", class_name: "UserRunnerDurableObject" }] } } })).toThrow("must not retain");
  });
  it("does not repeat an already applied migration", () => {
    expect(readUserRunnerNamespaceRetirement({ ...candidate, currentVersion: { resources: { bindings: [] } }, expectedNamespace: undefined })).toBeNull();
  });
  it("rejects approval against a deployment without the deletion", () => {
    expect(() => readUserRunnerNamespaceRetirement({ ...candidate, config: { migrations: [] } })).toThrow("absent");
  });
  it("observes only the canonical system migration status", async () => {
    migration.command.mockResolvedValue({ gate });
    await expect(assertUserRunnerNamespaceRetirementGate({}, namespaceId)).resolves.toBeUndefined();
    expect(migration.command).toHaveBeenLastCalledWith({ source: {}, command: { operation: "status" } });
  });
  it.each([
    { ...gate, phase: "rolling" }, { ...gate, namespaceId: "b".repeat(32) },
    { ...gate, activatedAt: null }, { ...gate, creationClosedAt: null }, { ...gate, inventorySealedAt: null }, null,
  ])("refuses an unproved or mismatched canonical retirement", async value => {
    migration.command.mockResolvedValue({ gate: value });
    await expect(assertUserRunnerNamespaceRetirementGate({}, namespaceId)).rejects.toThrow("finalized Postgres gate");
  });
});
