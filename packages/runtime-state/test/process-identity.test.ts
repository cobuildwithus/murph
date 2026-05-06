import { describe, expect, it, vi } from "vitest";

import {
  captureProcessIdentity,
  matchProcessIdentity,
} from "../src/node/index.ts";

describe("runtime-state process identity", () => {
  it("captures Linux proc start tokens without persisting command lines", async () => {
    const identity = await captureProcessIdentity(123, {
      platform: "linux",
      readFile: vi.fn(async () =>
        "123 (node) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654\n"
      ),
    });

    expect(identity).toEqual({
      pid: 123,
      platform: "linux",
      startToken: "linux-proc-start:987654",
    });
  });

  it("captures Darwin ps start tokens without persisting command lines", async () => {
    const identity = await captureProcessIdentity(123, {
      execFile: vi.fn(async () => ({
        stdout: "Wed May  6 16:05:21 2026\n",
      })),
      platform: "darwin",
    });

    expect(identity).toEqual({
      pid: 123,
      platform: "darwin",
      startToken: "darwin-ps-lstart:Wed May 6 16:05:21 2026",
    });
  });

  it("fails closed when the platform has no supported start token", async () => {
    await expect(
      captureProcessIdentity(123, {
        platform: "win32",
      }),
    ).resolves.toEqual(null);
  });

  it("matches only when pid, platform, and start token still match", async () => {
    const expected = {
      pid: 123,
      platform: "linux" as const,
      startToken: "linux-proc-start:111",
    };

    await expect(
      matchProcessIdentity(123, expected, {
        platform: "linux",
        readFile: vi.fn(async () =>
          "123 (node) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 111\n"
        ),
      }),
    ).resolves.toEqual({ matches: true, reason: "matched" });

    await expect(
      matchProcessIdentity(123, expected, {
        platform: "linux",
        readFile: vi.fn(async () =>
          "123 (node) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 222\n"
        ),
      }),
    ).resolves.toEqual({ matches: false, reason: "mismatched" });
  });

  it("fails closed when expected or current identity is unavailable", async () => {
    await expect(matchProcessIdentity(123, null)).resolves.toEqual({
      matches: false,
      reason: "unverifiable",
    });

    await expect(
      matchProcessIdentity(
        123,
        {
          pid: 123,
          platform: "linux",
          startToken: "linux-proc-start:111",
        },
        {
          platform: "linux",
          readFile: vi.fn(async () => {
            throw new Error("proc unavailable");
          }),
        },
      ),
    ).resolves.toEqual({ matches: false, reason: "missing" });
  });
});
