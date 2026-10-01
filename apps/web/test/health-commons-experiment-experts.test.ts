import { describe, expect, it } from "vitest";

import {
  resolveHealthCommonsExperimentProtocolTab,
} from "@/src/lib/health-commons/experiment-projections";

describe("Health Commons experiment experts", () => {
  it("maps source people without the generic source-person label", () => {
    const protocol = resolveHealthCommonsExperimentProtocolTab("bryan-johnson-blueprint");

    expect(protocol).not.toBeNull();
    expect(protocol?.experts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "",
        name: "Bryan Johnson",
        profileImageUrl: "/source-people/bryan-johnson/twitter-avatar.jpg",
        quote:
          "Founder of Blueprint and Don't Die. Trying to live forever.",
      }),
    ]));
  });

});
