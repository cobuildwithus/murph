import { describe, expect, it } from "vitest";

import {
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
} from "../src/index.ts";

describe("hosted execution bundle helpers", () => {
  it("parses the single bundle payload through the shared wire contract", () => {
    expect(parseHostedExecutionBundlePayload("vault-bytes")).toBe("vault-bytes");
    expect(parseHostedExecutionBundlePayload(null)).toBeNull();
    expect(parseHostedExecutionBundlePayload("")).toBe("");
  });

  it("parses the single bundle ref through the shared wire contract", () => {
    expect(parseHostedExecutionBundleRef({
      hash: "abc",
      key: "bundles/vault/abc",
      size: 12,
      updatedAt: "2026-04-01T00:00:00.000Z",
    })).toEqual({
      hash: "abc",
      key: "bundles/vault/abc",
      size: 12,
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    expect(parseHostedExecutionBundleRef(null)).toBeNull();
  });
});
