import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
} from "@murphai/contracts/browser-vault";
import { createIntegratedVaultServices } from "@murphai/vault-usecases";
import type {
  HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimePlatform,
} from "../src/hosted-runtime/platform.ts";

vi.unmock("@murphai/contracts");
vi.unmock("@murphai/query");
vi.unmock("@murphai/query/browser");
vi.unmock("@murphai/runtime-state/node");

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@murphai/contracts");
  vi.doUnmock("@murphai/query");
  vi.doUnmock("@murphai/query/browser");
  vi.doUnmock("@murphai/runtime-state/node");
});

describe("hosted browser-vault replica refresh preparation", () => {
  it("builds lab and metric rows from projection points while readVault stays sparse", async () => {
    const {
      listMetricPoints,
      readVault,
    } = await import("@murphai/query");
    const {
      createHostedBrowserVaultReplicaForSourceState,
      summarizeHostedBrowserVaultReplicaContent,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));

    try {
      await writeVaultFile(
        vaultRoot,
        "ledger/events/2026/2026-05.jsonl",
        [
          JSON.stringify({
            schemaVersion: "murph.event.v1",
            id: "evt_projection_test",
            kind: "test",
            occurredAt: "2026-05-02T08:00:00.000Z",
            recordedAt: "2026-05-02T18:00:00.000Z",
            dayKey: "2026-05-02",
            source: "manual",
            title: "Blood panel",
            results: [
              {
                analyte: "Apolipoprotein B",
                biomarkerSlug: "apob",
                unit: "mg/dL",
                value: 87,
              },
            ],
          }),
          "",
        ].join("\n"),
      );
      await writeVaultFile(
        vaultRoot,
        "ledger/events/2020/2020-02.jsonl",
        [
          JSON.stringify({
            schemaVersion: "murph.event.v1",
            id: "evt_old_live_lab",
            kind: "test",
            occurredAt: "2020-02-01T08:00:00.000Z",
            recordedAt: "2020-02-01T18:00:00.000Z",
            dayKey: "2020-02-01",
            source: "manual",
            title: "Older blood panel",
            results: [{
              analyte: "Hemoglobin A1c",
              biomarkerSlug: "hba1c",
              unit: "percent",
              value: 5.1,
            }],
          }),
          JSON.stringify({
            schemaVersion: "murph.event.v1",
            id: "evt_old_live_lab",
            kind: "test",
            occurredAt: "2020-02-01T08:00:00.000Z",
            recordedAt: "2020-02-02T18:00:00.000Z",
            dayKey: "2020-02-01",
            source: "manual",
            title: "Corrected older blood panel",
            lifecycle: { revision: 2 },
            results: [{
              analyte: "Hemoglobin A1c",
              biomarkerSlug: "hba1c",
              unit: "percent",
              value: 5.3,
            }],
          }),
          JSON.stringify({
            schemaVersion: "murph.event.v1",
            id: "evt_old_deleted_lab",
            kind: "test",
            occurredAt: "2020-02-03T08:00:00.000Z",
            recordedAt: "2020-02-03T18:00:00.000Z",
            dayKey: "2020-02-03",
            source: "manual",
            title: "Removed older blood panel",
            results: [{
              analyte: "Hemoglobin A1c",
              biomarkerSlug: "hba1c",
              unit: "percent",
              value: 9.9,
            }],
          }),
          JSON.stringify({
            schemaVersion: "murph.event.v1",
            id: "evt_old_deleted_lab",
            kind: "test",
            occurredAt: "2020-02-03T08:00:00.000Z",
            recordedAt: "2020-02-04T18:00:00.000Z",
            dayKey: "2020-02-03",
            source: "manual",
            title: "Removed older blood panel",
            lifecycle: { revision: 2, state: "deleted" },
            results: [{
              analyte: "Hemoglobin A1c",
              biomarkerSlug: "hba1c",
              unit: "percent",
              value: 9.9,
            }],
          }),
          "",
        ].join("\n"),
      );
      await writeVaultFile(
        vaultRoot,
        "ledger/samples/glucose/2026/2026-05.jsonl",
        [
          JSON.stringify({
            schemaVersion: "murph.sample.v1",
            id: "smp_dense_glucose",
            recordedAt: "2026-05-02T09:00:00.000Z",
            source: "device",
            stream: "glucose",
            unit: "mg/dL",
            value: 101,
          }),
          "",
        ].join("\n"),
      );

      const vault = await readVault(vaultRoot);
      const points = await listMetricPoints(vaultRoot, { limit: null });
      const replica = await createHostedBrowserVaultReplicaForSourceState({
        generatedAt: "2026-05-10T00:00:00.000Z",
        sourceStateHash: "browser-vault-source-state-test",
        vaultRoot,
      });

      expect(vault.entities.some((entity) => entity.entityId === "smp_dense_glucose")).toBe(false);
      expect(vault.samples.some((sample) => sample.entityId === "smp_dense_glucose")).toBe(false);
      expect(points.some((point) => point.metricKey === "apob" && point.value === 87)).toBe(true);
      expect(points.some((point) => point.metricKey === "hba1c" && point.value === 5.3)).toBe(true);
      expect(points.some((point) => point.metricKey === "hba1c" && point.value === 5.1)).toBe(false);
      expect(points.some((point) => point.metricKey === "hba1c" && point.value === 9.9)).toBe(false);
      expect(points.some((point) => point.source.recordId === "smp_dense_glucose")).toBe(false);
      expect(replica.entities.some((entity) => entity.id === "smp_dense_glucose")).toBe(false);
      expect(replica.generation).toBe(BROWSER_VAULT_REPLICA_CURRENT_GENERATION);
      expect(replica.metricRows.some((row) => row.metricKey === "apob" && row.value === 87)).toBe(true);
      expect(replica.metricRows.some((row) => row.metricKey === "hba1c")).toBe(false);
      expect(replica.metricRows.some((row) => row.metricKey === "glucose" && row.value === 101)).toBe(false);
      expect(replica.labResultRows).toHaveLength(2);
      expect(replica.labResultRows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          analyte: "Apolipoprotein B",
          metricKey: "apob",
          value: 87,
        }),
        expect.objectContaining({
          analyte: "Hemoglobin A1c",
          metricKey: "hba1c",
          value: 5.3,
        }),
      ]));
      expect(replica.labResultRows.some((row) => row.value === 5.1 || row.value === 9.9)).toBe(false);

      const labOnlyContent = summarizeHostedBrowserVaultReplicaContent({
        ...replica,
        entities: [],
        metricGoalProgressRows: [],
        metricRows: [],
        searchRows: [],
        sourceHealthRows: [],
        timelineRows: [],
        weeklySampleSummaries: [],
      });
      expect(labOnlyContent).toMatchObject({
        hasPrivateContent: true,
        labResultRows: 2,
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("projects a validated referenced outcome and hashes changes to its bytes", async () => {
    const {
      createHostedBrowserVaultReplicaForSourceState,
      hashHostedBrowserVaultReplicaSources,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-outcome-"));
    const experimentId = "exp_01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const outcomePath = "bank/experiments/outcomes/private-trial-2026-05-14.json";
    const outcome = createCanonicalOutcome({ experimentId });

    try {
      await writeVaultFile(
        vaultRoot,
        "bank/experiments/private-trial.md",
        createExperimentDocument({
          experimentId,
          outcomePath,
          outcomeId: outcome.outcomeId,
          outcomeGeneratedAt: outcome.generatedAt,
          slug: "private-trial",
          status: "completed",
        }),
      );
      await writeVaultFile(vaultRoot, outcomePath, `${JSON.stringify(outcome, null, 2)}\n`);

      const firstHash = await hashHostedBrowserVaultReplicaSources(vaultRoot);
      const replica = await createHostedBrowserVaultReplicaForSourceState({
        generatedAt: "2027-06-20T12:00:00.000Z",
        sourceStateHash: firstHash.hash,
        vaultRoot,
      });

      expect(replica.experimentOutcomes).toEqual([outcome]);
      expect(firstHash.fileCount).toBe(2);

      const revisedOutcome = {
        ...outcome,
        conclusion: {
          ...outcome.conclusion,
          headline: "The revised saved headline",
        },
      };
      await writeVaultFile(
        vaultRoot,
        outcomePath,
        `${JSON.stringify(revisedOutcome, null, 2)}\n`,
      );
      const secondHash = await hashHostedBrowserVaultReplicaSources(vaultRoot);

      expect(secondHash.hash).not.toBe(firstHash.hash);
      expect(secondHash.fileCount).toBe(firstHash.fileCount);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("projects the output of the canonical experiment outcome writer", async () => {
    const {
      createHostedBrowserVaultReplicaForSourceState,
      hashHostedBrowserVaultReplicaSources,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-writer-"));

    try {
      const services = createIntegratedVaultServices();
      await services.core.init({ requestId: null, timezone: "UTC", vault: vaultRoot });
      await services.core.startExperiment({
        payload: {
          analysisPlan: {
            desiredDirection: "decrease",
            primaryBiomarkerKey: "biomarker:resting-heart-rate",
          },
          experiment: {
            slug: "writer-projection",
            startedOn: "2026-06-01",
            title: "Writer projection",
          },
          runPlan: {
            baselineEnd: "2026-06-03",
            baselineStart: "2026-06-01",
            interventionEnd: "2026-06-10",
            interventionStart: "2026-06-04",
          },
          source: { kind: "custom" },
        },
        requestId: null,
        vault: vaultRoot,
      });
      const written = await services.core.writeExperimentOutcome({
        asOf: "2026-06-15",
        lookup: "writer-projection",
        requestId: null,
        vault: vaultRoot,
      });
      await services.core.stopExperiment({
        lookup: "writer-projection",
        occurredAt: "2026-06-15T12:00:00.000Z",
        requestId: null,
        vault: vaultRoot,
      });
      await services.core.updateExperiment({
        lookup: "writer-projection",
        requestId: null,
        runPlan: {
          baselineEnd: "2026-06-04",
          baselineStart: "2026-06-02",
          interventionEnd: "2026-06-20",
          interventionStart: "2026-06-05",
        },
        status: "paused",
        title: "Renamed writer projection",
        vault: vaultRoot,
      });
      const sourceHash = await hashHostedBrowserVaultReplicaSources(vaultRoot);
      const replica = await createHostedBrowserVaultReplicaForSourceState({
        generatedAt: "2027-06-20T12:00:00.000Z",
        sourceStateHash: sourceHash.hash,
        vaultRoot,
      });

      expect(replica.experimentOutcomes).toEqual([written.outcome]);

      const {
        createBrowserVaultQueryClient,
        selectBrowserVaultExperimentResults,
      } = await import("@murphai/query/browser");
      const results = selectBrowserVaultExperimentResults(
        createBrowserVaultQueryClient(replica),
        "writer-projection",
      );
      expect(results?.savedOutcomeStatus).toBe("available");
      expect(results?.persistedOutcome).toEqual(written.outcome);
      expect(results?.experiment.commonsProtocolRef).toEqual(
        written.outcome.commonsProtocolRef,
      );
      expect(results?.experiment.effectiveProtocolSnapshot).toEqual(
        written.outcome.effectiveProtocolSnapshot,
      );
      expect(results?.experiment.phase).toBe("completed");
      expect(results?.experiment.protocolRef).toEqual(written.outcome.protocolRef);
      expect(results?.experiment.status).toBe(written.outcome.experiment.status);
      expect(results?.experiment.title).toBe(written.outcome.experiment.title);
      expect(results?.experiment.windows).toEqual(written.outcome.windows);
      expect(results?.persistedOutcome?.windows).toEqual({
        baselineEnd: "2026-06-03",
        baselineStart: "2026-06-01",
        interventionEnd: "2026-06-10",
        interventionStart: "2026-06-04",
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("fails closed for missing escaping mismatched and invalid outcome references", async () => {
    const {
      createHostedBrowserVaultReplicaForSourceState,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-invalid-outcome-"));
    const cases = [
      {
        experimentId: "exp_01ARZ3NDEKTSV4RRFFQ69G5FAW",
        outcomePath: "bank/experiments/outcomes/missing.json",
        slug: "missing-outcome",
      },
      {
        experimentId: "exp_01ARZ3NDEKTSV4RRFFQ69G5FAX",
        outcomePath: "../outside.json",
        slug: "escaping-outcome",
      },
      {
        experimentId: "exp_01ARZ3NDEKTSV4RRFFQ69G5FAY",
        outcomePath: "bank/experiments/outcomes/mismatched.json",
        slug: "mismatched-outcome",
      },
      {
        experimentId: "exp_01ARZ3NDEKTSV4RRFFQ69G5FAZ",
        outcomePath: "bank/experiments/outcomes/invalid.json",
        slug: "invalid-outcome",
      },
    ];

    try {
      for (const entry of cases) {
        await writeVaultFile(
          vaultRoot,
          `bank/experiments/${entry.slug}.md`,
          createExperimentDocument({
            ...entry,
            outcomeGeneratedAt: "2026-05-15T12:00:00.000Z",
            outcomeId: `outcome_${entry.slug}`,
            status: "completed",
          }),
        );
      }
      await writeVaultFile(
        vaultRoot,
        "bank/experiments/unrelated-run.md",
        createExperimentDocument({
          experimentId: "exp_01ARZ3NDEKTSV4RRFFQ69G5FB0",
          slug: "unrelated-run",
          status: "active",
        }),
      );
      await writeVaultFile(
        vaultRoot,
        "bank/experiments/outcomes/mismatched.json",
        `${JSON.stringify(createCanonicalOutcome({
          experimentId: "exp_01ARZ3NDEKTSV4RRFFQ69G5FB1",
          outcomeId: "outcome_mismatched-outcome",
          slug: "different-run",
        }), null, 2)}\n`,
      );
      await writeVaultFile(
        vaultRoot,
        "bank/experiments/outcomes/invalid.json",
        "{\"schemaVersion\":\"not-an-outcome\"}\n",
      );

      const replica = await createHostedBrowserVaultReplicaForSourceState({
        generatedAt: "2026-05-20T12:00:00.000Z",
        sourceStateHash: "invalid-outcome-test",
        vaultRoot,
      });

      expect(replica.experimentOutcomes).toEqual([]);
      expect(replica.entities.some((entity) => entity.id ===
        "exp_01ARZ3NDEKTSV4RRFFQ69G5FB0")).toBe(true);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("summarizes restored canonical source separately from default metric selection rows", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const { listCanonicalSourceManifest } = await import("@murphai/query");
    const {
      createHostedBrowserVaultReplicaRefreshFromWorkspace,
      hashHostedBrowserVaultReplicaSources,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const experimentPath = path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md");
    try {
      await writeVaultFile(vaultRoot, experimentPath, [
        "---",
        "experimentId: exp_trial",
        "slug: trial",
        "title: Private Trial",
        "status: active",
        "startedOn: 2026-05-01",
        "---",
        "# Private Trial",
        "",
        "Private browser-vault content.",
        "",
      ].join("\n"));

      const directManifest = await listCanonicalSourceManifest(vaultRoot);
      const directSourceHash = await hashHostedBrowserVaultReplicaSources(vaultRoot);
      expect(directManifest.map((entry) => entry.relativePath)).toEqual([experimentPath]);

      const prepared = await createHostedBrowserVaultReplicaRefreshFromWorkspace({
        generatedAt: "2026-05-10T00:00:00.000Z",
        platform: createPlatform(),
        vaultRoot,
        workspace: null,
      });

      expect(prepared.source.fileCount).toBe(1);
      expect(prepared.source.totalBytes).toBeGreaterThan(0);
      expect(prepared.replica.source.sourceBundleHash).toBe(directSourceHash.hash);
      expect(prepared.content.entities).toBe(1);
      expect(prepared.content.searchRows).toBe(1);
      expect(prepared.content.metricSelectionRows).toBeGreaterThan(0);
      expect(prepared.content.hasPrivateContent).toBe(true);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
      await rm(`${vaultRoot}-operator-home`, { force: true, recursive: true });
    }
  });

  it("publishes an empty current replica instead of leaving stale data visible", async () => {
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const workspace = createWorkspaceState({
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-10T00:00:00.000Z",
    });
    const publishRef = vi.fn(async (input: { replicaRef: HostedBrowserVaultReplicaRef }) => ({
      published: true,
      workspace: {
        ...workspace,
        browserVaultReplicaRef: input.replicaRef,
      },
    }));
    const write = vi.fn(async (input: { replica: unknown }) =>
      createReplicaRefFromReplica(input.replica)
    );

    try {
      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        generatedAt: "2026-05-10T00:01:00.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        vaultRoot,
        workspace,
      });

      expect(result).toMatchObject({
        status: "published",
        source: {
          fileCount: 0,
          totalBytes: 0,
        },
      });
      expect(write).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledWith(expect.objectContaining({
        replacedReplicaRef: null,
      }));
      expect(publishRef).toHaveBeenCalledOnce();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("force refreshes a metadata-current replica when web reported it unreadable", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const { hashCanonicalQuerySources } = await import("@murphai/query");
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const publishRef = vi.fn(async (input: { replicaRef: HostedBrowserVaultReplicaRef }) => ({
      published: true,
      workspace: createWorkspaceState({
        browserVaultReplicaRef: input.replicaRef,
      }),
    }));
    const write = vi.fn(async (input: { replica: unknown }) =>
      createReplicaRefFromReplica(input.replica)
    );

    try {
      await writeVaultFile(
        vaultRoot,
        path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md"),
        "---\nexperimentId: exp_trial\nslug: trial\nstatus: active\n---\n# Trial\n",
      );
      const sourceHash = await hashCanonicalQuerySources(vaultRoot);
      const workspace = createWorkspaceState({
        browserVaultReplicaRef: {
          byteLength: 128,
          dataVersion: "browser-data-v1",
          generatedAt: "2026-05-10T00:01:00.000Z",
          keyId: "browser-vault-replica:key",
          objectKey: "users/browser-vault-replicas/member_123/missing.json",
          replicaSchema: "murph.browser-vault-replica",
          runtimeRootKeyId: "udrk:runtime:test-root",
          schema: "murph.hosted-browser-vault-replica-ref.v1",
          sourceBundleHash: sourceHash.hash,
        },
      });

      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        force: true,
        generatedAt: "2026-05-10T00:01:30.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        vaultRoot,
        workspace,
      });

      expect(result).toMatchObject({
        status: "published",
      });
      expect(write).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledWith(expect.objectContaining({
        replacedReplicaRef: expect.objectContaining({
          objectKey: workspace.browserVaultReplicaRef?.objectKey,
        }),
      }));
      expect(publishRef).toHaveBeenCalledOnce();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("retains cleanup context when publishing the new replica conflicts", async () => {
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const currentReplicaRef: HostedBrowserVaultReplicaRef = {
      byteLength: 128,
      dataVersion: "browser-data-v1",
      generatedAt: "2026-05-10T00:00:00.000Z",
      keyId: "browser-vault-replica:key",
      objectKey: "users/browser-vault-replicas/member_123/current.json",
      replicaSchema: "murph.browser-vault-replica",
      runtimeRootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-browser-vault-replica-ref.v1",
      sourceBundleHash: "a".repeat(64),
    };
    const workspace = createWorkspaceState({
      browserVaultReplicaRef: currentReplicaRef,
    });
    const publishRef = vi.fn(async () => ({
      published: false as const,
      workspace,
    }));
    const write = vi.fn(async (input: { replica: unknown }) =>
      createReplicaRefFromReplica(input.replica)
    );

    try {
      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        force: true,
        generatedAt: "2026-05-10T00:01:00.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        vaultRoot,
        workspace,
      });

      expect(result).toEqual({ status: "publish_conflict" });
      expect(write).toHaveBeenCalledWith(expect.objectContaining({
        replacedReplicaRef: currentReplicaRef,
      }));
      expect(publishRef).toHaveBeenCalledOnce();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not publish when a runtime wake arrives during refresh", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const {
      createCoalescingRuntimeWakeSignal,
    } = await import("../src/hosted-runtime/runtime-wake.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const workspace = createWorkspaceState({
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-10T00:00:00.000Z",
    });
    const publishRef = vi.fn(async (input: { replicaRef: HostedBrowserVaultReplicaRef }) => ({
      published: true,
      workspace: {
        ...workspace,
        browserVaultReplicaRef: input.replicaRef,
      },
    }));
    const write = vi.fn(async (input: { replica: unknown }) => {
      runtimeWakeSignal.notify();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return createReplicaRefFromReplica(input.replica);
    });

    try {
      await writeVaultFile(
        vaultRoot,
        path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md"),
        "---\nexperimentId: exp_trial\nslug: trial\nstatus: active\n---\n# Trial\n",
      );
      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        generatedAt: "2026-05-10T00:01:00.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        runtimeWakeSignal,
        vaultRoot,
        workspace,
      });

      expect(result).toMatchObject({
        status: "deferred_runtime_wake",
      });
      expect(write).toHaveBeenCalledOnce();
      expect(publishRef).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("aborts publish when a runtime wake arrives during publish", async () => {
    const { VAULT_LAYOUT } = await import("@murphai/contracts");
    const {
      refreshHostedBrowserVaultReplicaFromRuntime,
    } = await import("../src/hosted-runtime/browser-vault-replica.ts");
    const {
      createCoalescingRuntimeWakeSignal,
    } = await import("../src/hosted-runtime/runtime-wake.ts");
    const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-browser-vault-refresh-"));
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const workspace = createWorkspaceState({
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-10T00:00:00.000Z",
    });
    const publishCommitted = vi.fn();
    const publishRef = vi.fn(async (input: {
      replicaRef: HostedBrowserVaultReplicaRef;
      signal?: AbortSignal | null;
    }) => {
      runtimeWakeSignal.notify();
      await new Promise<void>((resolve) => {
        if (input.signal?.aborted) {
          resolve();
          return;
        }
        input.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      if (!input.signal?.aborted) {
        publishCommitted();
      }
      return {
        published: true,
        workspace: {
          ...workspace,
          browserVaultReplicaRef: input.replicaRef,
        },
      };
    });
    const write = vi.fn(async (input: { replica: unknown }) =>
      createReplicaRefFromReplica(input.replica)
    );

    try {
      await writeVaultFile(
        vaultRoot,
        path.posix.join(VAULT_LAYOUT.experimentsDirectory, "trial.md"),
        "---\nexperimentId: exp_trial\nslug: trial\nstatus: active\n---\n# Trial\n",
      );
      const result = await refreshHostedBrowserVaultReplicaFromRuntime({
        generatedAt: "2026-05-10T00:01:00.000Z",
        platform: createPlatform({
          browserVaultReplicaPort: {
            publishRef,
            write,
          },
        }),
        runtimeWakeSignal,
        vaultRoot,
        workspace,
      });

      expect(result).toMatchObject({
        status: "deferred_runtime_wake",
      });
      expect(write).toHaveBeenCalledOnce();
      expect(publishRef).toHaveBeenCalledOnce();
      expect(publishCommitted).not.toHaveBeenCalled();
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });
});

function createCanonicalOutcome(input: {
  experimentId: string;
  outcomeId?: string;
  slug?: string;
}) {
  const slug = input.slug ?? "private-trial";

  return {
    adherenceSummary: {
      completedSessions: 5,
      minimumUsefulSessions: 4,
      status: "met_target" as const,
      targetSessions: 5,
    },
    asOf: "2026-05-14",
    commonsProtocolRef: null,
    conclusion: {
      caveats: ["Travel overlapped one intervention day."],
      headline: "The exact saved headline",
      plainLanguage: "This is the exact saved plain-language conclusion.",
    },
    confidence: {
      level: "medium" as const,
      reasons: ["The saved analysis accounted for travel."],
    },
    confounders: ["Travel"],
    effectiveProtocolSnapshot: null,
    experiment: {
      id: input.experimentId,
      slug,
      status: "completed" as const,
      title: slug,
    },
    generatedAt: "2026-05-15T12:00:00.000Z",
    metricResults: [],
    outcomeId: input.outcomeId ?? "outcome_private-trial",
    protocolRef: null,
    schemaVersion: "murph.experiment-outcome.v1" as const,
    windows: {
      baselineEnd: "2026-05-03",
      baselineStart: "2026-05-01",
      interventionEnd: "2026-05-14",
      interventionStart: "2026-05-04",
    },
  };
}

function createExperimentDocument(input: {
  experimentId: string;
  outcomeGeneratedAt?: string;
  outcomeId?: string;
  outcomePath?: string;
  slug: string;
  status: "active" | "completed";
}): string {
  const outcomeRef = input.outcomePath && input.outcomeId
    ? [
        "outcomeRef:",
        `  outcomeId: ${input.outcomeId}`,
        ...(input.outcomeGeneratedAt
          ? [`  generatedAt: ${input.outcomeGeneratedAt}`]
          : []),
        `  relativePath: ${input.outcomePath}`,
      ]
    : [];

  return [
    "---",
    "schemaVersion: murph.frontmatter.experiment.v1",
    "docType: experiment",
    `experimentId: ${input.experimentId}`,
    `slug: ${input.slug}`,
    `title: ${input.slug}`,
    `status: ${input.status}`,
    "startedOn: 2026-05-01",
    ...(input.status === "completed" ? ["endedOn: 2026-05-14"] : []),
    "runPlan:",
    "  baselineStart: 2026-05-01",
    "  baselineEnd: 2026-05-03",
    "  interventionStart: 2026-05-04",
    "  interventionEnd: 2026-05-14",
    ...outcomeRef,
    "---",
    `# ${input.slug}`,
    "",
  ].join("\n");
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const filePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function createPlatform(
  overrides: Partial<HostedRuntimePlatform> = {},
): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get() {
        return null;
      },
      async put() {},
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {},
    },
    workspacePort: {
      async checkpoint() {
        throw new Error("Browser-vault refresh preparation must not checkpoint.");
      },
    },
    ...overrides,
  };
}

function createWorkspaceState(
  overrides: Partial<HostedWorkspaceState> = {},
): HostedWorkspaceState {
  return {
    checkpointedAt: "2026-05-10T00:00:00.000Z",
    createdAt: "2026-05-10T00:00:00.000Z",
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: "2026-05-10T00:00:00.000Z",
    userId: "member_123",
    version: "1",
    ...overrides,
  };
}

function createReplicaRefFromReplica(replica: unknown): HostedBrowserVaultReplicaRef {
  const record = requireRecord(replica, "replica");
  const source = requireRecord(record.source, "replica.source");
  const sourceBundleHash = requireString(source.sourceBundleHash, "replica.source.sourceBundleHash");
  const dataVersion = requireString(source.dataVersion, "replica.source.dataVersion");
  const generatedAt = requireString(record.generatedAt, "replica.generatedAt");
  const generation = requireNumber(record.generation, "replica.generation");
  const byteLength = new TextEncoder().encode(JSON.stringify(replica)).byteLength;

  return {
    byteLength,
    dataVersion,
    generatedAt,
    generation,
    keyId: `browser-vault-replica:${dataVersion.slice(0, 12)}`,
    objectKey: `users/browser-vault-replicas/member_123/${dataVersion}.json`,
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}
