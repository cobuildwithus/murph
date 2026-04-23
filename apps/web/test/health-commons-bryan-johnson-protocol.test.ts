import { describe, expect, it } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

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
});
