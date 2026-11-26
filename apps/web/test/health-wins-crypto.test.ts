import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openHealthTexts, sealHealthTexts, type HealthSealTarget } from "../src/lib/health-wins/crypto";
import * as secureBox from "../src/lib/hosted-crypto/secure-box";

const first: HealthSealTarget = { memberId: "synthetic-owner", table: "health_post", rowId: "synthetic-post", field: "card:0" };
const second = { ...first, field: "card:1" };

beforeEach(() => {
  // The secure-box owner proves AES-GCM. This codec checks the complete binding passed by this adapter.
  secureBox.setHostedSecureBoxStringTestCodecForTests({
    encrypt({ value, ...binding }) { return JSON.stringify([JSON.stringify(binding), value]); },
    decrypt({ value, ...binding }) {
      const [expected, plaintext] = JSON.parse(value) as [string, string];
      if (expected !== JSON.stringify(binding)) throw new Error("Incorrect binding.");
      return plaintext;
    },
  });
});
afterEach(() => {
  secureBox.setHostedSecureBoxStringTestCodecForTests(null);
  vi.restoreAllMocks();
});

describe("sealed health posts", () => {
  it("seals all fields under one author root and opens a page across owners in a single batch", async () => {
    const seal = vi.spyOn(secureBox, "sealHostedUserSecureBoxStrings");
    const open = vi.spyOn(secureBox, "openHostedUserSecureBoxStrings");
    const other = { ...first, memberId: "synthetic-partner" };
    const [a, b] = await sealHealthTexts([{ ...first, value: "one" }, { ...second, value: "two" }]);
    expect(seal).toHaveBeenCalledTimes(1);
    expect(seal).toHaveBeenCalledWith(expect.objectContaining({
      userId: first.memberId, lane: "hosted-member-private-field",
      entries: expect.arrayContaining([{
        scope: "health-post", value: "one",
        aad: { purpose: "health-post", table: first.table, rowId: first.rowId, field: first.field },
      }]),
    }));
    const [c] = await sealHealthTexts([{ ...other, value: "three" }]);
    expect(await openHealthTexts([{ ...first, value: a }, { ...other, value: c }, { ...second, value: b }]))
      .toEqual(["one", "three", "two"]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each([
    { memberId: "synthetic-other" }, { rowId: "synthetic-other-row" },
    { field: "card:1" }, { table: "health_post_comment" as const },
  ])("rejects content moved to a different binding", async change => {
    const [sealed] = await sealHealthTexts([{ ...first, value: "sample" }]);
    await expect(openHealthTexts([{ ...first, ...change, value: sealed }])).rejects.toThrow();
  });

  it("fails closed on blank ciphertext and rejects mixed owners before sealing", async () => {
    await expect(openHealthTexts([{ ...first, value: "" }])).rejects.toThrow();
    await expect(sealHealthTexts([{ ...first, value: "a" }, { ...second, memberId: "synthetic-other", value: "b" }]))
      .rejects.toThrow("Mixed health content owners");
  });
});
