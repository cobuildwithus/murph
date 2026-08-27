import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getHealthRegistryCommandMetadata,
  healthEntityDescriptorByKind,
} from "@murphai/vault-usecases";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import {
  getHealthRegistryFamily,
  healthRegistryFamilies,
} from "../src/health-registry-families.ts";
import {
  createExplicitHealthCoreServices,
  createExplicitHealthQueryServices,
} from "../src/usecases/explicit-health-family-services.ts";

describe("health registry family seams", () => {
  it("centralizes shared registry definitions, ids, and command metadata", () => {
    expect(healthRegistryFamilies.map((family) => family.definition.kind)).toEqual([
      "goal",
      "condition",
      "allergy",
      "regimen",
      "family",
      "genetics",
    ]);

    const family = getHealthRegistryFamily("family");
    const genetics = getHealthRegistryFamily("genetics");

    expect(family.command).toEqual(getHealthRegistryCommandMetadata("family"));
    expect(family.idField).toBe("familyMemberId");
    expect(family.readEntityIdKeys).toEqual(["id", "familyMemberId"]);
    expect(family.supportsStatusFilter).toBe(false);

    expect(genetics.command).toEqual(getHealthRegistryCommandMetadata("genetics"));
    expect(genetics.idField).toBe("variantId");
    expect(genetics.readEntityIdKeys).toEqual(["id", "variantId"]);
    expect(genetics.supportsStatusFilter).toBe(true);
  });

  it("reuses the shared family seam in descriptors and explicit query services", async () => {
    const familyDescriptor = healthEntityDescriptorByKind.get("family");
    const geneticsDescriptor = healthEntityDescriptorByKind.get("genetics");

    expect(familyDescriptor?.query?.genericListFilterCapabilities).toEqual([]);
    expect(geneticsDescriptor?.query?.genericListFilterCapabilities).toEqual(["status"]);

    const services = createExplicitHealthQueryServices(async () => ({
      query: {
        async showFamilyMember() {
          return {
            entity: {
              familyMemberId: "fam_01JSHARED000000000000000001",
              title: "Parent history",
            },
            document: {
              relativePath: "bank/family/parent-history.md",
            },
          };
        },
        async showGeneticVariant() {
          return {
            entity: {
              variantId: "var_01JSHARED000000000000000001",
              title: "MTHFR C677T",
            },
            document: {
              relativePath: "bank/genetics/mthfr-c677t.md",
            },
          };
        },
      } as never,
    }));

    const familyResult = await services.showFamilyMember({
      id: "fam_01JSHARED000000000000000001",
      requestId: null,
      vault: "./vault",
    });
    const geneticsResult = await services.showGeneticVariant({
      id: "var_01JSHARED000000000000000001",
      requestId: null,
      vault: "./vault",
    });

    expect(familyResult.entity.id).toBe("fam_01JSHARED000000000000000001");
    expect(familyResult.entity.path).toBe("bank/family/parent-history.md");
    expect(geneticsResult.entity.id).toBe("var_01JSHARED000000000000000001");
    expect(geneticsResult.entity.path).toBe("bank/genetics/mthfr-c677t.md");
  });

  it("routes family scaffold, upsert, and list services through the shared seam", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-usecases-family-"));
    const payloadPath = path.join(vaultRoot, "family.json");
    const runtimeCalls: Array<Record<string, unknown>> = [];

    try {
      await writeFile(
        payloadPath,
        JSON.stringify({
          relationship: "mother",
          title: "Maternal history",
        }),
        "utf8",
      );

      const coreServices = createExplicitHealthCoreServices(async () => ({
        core: {
          async upsertFamilyMember(input: Record<string, unknown>) {
            runtimeCalls.push(input);

            return {
              record: {
                entity: {
                  familyMemberId: "fam_01JSHARED000000000000000002",
                },
                document: {
                  relativePath: "bank/family/maternal-history.md",
                },
              },
              created: true,
            };
          },
        } as never,
      }));
      const queryServices = createExplicitHealthQueryServices(async () => ({
        query: {
          async listFamilyMembers(_vaultRoot: string, options: { limit?: number; status?: string }) {
            runtimeCalls.push({
              listLimit: options.limit ?? null,
              listStatus: options.status ?? null,
            });

            return [
              {
                entity: {
                  familyMemberId: "fam_01JSHARED000000000000000002",
                  title: "Maternal history",
                },
                document: {
                  relativePath: "bank/family/maternal-history.md",
                },
              },
            ];
          },
        } as never,
      }));

      const scaffoldResult = await coreServices.scaffoldFamilyMember({
        requestId: null,
        vault: vaultRoot,
      });
      const upsertResult = await coreServices.upsertFamilyMember({
        input: payloadPath,
        requestId: null,
        vault: vaultRoot,
      });
      const listResult = await queryServices.listFamilyMembers({
        limit: 5,
        requestId: null,
        status: "active",
        vault: vaultRoot,
      });

      expect(scaffoldResult.noun).toBe("family");
      expect(upsertResult.familyMemberId).toBe("fam_01JSHARED000000000000000002");
      expect(upsertResult.path).toBe("bank/family/maternal-history.md");
      expect(runtimeCalls[0]).toMatchObject({
        relationship: "mother",
        title: "Maternal history",
        vaultRoot,
      });
      expect(listResult.filters).toEqual({
        limit: 5,
        status: "active",
      });
      expect(listResult.items[0]?.id).toBe("fam_01JSHARED000000000000000002");
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("does not synthesize active status for title-only condition imports", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-usecases-condition-"));
    const payloadPath = path.join(vaultRoot, "condition.json");
    const runtimeCalls: Array<Record<string, unknown>> = [];

    try {
      await writeFile(
        payloadPath,
        JSON.stringify({
          title: "Migraine",
          note: "Tracking recurrence pattern.",
        }),
        "utf8",
      );

      const coreServices = createExplicitHealthCoreServices(async () => ({
        core: {
          async upsertCondition(input: Record<string, unknown>) {
            runtimeCalls.push(input);

            return {
              record: {
                entity: {
                  conditionId: "cond_01JSHARED000000000000000001",
                },
                document: {
                  relativePath: "bank/conditions/migraine.md",
                },
              },
              created: false,
            };
          },
        } as never,
      }));

      const upsertResult = await coreServices.upsertCondition({
        input: payloadPath,
        requestId: null,
        vault: vaultRoot,
      });

      expect(upsertResult.conditionId).toBe("cond_01JSHARED000000000000000001");
      expect(runtimeCalls[0]).toEqual({
        title: "Migraine",
        note: "Tracking recurrence pattern.",
        vaultRoot,
      });
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("preserves producer-owned nested validation paths without echoing strict-object keys", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-vault-usecases-health-validation-"));
    let runtimeLoads = 0;
    const services = createExplicitHealthCoreServices(async () => {
      runtimeLoads += 1;
      throw new Error("Validation must finish before loading the write runtime.");
    });
    const privateRootKey = "privateRootUnknownKeySentinel";
    const privateNestedKey = "privateNestedUnknownKeySentinel";

    try {
      const cases = [
        {
          fileName: "blood-test.json",
          payload: {
            occurredAt: "2026-03-12T12:00:00.000Z",
            title: "Synthetic panel",
            testName: "Synthetic panel",
            results: [{
              analyte: "Synthetic analyte",
              slug: "private-result-slug-sentinel".repeat(8),
              value: 1,
            }],
          },
          privateTokens: ["private-result-slug-sentinel"],
          publicPath: ["results", 0, "slug"],
          run(input: string) {
            return services.upsertBloodTest({ input, requestId: null, vault: vaultRoot });
          },
        },
        {
          fileName: "condition.json",
          payload: {
            title: "Synthetic condition",
            links: [{
              type: "related_goal",
              targetId: "private-invalid-target-id-sentinel",
            }],
          },
          privateTokens: ["private-invalid-target-id-sentinel"],
          publicPath: ["links", 0, "targetId"],
          run(input: string) {
            return services.upsertCondition({ input, requestId: null, vault: vaultRoot });
          },
        },
        {
          fileName: "immunization-evidence.json",
          payload: {
            occurredAt: "2026-03-12T12:00:00.000Z",
            title: "Synthetic vaccine",
            vaccineName: "Synthetic vaccine",
            evidence: [{
              sourceDocumentId: "private-invalid-document-id-sentinel",
            }],
          },
          privateTokens: ["private-invalid-document-id-sentinel"],
          publicPath: ["evidence", 0, "sourceDocumentId"],
          run(input: string) {
            return services.upsertImmunization({ input, requestId: null, vault: vaultRoot });
          },
        },
        {
          fileName: "family-history.json",
          payload: {
            title: "Synthetic family history",
            relationship: "parent",
            conditionHistory: [{
              condition: "Synthetic condition",
              onsetText: "private-onset-text-sentinel".repeat(8),
            }],
          },
          privateTokens: ["private-onset-text-sentinel"],
          publicPath: ["conditionHistory", 0, "onsetText"],
          run(input: string) {
            return services.upsertFamilyMember({ input, requestId: null, vault: vaultRoot });
          },
        },
        {
          fileName: "immunization-root-unknown.json",
          payload: {
            occurredAt: "2026-03-12T12:00:00.000Z",
            title: "Synthetic vaccine",
            vaccineName: "Synthetic vaccine",
            [privateRootKey]: "private-root-unknown-value-sentinel",
          },
          privateTokens: [privateRootKey, "private-root-unknown-value-sentinel"],
          publicPath: [],
          run(input: string) {
            return services.upsertImmunization({ input, requestId: null, vault: vaultRoot });
          },
        },
        {
          fileName: "family-history-nested-unknown.json",
          payload: {
            title: "Synthetic family history",
            relationship: "parent",
            conditionHistory: [{
              condition: "Synthetic condition",
              [privateNestedKey]: "private-nested-unknown-value-sentinel",
            }],
          },
          privateTokens: [privateNestedKey, "private-nested-unknown-value-sentinel"],
          publicPath: ["conditionHistory", 0],
          run(input: string) {
            return services.upsertFamilyMember({ input, requestId: null, vault: vaultRoot });
          },
        },
      ];

      for (const entry of cases) {
        const payloadPath = path.join(vaultRoot, entry.fileName);
        await writeFile(payloadPath, JSON.stringify(entry.payload), "utf8");
        const error = await entry.run(payloadPath).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(VaultCliError);
        expect(error).toMatchObject({
          code: "invalid_payload",
          context: {
            issues: expect.arrayContaining([
              expect.objectContaining({ publicPath: entry.publicPath }),
            ]),
            stage: "validation",
          },
        });
        const serialized = JSON.stringify(error);
        for (const privateToken of entry.privateTokens) {
          expect(serialized).not.toContain(privateToken);
        }
      }

      expect(runtimeLoads).toBe(0);
    } finally {
      await rm(vaultRoot, { force: true, recursive: true });
    }
  });

  it("keeps submitted protocol validation field-correctable", async () => {
    const coreServices = createExplicitHealthCoreServices(async () => ({
      core: {
        async upsertProtocol() {
          throw Object.assign(new Error("private core validation detail"), {
            name: "VaultError",
            code: "VAULT_INVALID_PROTOCOL",
            details: {
              validationSource: "submitted_candidate",
              fields: [{
                path: ["effectiveSpec"],
                code: "invalid_type",
                message: "PrivateProtocolSpecSentinel",
              }],
            },
          });
        },
      } as never,
    }));

    const error = await coreServices.upsertPrivateProtocol({
      requestId: null,
      vault: "./vault",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(VaultCliError);
    expect(error).toMatchObject({
      code: "contract_invalid",
      context: {
        validationSource: "submitted_candidate",
        vaultCode: "VAULT_INVALID_PROTOCOL",
        stage: "validation",
        issues: [{
          publicPath: ["effectiveSpec"],
          code: "invalid_type",
        }],
      },
    });
    expect(error).not.toHaveProperty("repair");
    expect(JSON.stringify(error)).not.toMatch(/PrivateProtocolSpecSentinel/u);
  });

  it("maps stored protocol corruption to vault-state recovery", async () => {
    const coreServices = createExplicitHealthCoreServices(async () => ({
      core: {
        async upsertProtocol() {
          throw Object.assign(new Error("private stored protocol detail"), {
            name: "VaultError",
            code: "VAULT_INVALID_PROTOCOL",
            details: {
              validationSource: "stored_vault_state",
              fields: [{
                path: ["effectiveSpecHash"],
                code: "stale_value",
                message: "PrivateStoredValueSentinel",
              }],
            },
          });
        },
      } as never,
    }));

    const error = await coreServices.upsertPrivateProtocol({
      requestId: null,
      vault: "./vault",
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(VaultCliError);
    expect(error).toMatchObject({
      code: "vault_state_invalid",
      context: {
        validationSource: "stored_vault_state",
        vaultCode: "VAULT_INVALID_PROTOCOL",
      },
    });
    expect(error).not.toHaveProperty("repair");
    expect(JSON.stringify(error)).not.toMatch(/PrivateStoredValueSentinel/u);
  });

});
