import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { healthEntityDefinitions, protocolRegistryEntityDefinition } from "@murphai/contracts";
import { test } from "vitest";

import {
  findHealthDescriptorForLookup,
  healthEntityDescriptorByKind,
  inferHealthEntityKind,
} from "@murphai/assistant-engine/health-cli-descriptors";
import { getHealthRegistryCommandMetadata } from "@murphai/assistant-engine/health-registry-command-metadata";
import {
  createExplicitHealthCoreServices,
  createExplicitHealthQueryServices,
} from "@murphai/assistant-engine/usecases/explicit-health-family-services";

test("CLI health descriptors reuse shared taxonomy lookup metadata and scaffold templates", () => {
  for (const definition of healthEntityDefinitions) {
    const descriptor = healthEntityDescriptorByKind.get(definition.kind);

    assert.ok(descriptor, `missing CLI descriptor for ${definition.kind}`);
    assert.deepEqual(descriptor?.listKinds, definition.listKinds);
    assert.deepEqual(descriptor?.prefixes, definition.prefixes);
    assert.deepEqual(descriptor?.lookupAliases, definition.lookupAliases);

    if (descriptor?.core) {
      assert.deepEqual(descriptor.core.payloadTemplate, definition.scaffoldTemplate);
    }
  }
});

test("generic CLI lookup inference stays anchored to shared aliases and prefixes", () => {
  const profileDescriptor = findHealthDescriptorForLookup("current");
  const goalKind = inferHealthEntityKind("goal_01JSHAREDLOOKUP000000000001");
  const protocolDescriptor = findHealthDescriptorForLookup("prot_01JSHAREDLOOKUP000000000001");

  assert.equal(profileDescriptor?.kind, "profile");
  assert.equal(goalKind, "goal");
  assert.equal(protocolDescriptor?.kind, "protocol");
});

test("assessment list capabilities only advertise supported date-range filtering", () => {
  const descriptor = healthEntityDescriptorByKind.get("assessment");

  assert.ok(descriptor?.query);
  assert.deepEqual(descriptor?.query?.genericListFilterCapabilities, ["date-range"]);
});

test("protocol CLI descriptor reuses CLI-owned registry command and runtime metadata", () => {
  const descriptor = healthEntityDescriptorByKind.get("protocol");
  const command = getHealthRegistryCommandMetadata("protocol");

  assert.ok(descriptor?.command);
  assert.ok(descriptor?.core);
  assert.ok(descriptor?.query);
  assert.equal(descriptor?.command?.commandName, command.commandName);
  assert.equal(descriptor?.command?.description, command.commandDescription);
  assert.equal(descriptor?.command?.payloadFile, command.payloadFile);
  assert.deepEqual(descriptor?.command?.showId, command.showId);
  assert.equal(descriptor?.core?.runtimeMethod, command.runtimeMethod);
  assert.equal(descriptor?.core?.upsertServiceMethod, command.upsertServiceMethod);
  assert.equal(descriptor?.query?.runtimeListMethod, command.runtimeListMethod);
  assert.equal(descriptor?.query?.runtimeShowMethod, command.runtimeShowMethod);
  assert.equal(descriptor?.query?.showServiceMethod, command.showServiceMethod);
  assert.equal(descriptor?.query?.listServiceMethod, command.listServiceMethod);
  assert.equal(descriptor?.core?.resultIdField, protocolRegistryEntityDefinition.registry.idField);
});

test("registry command metadata derives spaced method stems and status labels from shared nouns", () => {
  const family = getHealthRegistryCommandMetadata("family");
  const genetics = getHealthRegistryCommandMetadata("genetics");

  assert.equal(family.listServiceMethod, "listFamilyMembers");
  assert.equal(family.runtimeMethod, "upsertFamilyMember");
  assert.equal(family.runtimeShowMethod, "showFamilyMember");
  assert.equal(genetics.listServiceMethod, "listGeneticVariants");
  assert.equal(genetics.runtimeMethod, "upsertGeneticVariant");
  assert.equal(genetics.listStatusDescription, "Optional genetic-variant status to filter by.");
});

test("explicit health services reuse shared protocol metadata and nested registry envelopes", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "protocol.json");
  const runtimeCalls: Array<Record<string, unknown>> = [];

  try {
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Magnesium glycinate",
      }),
      "utf8",
    );

    const coreServices = createExplicitHealthCoreServices(async () => ({
      core: {
        async upsertProtocolItem(input: Record<string, unknown>) {
          runtimeCalls.push(input);

          return {
            record: {
              entity: {
                protocolId: "prot_01JSHAREDMETADATA000000000001",
              },
              document: {
                relativePath: "bank/protocols/supplements/sleep/magnesium-glycinate.md",
              },
            },
            created: true,
          };
        },
      } as never,
    }));
    const queryServices = createExplicitHealthQueryServices(async () => ({
      query: {
        async showProtocol() {
          return {
            entity: {
              protocolId: "prot_01JSHAREDMETADATA000000000001",
              title: "Magnesium glycinate",
              kind: "supplement",
              status: "active",
              startedOn: "2026-03-12",
              brand: "Thorne",
              ingredients: [],
            },
            document: {
              relativePath: "bank/protocols/supplements/sleep/magnesium-glycinate.md",
              markdown: "# Magnesium glycinate",
              body: "# Magnesium glycinate",
            },
          };
        },
        async showSupplement() {
          return {
            entity: {
              protocolId: "prot_01JSHAREDMETADATA000000000001",
              title: "Magnesium glycinate",
              kind: "supplement",
              status: "active",
              startedOn: "2026-03-12",
              brand: "Thorne",
              ingredients: [],
            },
            document: {
              relativePath: "bank/protocols/supplements/sleep/magnesium-glycinate.md",
              markdown: "# Magnesium glycinate",
              body: "# Magnesium glycinate",
            },
          };
        },
      } as never,
    }));

    const upsertResult = await coreServices.upsertProtocol({
      input: payloadPath,
      requestId: null,
      vault: vaultRoot,
    });
    const protocolResult = await queryServices.showProtocol({
      id: "prot_01JSHAREDMETADATA000000000001",
      requestId: null,
      vault: vaultRoot,
    });
    const supplementResult = await queryServices.showSupplement({
      id: "prot_01JSHAREDMETADATA000000000001",
      requestId: null,
      vault: vaultRoot,
    });

    assert.equal(runtimeCalls.length, 1);
    assert.equal(runtimeCalls[0]?.vaultRoot, vaultRoot);
    assert.equal(runtimeCalls[0]?.title, "Magnesium glycinate");
    assert.equal(upsertResult.protocolId, "prot_01JSHAREDMETADATA000000000001");
    assert.equal(
      protocolResult.entity.id,
      "prot_01JSHAREDMETADATA000000000001",
    );
    assert.equal(protocolResult.entity.data.brand, "Thorne");
    assert.equal(
      supplementResult.entity.id,
      "prot_01JSHAREDMETADATA000000000001",
    );
    assert.equal(supplementResult.entity.kind, "supplement");
    assert.equal(supplementResult.entity.data.brand, "Thorne");
    assert.equal(
      supplementResult.entity.path,
      "bank/protocols/supplements/sleep/magnesium-glycinate.md",
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
