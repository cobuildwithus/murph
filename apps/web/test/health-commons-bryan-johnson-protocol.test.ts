import { describe, expect, it } from "vitest";

import { healthCommonsCatalog } from "@/src/lib/health-commons/catalog";
import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";
import { resolveProtocolImage } from "@/src/lib/health-commons/experiment-detail-media";

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
      "Repeated cold exposure can train the body to react less sharply to cold. If that stress response gets smaller, resting pulse may drift lower too.",
    );
  });

  it("prefers page-owned media over the route-mapped fallback image", () => {
    const protocol = healthCommonsCatalog.findByKey(
      "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    );

    expect(protocol).not.toBeNull();
    if (!protocol) {
      return;
    }

    const protocolWithPageMedia = {
      ...protocol,
      media: [
        {
          kind: "image",
          relativePath: "/design-assets/hero-boundary-test.jpeg",
          mediaType: "image/jpeg",
        },
      ],
    };

    expect(resolveProtocolImage(protocolWithPageMedia, "finnish-sauna")).toBe(
      "/design-assets/hero-boundary-test.jpeg",
    );
  });
});
