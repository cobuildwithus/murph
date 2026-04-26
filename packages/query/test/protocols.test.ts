import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CURRENT_VAULT_FORMAT_VERSION } from "@murphai/contracts";
import { test } from "vitest";

import {
  getProtocol,
  getProtocolSummary,
  inferIdEntityKind,
  isProtocolEntity,
  isQueryableLookupId,
  listEntities,
  listProtocolSummaries,
  listProtocols,
  PROTOCOL_DIRECTORY,
  readExperimentProtocolProjectionFields,
  readVault,
  searchVault,
  searchVaultRuntime,
  summarizeProtocol,
} from "../src/index.ts";

test("readVault discovers and lists private protocol markdown records", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-protocol-"));
  const protocolRevisionId = `sha256:${"3".repeat(64)}`;
  const effectiveSpecHash = `sha256:${"4".repeat(64)}`;

  try {
    await writeVaultMetadata(vaultRoot, "Protocol query fixture");
    await writeVaultFile(
      vaultRoot,
      `${PROTOCOL_DIRECTORY}/sauna-travel.md`,
      `---
schemaVersion: murph.frontmatter.protocol.v1
docType: protocol
protocolId: prot_01K72NVW6Z4QK8VYAVX7GT7S4B
slug: sauna-travel
title: Lower-burden sauna travel protocol
status: available
commonsProtocolRef:
  key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  pageRevisionId: sha256:page-revision
  runSpecRevisionId: sha256:run-spec-revision
  testPlanId: rhr-21d
lineage:
  sourceKind: health_commons_protocol
diff: []
effectiveSpec:
  doseSignature: two travel-friendly sauna sessions weekly
  modality: sauna
  frequency:
    sessionsPerWeek: 2
  durationMinutes:
    target: 12
  targetSessions: 6
  minimumUsefulSessions: 4
personalization: {}
effectiveSpecHash: ${effectiveSpecHash}
protocolRevisionId: ${protocolRevisionId}
---
# Lower-burden sauna travel protocol

Use two short sauna sessions while traveling and keep the review window unchanged.
`,
    );

    const vault = await readVault(vaultRoot);
    const protocol = getProtocol(vault, "sauna-travel");

    assert.ok(protocol);
    assert.equal(protocol.family, "protocol");
    assert.equal(protocol.kind, "protocol");
    assert.equal(protocol.recordClass, "bank");
    assert.equal(protocol.path, "bank/protocols/sauna-travel.md");
    assert.equal(protocol.status, "available");
    assert.deepEqual(listProtocols(vault).map((entry) => entry.entityId), [
      "prot_01K72NVW6Z4QK8VYAVX7GT7S4B",
    ]);
    assert.deepEqual(vault.protocols.map((entry) => entry.entityId), [
      "prot_01K72NVW6Z4QK8VYAVX7GT7S4B",
    ]);
    assert.deepEqual(vault.byFamily.protocol?.map((entry) => entry.entityId), [
      "prot_01K72NVW6Z4QK8VYAVX7GT7S4B",
    ]);
    assert.equal(isProtocolEntity(protocol), true);
    assert.deepEqual(
      listEntities(vault, { families: ["protocol"] }).map((entry) => entry.entityId),
      ["prot_01K72NVW6Z4QK8VYAVX7GT7S4B"],
    );
    assert.deepEqual(
      listProtocols(vault, { text: "lower-burden" }).map((entry) => entry.entityId),
      ["prot_01K72NVW6Z4QK8VYAVX7GT7S4B"],
    );

    const summary = summarizeProtocol(protocol);
    assert.equal(summary.slug, "sauna-travel");
    assert.equal(summary.protocolRevisionId, protocolRevisionId);
    assert.equal(summary.effectiveSpecHash, effectiveSpecHash);
    assert.equal(
      summary.commonsProtocolRef?.key,
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );
    assert.equal(summary.effectiveSpec?.doseSignature, "two travel-friendly sauna sessions weekly");
    assert.match(summary.summary ?? "", /two short sauna sessions/u);
    assert.deepEqual(listProtocolSummaries(vault).map((entry) => entry.id), [
      "prot_01K72NVW6Z4QK8VYAVX7GT7S4B",
    ]);
    assert.equal(getProtocolSummary(vault, "prot_01K72NVW6Z4QK8VYAVX7GT7S4B")?.slug, "sauna-travel");
    assert.equal(isQueryableLookupId("prot_01K72NVW6Z4QK8VYAVX7GT7S4B"), true);
    assert.equal(inferIdEntityKind("prot_01K72NVW6Z4QK8VYAVX7GT7S4B"), "protocol");

    assert.deepEqual(
      searchVault(vault, "travel sauna", { recordTypes: ["protocol"] }).hits.map(
        (hit) => hit.recordId,
      ),
      ["prot_01K72NVW6Z4QK8VYAVX7GT7S4B"],
    );
    assert.deepEqual(
      (await searchVaultRuntime(vaultRoot, "travel sauna", {
        recordTypes: ["protocol"],
      })).hits.map((hit) => hit.recordId),
      ["prot_01K72NVW6Z4QK8VYAVX7GT7S4B"],
    );

    assert.deepEqual(readExperimentProtocolProjectionFields({}), {
      commonsProtocolRef: null,
      effectiveProtocolSnapshot: null,
      protocolRef: null,
    });
    assert.deepEqual(
      readExperimentProtocolProjectionFields(experimentProtocolProjectionFixture()),
      {
        commonsProtocolRef: experimentProtocolProjectionFixture().commonsProtocolRef,
        effectiveProtocolSnapshot: experimentProtocolProjectionFixture().effectiveProtocolSnapshot,
        protocolRef: experimentProtocolProjectionFixture().protocolRef,
      },
    );
    assert.deepEqual(
      readExperimentProtocolProjectionFields({
        ...experimentProtocolProjectionFixture(),
        protocolRef: undefined,
      }),
      {
        commonsProtocolRef: experimentProtocolProjectionFixture().commonsProtocolRef,
        effectiveProtocolSnapshot: experimentProtocolProjectionFixture().effectiveProtocolSnapshot,
        protocolRef: null,
      },
    );

    assert.throws(
      () =>
        summarizeProtocol({
          ...protocol,
          attributes: {},
          family: "experiment",
          kind: "experiment",
        }),
      /Expected protocol entity/u,
    );

    assert.throws(
      () =>
        summarizeProtocol({
          ...protocol,
          attributes: {
            docType: "protocol",
            slug: "sparse-protocol",
          },
          body: "# Empty after heading",
          title: null,
        }),
      /Protocol frontmatter is invalid/u,
    );
    assert.equal(summarizeProtocol({ ...protocol, body: "# Empty after heading" }).summary, null);
    assert.equal(summarizeProtocol({ ...protocol, body: null }).summary, null);
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

test("readVault rejects protocol markdown that does not match the strict contract", async () => {
  const vaultRoot = await mkdtemp(path.join(os.tmpdir(), "murph-query-protocol-invalid-"));

  try {
    await writeVaultMetadata(vaultRoot, "Invalid protocol query fixture");
    await writeVaultFile(
      vaultRoot,
      `${PROTOCOL_DIRECTORY}/broken.md`,
      `---
schemaVersion: murph.frontmatter.protocol.v1
docType: protocol
protocolId: prot_01K72NVW6Z4QK8VYAVX7GT7S4C
slug: broken
title: Broken protocol
status: available
---
# Broken protocol
`,
    );

    await assert.rejects(
      () => readVault(vaultRoot),
      (error) =>
        typeof error === "object" &&
        error !== null &&
        (error as { code?: string }).code === "FRONTMATTER_INVALID",
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});

function experimentProtocolProjectionFixture() {
  const effectiveSpecHash = `sha256:${"4".repeat(64)}`;

  return {
    schemaVersion: "murph.frontmatter.experiment.v1",
    docType: "experiment",
    experimentId: "exp_01K72NVW6Z4QK8VYAVX7GT7S4B",
    slug: "sauna-travel-run",
    status: "active",
    title: "Sauna travel run",
    startedOn: "2026-04-26",
    commonsProtocolRef: {
      key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      pageRevisionId: `sha256:${"1".repeat(64)}`,
      runSpecRevisionId: `sha256:${"2".repeat(64)}`,
      testPlanId: "rhr-21d",
    },
    protocolRef: {
      protocolId: "prot_01K72NVW6Z4QK8VYAVX7GT7S4B",
      protocolRevisionId: `sha256:${"3".repeat(64)}`,
      effectiveSpecHash,
    },
    effectiveProtocolSnapshot: {
      effectiveSpecHash,
      doseSignature: "Two short sauna sessions weekly",
      modality: "sauna",
    },
  };
}

async function writeVaultMetadata(vaultRoot: string, title: string): Promise<void> {
  await writeVaultFile(
    vaultRoot,
    "vault.json",
    JSON.stringify({
      formatVersion: CURRENT_VAULT_FORMAT_VERSION,
      vaultId: "vault_01K72NVW6Z4QK8VYAVX7GT7S4B",
      createdAt: "2026-04-26T00:00:00.000Z",
      title,
      timezone: "UTC",
    }),
  );
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const absolutePath = path.join(vaultRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${contents.trim()}\n`, "utf8");
}
