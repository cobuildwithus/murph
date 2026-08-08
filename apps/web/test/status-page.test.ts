import { describe, expect, it } from "vitest";

import { resolveStatusPageAvailability } from "@/src/lib/status-page";

describe("resolveStatusPageAvailability", () => {
  it("reports online when no incidents or affected components are listed", () => {
    expect(
      resolveStatusPageAvailability({
        summary: { affected_components: [], ongoing_incidents: [] },
      }),
    ).toBe("online");
  });

  it("reports issues while an incident is ongoing", () => {
    expect(
      resolveStatusPageAvailability({
        summary: {
          affected_components: [],
          ongoing_incidents: [{ id: "01H0000000000000000000INC0" }],
        },
      }),
    ).toBe("issues");
  });

  it("reports issues while a component is degraded", () => {
    expect(
      resolveStatusPageAvailability({
        summary: {
          affected_components: [
            { component_id: "01H0000000000000000000CMP0", status: "degraded_performance" },
          ],
          ongoing_incidents: [],
        },
      }),
    ).toBe("issues");
  });

  it("reports unknown for malformed payloads", () => {
    expect(resolveStatusPageAvailability(null)).toBe("unknown");
    expect(resolveStatusPageAvailability("down")).toBe("unknown");
    expect(resolveStatusPageAvailability({})).toBe("unknown");
    expect(resolveStatusPageAvailability({ summary: null })).toBe("unknown");
    expect(resolveStatusPageAvailability({ summary: {} })).toBe("unknown");
    expect(
      resolveStatusPageAvailability({
        summary: { affected_components: [], ongoing_incidents: "none" },
      }),
    ).toBe("unknown");
  });
});
