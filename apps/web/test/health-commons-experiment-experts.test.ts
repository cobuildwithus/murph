import { describe, expect, it } from "vitest";
import type { HealthCommonsEntity } from "@murphai/health-commons/runtime";

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
    const bryanJohnson = Object.assign(
      {
        body: "Founder of Blueprint and Don't Die. Trying to live forever.",
        entityType: "source_person",
        key: "source_person:bryan-johnson",
        relativePath: "sources/people/bryan-johnson.md",
        revision: {
          pageRevisionId: `sha256:${"1".repeat(64)}`,
        },
        schemaVersion: "murph.commons.page.v1",
        slug: "sources/people/bryan-johnson",
        summary: "Founder of Blueprint and Don't Die. Trying to live forever.",
        title: "Bryan Johnson",
      } satisfies HealthCommonsEntity,
      {
        profileImageUrl: "//cdn.example.com/avatar.jpg",
      },
    );

    expect(readOptionalProfileImageUrl(bryanJohnson)).toBeUndefined();
  });
});
