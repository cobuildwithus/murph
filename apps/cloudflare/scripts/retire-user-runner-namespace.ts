import { isObjectRecord } from "./deploy-automation/shared.ts";
import { commandHostedRuntimeMigration } from "../src/runtime-migration-client.ts";

/** The exact namespace input is an operator approval, never a rollout default. */
export function readUserRunnerNamespaceRetirement(input: {
  config: unknown;
  currentVersion: unknown;
  expectedNamespace: string | undefined;
  retainServingRunner: boolean;
}): string | null {
  if (!isObjectRecord(input.config) || !Array.isArray(input.config.migrations)) return null;
  const deletion = input.config.migrations.find(value => isObjectRecord(value)
    && Array.isArray(value.deleted_classes) && value.deleted_classes.includes("UserRunnerDurableObject"));
  if (!deletion) {
    if (input.expectedNamespace) throw new Error("UserRunner retirement is absent from the prepared deployment.");
    return null;
  }
  if (!isObjectRecord(input.currentVersion) || !isObjectRecord(input.currentVersion.resources)
    || !Array.isArray(input.currentVersion.resources.bindings)) throw new Error("Live Worker bindings are unavailable for UserRunner retirement.");
  const bindings = input.currentVersion.resources.bindings.filter(value => isObjectRecord(value)
    && value.type === "durable_object_namespace" && value.class_name === "UserRunnerDurableObject");
  // An already applied migration resumes through the ordinary version flow.
  if (bindings.length === 0) return null;
  const binding = bindings[0];
  if (bindings.length !== 1 || !isObjectRecord(binding) || typeof binding.namespace_id !== "string"
    || !/^[a-f0-9]{32}$/u.test(input.expectedNamespace ?? "") || binding.namespace_id !== input.expectedNamespace) {
    throw new Error("UserRunner deletion requires explicit approval of the exact live namespace.");
  }
  if (!input.retainServingRunner) throw new Error("UserRunner retirement requires worker-only container rollout.");
  const durableObjects = input.config.durable_objects;
  if (!isObjectRecord(durableObjects) || !Array.isArray(durableObjects.bindings)
    || durableObjects.bindings.some(value => isObjectRecord(value)
      && (value.name === "USER_RUNNER" || value.class_name === "UserRunnerDurableObject"))) {
    throw new Error("The retiring Worker must not retain the UserRunner binding.");
  }
  return binding.namespace_id;
}

export async function assertUserRunnerNamespaceRetirementGate(
  source: Readonly<Record<string, unknown>>,
  namespaceId: string,
): Promise<void> {
  const { gate } = await commandHostedRuntimeMigration({ source, command: { operation: "status" } });
  if (!isObjectRecord(gate) || gate.namespaceId !== namespaceId || gate.phase !== "postgres"
    || !gate.activatedAt || !gate.creationClosedAt || !gate.inventorySealedAt) {
    throw new Error("UserRunner retirement requires the finalized Postgres gate for the exact namespace.");
  }
}
