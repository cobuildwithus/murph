import { describe, expect, it } from "vitest";
import { parseHostedRuntimeMediaCommand } from "../src/runtime-media.ts";

const descriptor = { mediaId: "a".repeat(64), sha256: "b".repeat(64),
  mediaKind: "image", byteSize: 4, expiresAt: null };

describe("media read protocol", () => {
  it("retains the legacy read shape for separately authorized older Workers", () => {
    expect(parseHostedRuntimeMediaCommand({ operation: "read", descriptor }))
      .toEqual({ operation: "read", descriptor });
  });

  it("retains exact authority for transactional read admission", () => {
    const command = { operation: "admit_read", descriptor, attemptId: "synthetic-attempt", generation: "7" };
    expect(parseHostedRuntimeMediaCommand(command)).toEqual(command);
  });

  it.each([{}, { attemptId: "synthetic-attempt" }, { generation: "7" },
    { attemptId: "synthetic-attempt", generation: "-1" }])("rejects incomplete or invalid read authority: %j", identity => {
    expect(() => parseHostedRuntimeMediaCommand({ operation: "admit_read", descriptor, ...identity })).toThrow();
  });
});
