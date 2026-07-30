import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createExperiment,
  initializeVault,
  parseFrontmatterDocument,
} from "@murphai/core";
import { loadGeneratedHealthCommonsProtocolRunSpecs } from "@murphai/health-commons/runtime";
import { test } from "vitest";

import { updateExperimentRecord } from "../src/usecases/experiment-journal-vault.ts";
import { createIntegratedVaultServices } from "../src/vault-services.ts";

const ORIGINAL_PROTOCOL_REF = {
  key: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure",
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

const WITHDRAWN_BEDTIME_PROTOCOL_REF = {
  key: "protocol_variant:bedtime-transition/standard-tiny-fallback-transition",
  pageRevisionId: `sha256:${"5".repeat(64)}`,
  runSpecRevisionId: `sha256:${"6".repeat(64)}`,
} as const;

const WITHDRAWN_BEDTIME_SNAPSHOT = {
  effectiveSpecHash: `sha256:${"7".repeat(64)}`,
  doseSignature: "Use the standard, tiny, or fallback bedtime transition",
} as const;

const WITHDRAWN_PRIVATE_PROTOCOL_REF = {
  protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWC",
  protocolRevisionId: `sha256:${"8".repeat(64)}`,
  effectiveSpecHash: WITHDRAWN_BEDTIME_SNAPSHOT.effectiveSpecHash,
} as const;

type ExperimentRecordUpdate = Parameters<typeof updateExperimentRecord>[0];
type ProtectedExperimentUpdate = Pick<
  ExperimentRecordUpdate,
  | "commonsProtocolRef"
  | "protocolRef"
  | "effectiveProtocolSnapshot"
  | "runPlan"
  | "analysisPlan"
>;

const WITHDRAWN_RUN_PLAN: NonNullable<ExperimentRecordUpdate["runPlan"]> = {
  interventionStart: "2026-06-01",
  interventionEnd: "2026-06-07",
  modality: "bedtime_transition",
  targetSessions: 7,
  minimumUsefulSessions: 4,
  logging: {
    sessionFields: ["sleep_quality_0_10"],
  },
};

const WITHDRAWN_ANALYSIS_PLAN: NonNullable<
  ExperimentRecordUpdate["analysisPlan"]
> = {
  primaryBiomarkerKey: "biomarker:sleep-quality",
  desiredDirection: "increase",
};

const WITHDRAWN_PROTECTED_FIELD_CHANGES = [
  {
    field: "commonsProtocolRef",
    update: { commonsProtocolRef: ORIGINAL_PROTOCOL_REF },
  },
  {
    field: "protocolRef",
    update: { protocolRef: ORIGINAL_PRIVATE_PROTOCOL_REF },
  },
  {
    field: "effectiveProtocolSnapshot",
    update: { effectiveProtocolSnapshot: ORIGINAL_SNAPSHOT },
  },
  {
    field: "runPlan",
    update: {
      runPlan: {
        ...WITHDRAWN_RUN_PLAN,
        targetSessions: 8,
      },
    },
  },
  {
    field: "analysisPlan",
    update: {
      analysisPlan: {
        ...WITHDRAWN_ANALYSIS_PLAN,
        desiredDirection: "decrease",
      },
    },
  },
] satisfies ReadonlyArray<{
  field: string;
  update: ProtectedExperimentUpdate;
}>;

const WITHDRAWN_POST_STATUS_CHANGES = [
  {
    field: "runPlan",
    initialStatus: "planned",
    update: {
      runPlan: {
        ...WITHDRAWN_RUN_PLAN,
        targetSessions: 12,
      },
    },
  },
  {
    field: "analysisPlan",
    initialStatus: "paused",
    update: {
      analysisPlan: {
        ...WITHDRAWN_ANALYSIS_PLAN,
        desiredDirection: "decrease",
      },
    },
  },
] satisfies ReadonlyArray<{
  field: string;
  initialStatus: "planned" | "paused";
  update: ProtectedExperimentUpdate;
}>;

type WithdrawnExperimentStatus =
  | "planned"
  | "paused"
  | "active"
  | "completed"
  | "abandoned";

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

async function withWithdrawnExperiment(
  status: WithdrawnExperimentStatus,
  run: (input: {
    vaultRoot: string;
    experimentId: string;
    experimentPath: string;
  }) => Promise<void>,
): Promise<void> {
  const vaultRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `murph-withdrawn-protocol-${status}-`),
  );
  try {
    await initializeVault({ vaultRoot });
    const created = await createExperiment({
      vaultRoot,
      slug: `withdrawn-bedtime-${status}`,
      title: "Bedtime Transition",
      startedOn: "2026-06-01",
      status,
      commonsProtocolRef: WITHDRAWN_BEDTIME_PROTOCOL_REF,
      protocolRef: WITHDRAWN_PRIVATE_PROTOCOL_REF,
      effectiveProtocolSnapshot: WITHDRAWN_BEDTIME_SNAPSHOT,
      runPlan: WITHDRAWN_RUN_PLAN,
      analysisPlan: WITHDRAWN_ANALYSIS_PLAN,
    });
    await run({
      vaultRoot,
      experimentId: created.experiment.id,
      experimentPath: path.join(vaultRoot, created.experiment.relativePath),
    });
  } finally {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  }
}

test.each(["planned", "paused"] as const)(
  "keeps a persisted %s experiment unchanged when its public protocol was withdrawn",
  async (status) => {
    const vaultRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), `murph-withdrawn-protocol-${status}-`),
    );
    try {
      await initializeVault({ vaultRoot });
      const created = await createExperiment({
        vaultRoot,
        slug: `withdrawn-bedtime-${status}`,
        title: "Bedtime Transition",
        startedOn: "2026-06-01",
        status,
        commonsProtocolRef: WITHDRAWN_BEDTIME_PROTOCOL_REF,
        effectiveProtocolSnapshot: WITHDRAWN_BEDTIME_SNAPSHOT,
      });
      const experimentPath = path.join(
        vaultRoot,
        created.experiment.relativePath,
      );
      const before = await fs.readFile(experimentPath, "utf8");

      await assert.rejects(
        updateExperimentRecord({
          vault: vaultRoot,
          lookup: created.experiment.id,
          status: "active",
        }),
        /no longer available to activate.*remains unchanged.*currently runnable alternative as a new experiment.*never replace this run's protocol lineage.*separately agrees/u,
      );

      assert.equal(await fs.readFile(experimentPath, "utf8"), before);
    } finally {
      await fs.rm(vaultRoot, { recursive: true, force: true });
    }
  },
);

test.each(
  (["planned", "paused"] as const).flatMap((status) =>
    WITHDRAWN_PROTECTED_FIELD_CHANGES.flatMap(({ field, update }) => [
      { status, field, mode: "alone", update },
      {
        status,
        field,
        mode: "with abandonment",
        update: { ...update, status: "abandoned" as const },
      },
    ]),
  ),
)(
  "$status experiment cannot change withdrawn $field $mode",
  async ({ status, update }) => {
    await withWithdrawnExperiment(status, async ({
      vaultRoot,
      experimentId,
      experimentPath,
    }) => {
      const before = await fs.readFile(experimentPath, "utf8");

      await assert.rejects(
        updateExperimentRecord({
          vault: vaultRoot,
          lookup: experimentId,
          ...update,
        }),
        /withdrawn Health Commons protocol.*protocol lineage, effective snapshot, run plan, and analysis plan cannot be changed in place.*alternative as a new experiment.*saved run remains unchanged.*Abandonment changes status only.*separate member decision/u,
      );

      assert.equal(await fs.readFile(experimentPath, "utf8"), before);
    });
  },
);

test.each(["planned", "paused"] as const)(
  "%s withdrawn experiment accepts semantically identical protected inputs",
  async (status) => {
    await withWithdrawnExperiment(status, async ({
      vaultRoot,
      experimentId,
      experimentPath,
    }) => {
      const beforeDocument = parseFrontmatterDocument(
        await fs.readFile(experimentPath, "utf8"),
      );
      const result = await updateExperimentRecord({
        vault: vaultRoot,
        lookup: experimentId,
        commonsProtocolRef: WITHDRAWN_BEDTIME_PROTOCOL_REF,
        protocolRef: WITHDRAWN_PRIVATE_PROTOCOL_REF,
        effectiveProtocolSnapshot: WITHDRAWN_BEDTIME_SNAPSHOT,
        runPlan: WITHDRAWN_RUN_PLAN,
        analysisPlan: WITHDRAWN_ANALYSIS_PLAN,
      });
      const afterDocument = parseFrontmatterDocument(
        await fs.readFile(experimentPath, "utf8"),
      );

      assert.equal(result.status, status);
      for (const field of [
        "commonsProtocolRef",
        "protocolRef",
        "effectiveProtocolSnapshot",
        "runPlan",
        "analysisPlan",
      ] as const) {
        assert.deepEqual(
          afterDocument.attributes[field],
          beforeDocument.attributes[field],
        );
      }
    });
  },
);

test.each(["planned", "paused"] as const)(
  "%s withdrawn experiment allows abandonment without rewriting its saved plan",
  async (status) => {
    await withWithdrawnExperiment(status, async ({
      vaultRoot,
      experimentId,
      experimentPath,
    }) => {
      const before = await fs.readFile(experimentPath, "utf8");
      const beforeDocument = parseFrontmatterDocument(before);

      const result = await updateExperimentRecord({
        vault: vaultRoot,
        lookup: experimentId,
        status: "abandoned",
      });
      const afterDocument = parseFrontmatterDocument(
        await fs.readFile(experimentPath, "utf8"),
      );

      assert.equal(result.status, "abandoned");
      assert.equal(afterDocument.attributes.status, "abandoned");
      for (const field of [
        "commonsProtocolRef",
        "protocolRef",
        "effectiveProtocolSnapshot",
        "runPlan",
        "analysisPlan",
      ] as const) {
        assert.deepEqual(
          afterDocument.attributes[field],
          beforeDocument.attributes[field],
        );
      }
    });
  },
);

test.each(WITHDRAWN_POST_STATUS_CHANGES)(
  "$initialStatus withdrawn experiment rejects a later $field edit after abandonment",
  async ({ initialStatus, update }) => {
    await withWithdrawnExperiment(initialStatus, async ({
      vaultRoot,
      experimentId,
      experimentPath,
    }) => {
      const services = createIntegratedVaultServices();
      const abandonment = await services.core.updateExperiment({
        vault: vaultRoot,
        requestId: null,
        lookup: experimentId,
        status: "abandoned",
      });
      assert.equal(abandonment.status, "abandoned");
      const afterAbandonment = await fs.readFile(experimentPath, "utf8");

      await assert.rejects(
        services.core.updateExperiment({
          vault: vaultRoot,
          requestId: null,
          lookup: experimentId,
          ...update,
        }),
        /withdrawn Health Commons protocol.*cannot be changed in place.*saved run remains unchanged/u,
      );

      assert.equal(
        await fs.readFile(experimentPath, "utf8"),
        afterAbandonment,
      );
    });
  },
);

test.each([
  {
    status: "completed",
    update: {
      runPlan: {
        ...WITHDRAWN_RUN_PLAN,
        targetSessions: 12,
      },
    },
  },
  {
    status: "abandoned",
    update: {
      analysisPlan: {
        ...WITHDRAWN_ANALYSIS_PLAN,
        desiredDirection: "decrease",
      },
    },
  },
] satisfies ReadonlyArray<{
  status: "completed" | "abandoned";
  update: ProtectedExperimentUpdate;
}>)(
  "$status withdrawn experiment rejects a protected plan edit",
  async ({ status, update }) => {
    await withWithdrawnExperiment(status, async ({
      vaultRoot,
      experimentId,
      experimentPath,
    }) => {
      const services = createIntegratedVaultServices();
      const before = await fs.readFile(experimentPath, "utf8");

      await assert.rejects(
        services.core.updateExperiment({
          vault: vaultRoot,
          requestId: null,
          lookup: experimentId,
          ...update,
        }),
        /withdrawn Health Commons protocol.*cannot be changed in place.*saved run remains unchanged/u,
      );

      assert.equal(await fs.readFile(experimentPath, "utf8"), before);
    });
  },
);

test("active withdrawn experiment may adjust its current run plan", async () => {
  await withWithdrawnExperiment("active", async ({
    vaultRoot,
    experimentId,
    experimentPath,
  }) => {
    const services = createIntegratedVaultServices();
    const result = await services.core.updateExperiment({
      vault: vaultRoot,
      requestId: null,
      lookup: experimentId,
      runPlan: {
        ...WITHDRAWN_RUN_PLAN,
        targetSessions: 8,
      },
    });
    const afterDocument = parseFrontmatterDocument(
      await fs.readFile(experimentPath, "utf8"),
    );
    const runPlan = afterDocument.attributes.runPlan;
    if (
      runPlan === null
      || typeof runPlan !== "object"
      || Array.isArray(runPlan)
    ) {
      throw new Error("Expected a structured run plan.");
    }

    assert.equal(result.status, "active");
    assert.equal(runPlan.targetSessions, 8);
  });
});

test("active withdrawn experiment cannot become non-active while rewriting its saved plan", async () => {
  await withWithdrawnExperiment("active", async ({
    vaultRoot,
    experimentId,
    experimentPath,
  }) => {
    const services = createIntegratedVaultServices();
    const before = await fs.readFile(experimentPath, "utf8");

    await assert.rejects(
      services.core.updateExperiment({
        vault: vaultRoot,
        requestId: null,
        lookup: experimentId,
        status: "paused",
        runPlan: {
          ...WITHDRAWN_RUN_PLAN,
          targetSessions: 8,
        },
      }),
      /withdrawn Health Commons protocol.*cannot be changed in place.*saved run remains unchanged/u,
    );

    assert.equal(await fs.readFile(experimentPath, "utf8"), before);
  });
});

test("planned withdrawn experiment cannot replace its lineage while activating", async () => {
  await withWithdrawnExperiment("planned", async ({
    vaultRoot,
    experimentId,
    experimentPath,
  }) => {
    const services = createIntegratedVaultServices();
    const alternative = loadGeneratedHealthCommonsProtocolRunSpecs().protocols.find(
      (entry) =>
        entry.key ===
        "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    assert.ok(alternative?.protocol);
    const alternativeRunSpecRevisionId =
      alternative.revision.runSpecRevisionId;
    if (alternativeRunSpecRevisionId === null) {
      throw new Error("Expected a runnable alternative revision.");
    }
    const before = await fs.readFile(experimentPath, "utf8");

    await assert.rejects(
      services.core.applyExperimentOnboarding({
        vault: vaultRoot,
        requestId: null,
        lookup: experimentId,
        status: "active",
        protocolKey: alternative.key,
        pageRevisionId: alternative.revision.pageRevisionId,
        runSpecRevisionId: alternativeRunSpecRevisionId,
        onboardingCompletedAt: "2026-05-31T12:00:00.000Z",
      }),
      /withdrawn Health Commons protocol.*cannot be changed in place.*saved run remains unchanged/u,
    );

    assert.equal(await fs.readFile(experimentPath, "utf8"), before);

    const startedAlternative = await services.core.startExperiment({
      vault: vaultRoot,
      requestId: null,
      payload: {
        source: { kind: "health_commons_protocol" },
        experiment: {
          slug: "current-sauna-alternative",
          title: "Current Sauna Alternative",
          startedOn: "2026-06-01",
          status: "active",
        },
        commonsProtocolRef: {
          key: alternative.key,
          pageRevisionId: alternative.revision.pageRevisionId,
          runSpecRevisionId: alternativeRunSpecRevisionId,
        },
        effectiveProtocolSnapshot: {
          effectiveSpecHash: alternativeRunSpecRevisionId,
          doseSignature: "Use the current sauna alternative",
        },
        runPlan: {
          interventionStart: "2026-06-01",
          interventionEnd: "2026-06-07",
          modality: "dry_sauna",
          targetSessions: 3,
          minimumUsefulSessions: 2,
        },
        analysisPlan: {
          primaryBiomarkerKey: "biomarker:resting-heart-rate",
        },
        onboarding: {
          completedAt: "2026-05-31T12:00:00.000Z",
        },
      },
    });

    assert.notEqual(
      startedAlternative.experiment.experimentId,
      experimentId,
    );
    assert.equal(await fs.readFile(experimentPath, "utf8"), before);
  });
});

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
