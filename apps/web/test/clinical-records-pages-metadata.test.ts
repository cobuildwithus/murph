import { describe, expect, it } from "vitest";

describe("Clinical Records page metadata", () => {
  it.each([
    {
      description: "Connect a supported patient portal and see which lab results and report summaries Murph copied.",
      load: () => import("../app/(dashboard)/records/page"),
      route: "/records",
    },
    {
      description: "Connect a supported patient portal to copy available lab results and report summaries into Murph.",
      load: () => import("../app/(dashboard)/records/connect/page"),
      route: "/records/connect",
    },
  ])("keeps the supported-portal and record boundaries on $route", async ({ description, load }) => {
    const { metadata } = await load();

    expect(metadata.description).toBe(description);
    expect(metadata.openGraph?.description).toBe(description);
    expect(metadata.twitter?.description).toBe(description);
  });
});
