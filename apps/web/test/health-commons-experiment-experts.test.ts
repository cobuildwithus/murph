import { describe, expect, it } from "vitest";

import { healthCommonsCatalog } from "@/src/lib/health-commons/catalog";
import {
  readOptionalProfileImageUrl,
  resolveHealthCommonsExperimentProtocol,
} from "@/src/lib/health-commons/experiment-detail";

describe("Health Commons experiment experts", () => {
  it("maps source people without the generic source-person label", () => {
    const protocol = resolveHealthCommonsExperimentProtocol("bryan-johnson-blueprint");

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

  it("rejects protocol-relative profile image urls", () => {
    const bryanJohnson = healthCommonsCatalog.findByKey("source_person:bryan-johnson");

    expect(bryanJohnson).not.toBeNull();
    expect(
      readOptionalProfileImageUrl({
        ...bryanJohnson!,
        profileImageUrl: "//cdn.example.com/avatar.jpg",
      }),
    ).toBeUndefined();
  });
});
