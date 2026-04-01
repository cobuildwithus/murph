import { describe, expect, it, vi } from "vitest";

import { encodeHostedBundleBase64 } from "@murph/runtime-state/node";

import {
  describeHostedBase64BundleRef,
  describeHostedBundleBytesRef,
  writeHostedBundleBytesIfChanged,
  type HostedBundleStore,
} from "../src/bundle-store.js";

describe("writeHostedBundleBytesIfChanged", () => {
  it("reuses the current ref when the payload identity is unchanged", async () => {
    const plaintext = Uint8Array.from([1, 2, 3]);
    const currentRef = {
      ...describeHostedBundleBytesRef("vault", plaintext),
      updatedAt: "2026-03-31T00:00:00.000Z",
    };
    const bundleStore: HostedBundleStore = {
      readBundle: vi.fn(async () => null),
      writeBundle: vi.fn(async () => {
        throw new Error("writeBundle should not be called when the bundle payload is unchanged.");
      }),
    };

    const result = await writeHostedBundleBytesIfChanged({
      bundleStore,
      currentRef,
      kind: "vault",
      plaintext,
    });

    expect(result).toBe(currentRef);
    expect(bundleStore.writeBundle).not.toHaveBeenCalled();
  });
});

describe("describeHostedBase64BundleRef", () => {
  it("derives payload identity without manufacturing updatedAt metadata", () => {
    const plaintext = Uint8Array.from([7, 8, 9]);
    const described = describeHostedBase64BundleRef({
      kind: "agent-state",
      value: encodeHostedBundleBase64(plaintext),
    });

    expect(described).not.toBeNull();
    expect(described?.plaintext).toEqual(plaintext);
    expect(described?.ref).toEqual(describeHostedBundleBytesRef("agent-state", plaintext));
    expect(Object.hasOwn(described!.ref, "updatedAt")).toBe(false);
  });
});
