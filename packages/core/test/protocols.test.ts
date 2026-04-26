import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { test } from "vitest";

import {
  initializeVault,
  listProtocols,
  parseFrontmatterDocument,
  readJsonlRecords,
  readProtocol,
  upsertProtocol,
  VaultError,
} from "../src/index.ts";

async function makeTempDirectory(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

function validProtocolFrontmatterPatch() {
  return {
    commonsProtocolRef: {
      key: "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      pageRevisionId: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      runSpecRevisionId: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      testPlanId: "dry-sauna-travel-14d",
    },
    lineage: {
      sourceKind: "health_commons_protocol",
      notes: ["Fit sauna sessions around work travel."],
    },
    diff: [
      {
        path: "/durationMinutes/target",
        op: "replace",
        before: 20,
        after: 12,
        reason: "Keep the travel variant lower burden.",
      },
    ],
    effectiveSpec: {
      doseSignature: "Dry sauna 12 minutes twice weekly",
      modality: "dry sauna",
      frequency: {
        sessionsPerWeek: 2,
      },
      durationMinutes: {
        target: 12,
      },
      targetSessions: 6,
      minimumUsefulSessions: 4,
      instructions: ["Warm up slowly.", "Stop early if the session feels too taxing."],
      stopConditions: ["Stop if dizziness or unusual symptoms appear."],
    },
    personalization: {
      target: "travel recovery",
      constraints: {
        hotelGymAccess: true,
        lowerHeatTolerance: true,
      },
      notes: ["Keep this as a lower-burden travel variant."],
    },
    effectiveSpecHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    protocolRevisionId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
}

test("protocols write strict frontmatter and body through the canonical markdown registry", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-write");
  await initializeVault({ vaultRoot });

  const created = await upsertProtocol({
    vaultRoot,
    slug: "travel-sauna-ramp",
    title: "Travel Sauna Ramp",
    frontmatter: validProtocolFrontmatterPatch(),
    body: "# Travel Sauna Ramp\n\nUse this lower-burden sauna variant while traveling.\n",
  });
  const listed = await listProtocols(vaultRoot);
  const read = await readProtocol({
    vaultRoot,
    slug: "travel-sauna-ramp",
  });
  const stored = parseFrontmatterDocument(
    await fs.readFile(path.join(vaultRoot, created.record.document.relativePath), "utf8"),
  );
  const auditRecords = await readJsonlRecords({
    vaultRoot,
    relativePath: created.auditPath,
  });

  assert.equal(created.created, true);
  assert.match(created.record.entity.protocolId, /^prot_[0-9A-HJKMNP-TV-Z]{26}$/u);
  assert.equal(created.record.document.relativePath, "bank/protocols/travel-sauna-ramp.md");
  assert.equal(read.entity.protocolId, created.record.entity.protocolId);
  assert.equal(listed.length, 1);
  assert.equal(stored.attributes.schemaVersion, "murph.frontmatter.protocol.v1");
  assert.equal(stored.attributes.docType, "protocol");
  assert.equal(stored.attributes.protocolId, created.record.entity.protocolId);
  assert.equal(stored.attributes.slug, "travel-sauna-ramp");
  assert.equal(stored.attributes.title, "Travel Sauna Ramp");
  assert.equal(stored.attributes.status, "available");
  assert.match(String(stored.attributes.effectiveSpecHash), /^sha256:[a-f0-9]{64}$/u);
  assert.match(String(stored.attributes.protocolRevisionId), /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(
    stored.attributes.effectiveSpecHash,
    validProtocolFrontmatterPatch().effectiveSpecHash,
  );
  assert.notEqual(
    stored.attributes.protocolRevisionId,
    validProtocolFrontmatterPatch().protocolRevisionId,
  );
  assert.deepEqual(stored.attributes.personalization, {
    target: "travel recovery",
    constraints: {
      hotelGymAccess: true,
      lowerHeatTolerance: true,
    },
    notes: ["Keep this as a lower-burden travel variant."],
  });
  assert.match(stored.body, /lower-burden sauna variant/u);
  assert.ok(
    auditRecords.some(
      (record) =>
        typeof record === "object" &&
        record !== null &&
        (record as { action?: string; commandName?: string }).action === "protocol_upsert" &&
        (record as { commandName?: string }).commandName === "core.upsertProtocol",
    ),
  );
});

test("protocols update by slug or id while preserving unrelated frontmatter and body", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-preserve");
  await initializeVault({ vaultRoot });

  const created = await upsertProtocol({
    vaultRoot,
    slug: "travel-sauna-ramp",
    title: "Travel Sauna Ramp",
    frontmatter: validProtocolFrontmatterPatch(),
    body: "# Travel Sauna Ramp\n\nOriginal body stays unless the caller replaces it.\n",
  });
  const updatedBySlug = await upsertProtocol({
    vaultRoot,
    slug: "travel-sauna-ramp",
    title: "Travel Sauna Ramp Updated",
    frontmatter: {
      protocolRevisionId: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    },
  });
  const updatedById = await upsertProtocol({
    vaultRoot,
    protocolId: created.record.entity.protocolId,
  });
  const read = await readProtocol({
    vaultRoot,
    protocolId: created.record.entity.protocolId,
  });

  assert.equal(updatedBySlug.created, false);
  assert.equal(updatedById.created, false);
  assert.equal(updatedBySlug.record.entity.protocolId, created.record.entity.protocolId);
  assert.equal(read.entity.title, "Travel Sauna Ramp Updated");
  assert.deepEqual(read.entity.commonsProtocolRef, created.record.entity.commonsProtocolRef);
  assert.deepEqual(read.entity.lineage, created.record.entity.lineage);
  assert.deepEqual(read.entity.diff, created.record.entity.diff);
  assert.deepEqual(read.entity.effectiveSpec, created.record.entity.effectiveSpec);
  assert.deepEqual(read.entity.personalization, created.record.entity.personalization);
  assert.notEqual(read.entity.protocolRevisionId, created.record.entity.protocolRevisionId);
  assert.notEqual(
    read.entity.protocolRevisionId,
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  );
  assert.equal(read.entity.effectiveSpecHash, created.record.entity.effectiveSpecHash);
  assert.match(read.document.body, /Original body stays/u);
});

test("protocols can derive selectors from frontmatter and rename explicitly", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-rename");
  await initializeVault({ vaultRoot });

  const protocolId = "prot_01K87VFGG91SZ3MVV4EVQFDRWB";
  const created = await upsertProtocol({
    vaultRoot,
    title: "Generated Body Protocol",
    frontmatter: {
      ...validProtocolFrontmatterPatch(),
      schemaVersion: "murph.frontmatter.protocol.v1",
      docType: "protocol",
      protocolId,
      slug: "generated-body-protocol",
    },
  });
  const renamed = await upsertProtocol({
    vaultRoot,
    protocolId,
    slug: "renamed-generated-body-protocol",
    allowSlugRename: true,
  });

  await assert.rejects(
    () => fs.readFile(path.join(vaultRoot, created.record.document.relativePath), "utf8"),
    (error) =>
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT",
  );
  assert.equal(created.created, true);
  assert.equal(renamed.created, false);
  assert.equal(renamed.record.entity.protocolId, protocolId);
  assert.equal(renamed.record.entity.slug, "renamed-generated-body-protocol");
  assert.equal(renamed.record.document.relativePath, "bank/protocols/renamed-generated-body-protocol.md");
  assert.doesNotMatch(renamed.record.document.body, /prot_01K87VFGG91SZ3MVV4EVQFDRWB/u);
  assert.doesNotMatch(renamed.record.document.body, /renamed-generated-body-protocol/u);
  assert.match(renamed.record.document.body, /Protocol-specific details are stored in frontmatter/u);
});

test("protocol selectors and system frontmatter fail closed on conflicts", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-conflicts");
  await initializeVault({ vaultRoot });

  await assert.rejects(
    () =>
      upsertProtocol({
        vaultRoot,
        slug: "explicit-slug",
        title: "Conflicting Slug",
        frontmatter: {
          ...validProtocolFrontmatterPatch(),
          slug: "frontmatter-slug",
        },
      }),
    (error) =>
      error instanceof VaultError &&
      error.code === "VAULT_PROTOCOL_CONFLICT",
  );
  await assert.rejects(
    () =>
      upsertProtocol({
        vaultRoot,
        protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWC",
        title: "Conflicting Id",
        frontmatter: {
          ...validProtocolFrontmatterPatch(),
          protocolId: "prot_01K87VFGG91SZ3MVV4EVQFDRWD",
        },
      }),
    (error) =>
      error instanceof VaultError &&
      error.code === "VAULT_PROTOCOL_CONFLICT",
  );
  await assert.rejects(
    () =>
      upsertProtocol({
        vaultRoot,
        title: "Wrong Doc Type",
        frontmatter: {
          ...validProtocolFrontmatterPatch(),
          docType: "regimen",
        },
      }),
    (error) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT",
  );
  await assert.rejects(
    () =>
      upsertProtocol({
        vaultRoot,
        title: "Wrong Status",
        frontmatter: {
          ...validProtocolFrontmatterPatch(),
          status: "active",
        },
      }),
    (error) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_INPUT",
  );
});

test("protocol reads reject non-canonical frontmatter", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-strict");
  await initializeVault({ vaultRoot });
  await fs.mkdir(path.join(vaultRoot, "bank/protocols"), { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, "bank/protocols/broken.md"),
    [
      "---",
      "schemaVersion: murph.frontmatter.protocol.v1",
      "docType: protocol",
      "protocolId: prot_01K87VFGG91SZ3MVV4EVQFDRWA",
      "slug: broken",
      "title: Broken protocol",
      "status: available",
      "commonsProtocolRef:",
      "  key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
      "  pageRevisionId: sha256:1111111111111111111111111111111111111111111111111111111111111111",
      "  runSpecRevisionId: sha256:2222222222222222222222222222222222222222222222222222222222222222",
      "lineage:",
      "  sourceKind: health_commons_protocol",
      "diff: []",
      "effectiveSpec:",
      "  doseSignature: Dry sauna 12 minutes twice weekly",
      "personalization: {}",
      "effectiveSpecHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "protocolRevisionId: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "unexpectedField: should-fail",
      "---",
      "# Broken protocol",
      "",
    ].join("\n"),
  );

  await assert.rejects(
    () => readProtocol({ vaultRoot, slug: "broken" }),
    (error) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_PROTOCOL",
  );
});

test("protocol reads reject stale derived hashes after manual edits", async () => {
  const vaultRoot = await makeTempDirectory("murph-protocol-derived-hashes");
  await initializeVault({ vaultRoot });

  const created = await upsertProtocol({
    vaultRoot,
    slug: "travel-sauna-ramp",
    title: "Travel Sauna Ramp",
    frontmatter: validProtocolFrontmatterPatch(),
    body: "# Travel Sauna Ramp\n\nUse this lower-burden sauna variant while traveling.\n",
  });
  const protocolPath = path.join(vaultRoot, created.record.document.relativePath);
  const originalMarkdown = await fs.readFile(protocolPath, "utf8");

  await fs.writeFile(
    protocolPath,
    originalMarkdown.replace("target: 12", "target: 13"),
    "utf8",
  );
  await assert.rejects(
    () => readProtocol({ vaultRoot, slug: "travel-sauna-ramp" }),
    (error) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_PROTOCOL" &&
      error.details?.field === "effectiveSpecHash",
  );

  await fs.writeFile(
    protocolPath,
    originalMarkdown.replace("lower-burden sauna variant", "gentler sauna variant"),
    "utf8",
  );
  await assert.rejects(
    () => readProtocol({ vaultRoot, slug: "travel-sauna-ramp" }),
    (error) =>
      error instanceof VaultError &&
      error.code === "VAULT_INVALID_PROTOCOL" &&
      error.details?.field === "protocolRevisionId",
  );
});
