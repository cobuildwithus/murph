import { describe, expect, it } from "vitest";
import {
  healthCommonsCatalogSchema,
  type HealthCommonsCatalog,
} from "@murphai/contracts";
import healthCommonsCatalogJson from "@murphai/health-commons/generated/catalog.json";

import {
  createHealthCommonsCatalogReader,
} from "@/src/lib/health-commons/catalog";
import {
  listHealthCommonsExperimentProtocols,
  resolveHealthCommonsExperimentProtocol,
} from "@/src/lib/health-commons/experiment-detail";

const SUPPLEMENT_PROTOCOL_FIXTURES = [
  {
    key: "protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides",
    routeId: "hydrolyzed-collagen-peptides",
  },
  {
    key: "protocol_variant:creatine-supplementation/creatine-monohydrate",
    routeId: "creatine-monohydrate",
  },
  {
    key: "protocol_variant:omega-3-supplementation/oral-epa-dha-supplementation",
    routeId: "oral-epa-dha-supplementation",
  },
  {
    key: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol",
    routeId: "psyllium-husk-for-cholesterol",
  },
  {
    key: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol",
    routeId: "red-yeast-rice-for-cholesterol",
  },
  {
    key: "protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation",
    routeId: "daily-vitamin-d3-supplementation",
  },
] as const;

describe("Health Commons experiment protocol metadata", () => {
  it("uses the simplified protocol title", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.title).toBe("Bryan Johnson Sauna");
  });

  it("uses the dedicated Bryan Johnson sauna artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-bryan-johnson-sauna.jpg");
  });

  it("uses the dedicated Finnish sauna artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("finnish-sauna");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-finnish-sauna.jpeg");
  });

  it("uses the dedicated Norwegian 4x4 artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("norwegian-4x4");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-norwegian-4x4.jpeg");
  });

  it("uses the dedicated red-light glasses artwork", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("red-light-glasses-before-bed");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/hero-red-light-glasses-before-bed.jpeg");
  });

  it("omits protocols hidden by Health Commons frontmatter from the public experiments library", () => {
    const catalog = createFixtureCatalog();

    for (const supplementProtocol of SUPPLEMENT_PROTOCOL_FIXTURES) {
      const protocolIndex = catalog.entities.findIndex(
        (entity) => entity.key === supplementProtocol.key,
      );
      const protocol = catalog.entities[protocolIndex];

      expect(protocol?.entityType).toBe("protocol_variant");
      if (!protocol || protocol.entityType !== "protocol_variant") {
        return;
      }

      catalog.entities[protocolIndex] = {
        ...protocol,
        hidden: true,
      };
    }

    const protocols = listHealthCommonsExperimentProtocols(
      createHealthCommonsCatalogReader(catalog),
    );
    const protocolIds = protocols.map((entry) => entry.id);

    for (const supplementProtocol of SUPPLEMENT_PROTOCOL_FIXTURES) {
      expect(protocolIds).not.toContain(supplementProtocol.routeId);
    }
    expect(protocolIds).toContain("bryan-johnson-blueprint");
    expect(
      resolveHealthCommonsExperimentProtocol(
        "hydrolyzed-collagen-peptides",
        createHealthCommonsCatalogReader(catalog),
      )?.title,
    ).toBe("Hydrolyzed Collagen Peptides");
  });

  it("prefers page-owned cold plunge artwork when the protocol declares media", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("cold-plunge");

    expect(protocol).not.toBeNull();
    expect(protocol?.image).toBe("/design-assets/cold-plunge-tub.jpeg");
  });

  it("uses cold plunge signal descriptions from the protocol page", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("cold-plunge");

    expect(protocol).not.toBeNull();
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "Perceived Stress")?.description,
    ).toBe(
      "Cold water first puts the body on high alert: breathing, pulse, and blood pressure rise. The possible benefit comes later, when that stress response settles and you feel calmer.",
    );
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "Mood / Affect")?.description,
    ).toBe(
      "Cold water first gives the body a stress jolt. The mood effect, if it happens, is likely the rebound afterward: less tension and a steadier mood later that day.",
    );
    expect(
      protocol?.expectedSignals.find((signal) => signal.label === "Resting Heart Rate")?.description,
    ).toBe(
      "Repeated cold exposure can blunt the stress response to the plunge. A lower baseline stress response can reduce resting pulse, but only if the body is less taxed between sessions.",
    );
  });

});

function createFixtureCatalog(): HealthCommonsCatalog {
  return structuredClone(healthCommonsCatalogSchema.parse(healthCommonsCatalogJson));
}
