import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createExperiment, initializeVault } from "@murphai/core";
import { test } from "vitest";

import { updateExperimentRecord } from "../src/usecases/experiment-journal-vault.ts";

const ORIGINAL_PROTOCOL_REF = {
  key: "protocol_variant:sleep-baseline-observation/consistent-wake-time",
  pageRevisionId: `sha256:${"1".repeat(64)}`,
  runSpecRevisionId: `sha256:${"2".repeat(64)}`,
} as const;

const ORIGINAL_SNAPSHOT = {
  effectiveSpecHash: `sha256:${"3".repeat(64)}`,
  doseSignature: "Keep one wake time for seven days",
} as const;

const ORIGINAL_PRIVATE_PROTOCOL_REF = {
  protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWA",
  protocolRevisionId: `sha256:${"4".repeat(64)}`,
  effectiveSpecHash: ORIGINAL_SNAPSHOT.effectiveSpecHash,
} as const;

async function withProtocolBackedExperiment(
  input: {
    status: "active" | "completed";
    protocolRef?: typeof ORIGINAL_PRIVATE_PROTOCOL_REF;
  },
  run: (input: { vaultRoot: string; experimentId: string }) => Promise<void>,
): Promise<void> {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "murph-active-lineage-"),
  );
  try {
    await initializeVault({ vaultRoot });
    const created = await createExperiment({
      vaultRoot,
      slug: "consistent-wake-time",
      title: "Consistent Wake Time",
      startedOn: "2026-06-01",
      status: input.status,
      commonsProtocolRef: ORIGINAL_PROTOCOL_REF,
      protocolRef: input.protocolRef,
      effectiveProtocolSnapshot: ORIGINAL_SNAPSHOT,
    });
    await run({ vaultRoot, experimentId: created.experiment.id });
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

test("completed Health Commons experiment rejects a stale lineage replacement", async () => {
  await withProtocolBackedExperiment({ status: "completed" }, async ({ vaultRoot, experimentId }) => {
    await assert.rejects(
      updateExperimentRecord({
        vault: vaultRoot,
        lookup: experimentId,
        commonsProtocolRef: {
          ...ORIGINAL_PROTOCOL_REF,
          pageRevisionId: `sha256:${"4".repeat(64)}`,
        },
      }),
      /Only a planned experiment may change its protocol lineage or effective snapshot/u,
    );
  });
});

test("completed Health Commons experiment rejects an in-place effective snapshot refresh", async () => {
  await withProtocolBackedExperiment({ status: "completed" }, async ({ vaultRoot, experimentId }) => {
    await assert.rejects(
      updateExperimentRecord({
        vault: vaultRoot,
        lookup: experimentId,
        effectiveProtocolSnapshot: {
          ...ORIGINAL_SNAPSHOT,
          effectiveSpecHash: `sha256:${"5".repeat(64)}`,
        },
      }),
      /Only a planned experiment may change its protocol lineage or effective snapshot/u,
    );
  });
});

test("active private protocol experiment rejects identity, revision, and spec-hash rewrites", async () => {
  await withProtocolBackedExperiment(
    { status: "active", protocolRef: ORIGINAL_PRIVATE_PROTOCOL_REF },
    async ({ vaultRoot, experimentId }) => {
      for (const protocolRef of [
        {
          ...ORIGINAL_PRIVATE_PROTOCOL_REF,
          protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWB" as const,
        },
        {
          ...ORIGINAL_PRIVATE_PROTOCOL_REF,
          protocolRevisionId: `sha256:${"5".repeat(64)}` as const,
        },
        {
          ...ORIGINAL_PRIVATE_PROTOCOL_REF,
          effectiveSpecHash: `sha256:${"6".repeat(64)}` as const,
        },
      ]) {
        await assert.rejects(
          updateExperimentRecord({
            vault: vaultRoot,
            lookup: experimentId,
            protocolRef,
          }),
          /Only a planned experiment may change its protocol lineage or effective snapshot/u,
        );
      }
    },
  );
});
