import { describe, expect, it } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

describe("Health Commons experiment experts", () => {
  it("maps source people without the generic source-person label", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.experts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "",
        name: "Bryan Johnson",
        quote:
          "Blueprint founder whose public sauna routine offers a higher-burden comparison to simpler dry-sauna experiments and highlights aggressive implementation choices.",
      }),
    ]));
  });
});
