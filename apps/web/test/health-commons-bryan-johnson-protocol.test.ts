import { describe, expect, it } from "vitest";

import { resolveHealthCommonsExperimentProtocol } from "@/src/lib/health-commons/experiment-detail";

describe("Bryan Johnson sauna protocol", () => {
  it("uses the simplified protocol title", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.title).toBe("Bryan Johnson Sauna");
  });
});
