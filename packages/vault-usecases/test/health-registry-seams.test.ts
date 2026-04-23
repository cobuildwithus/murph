import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getHealthRegistryCommandMetadata,
  healthEntityDescriptorByKind,
} from "@murphai/vault-usecases";

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
      "protocol",
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

  it("lets the core writer derive a supplement slug unless the caller explicitly supplies one", async () => {
    const upsertCalls: Array<Record<string, unknown>> = [];
    const services = createExplicitHealthCoreServices(async () => ({
      core: {
        async readProtocolItem() {
          return {
            entity: {
              protocolId: "prot_01JSHARED000000000000000010",
              kind: "supplement",
              title: "Old title",
              status: "active",
              startedOn: "2026-03-12",
              stoppedOn: null,
              substance: null,
              dose: null,
              unit: null,
              schedule: null,
              brand: null,
              manufacturer: null,
              servingSize: null,
              ingredients: [],
              relatedGoalIds: [],
              relatedConditionIds: [],
              group: "supplements",
            },
          };
        },
        async upsertProtocolItem(input: Record<string, unknown>) {
          upsertCalls.push(input);

          return {
            record: {
              entity: {
                protocolId: "prot_01JSHARED000000000000000010",
              },
              document: {
                relativePath: "bank/protocols/supplements/magnesium-glycinate.md",
              },
            },
            created: false,
          };
        },
      } as never,
    }));

    await services.renameSupplement({
      lookup: "prot_01JSHARED000000000000000010",
      requestId: null,
      title: "Magnesium Glycinate",
      vault: "./vault",
    });
    await services.renameSupplement({
      lookup: "prot_01JSHARED000000000000000010",
      requestId: null,
      slug: "custom-slug",
      title: "Magnesium Glycinate",
      vault: "./vault",
    });

    expect(upsertCalls).toHaveLength(2);
    expect(Object.hasOwn(upsertCalls[0] ?? {}, "slug")).toBe(false);
    expect(upsertCalls[1]?.slug).toBe("custom-slug");
  });
});
