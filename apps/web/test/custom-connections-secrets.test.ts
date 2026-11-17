import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { setHostedSecureBoxStringTestCodecForTests } from "../src/lib/hosted-crypto/secure-box";
import { openActionSecret, openConnectionSecret, sealActionSecret, sealConnectionSecret } from "../src/lib/custom-connections/secrets";

const key = randomBytes(32);
beforeEach(() => setHostedSecureBoxStringTestCodecForTests({
  encrypt({ value, ...binding }) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(createHash("sha256").update(JSON.stringify(binding)).digest());
    const bytes = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString("base64");
  },
  decrypt({ value, ...binding }) {
    const bytes = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAAD(createHash("sha256").update(JSON.stringify(binding)).digest());
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString();
  },
}));
afterEach(() => setHostedSecureBoxStringTestCodecForTests(null));
it("binds the secure-box call to member, connection, generation and field", async () => {
  const sealed = await sealConnectionSecret("member-a", "cc_a", 1, "credentials", { access_token: "synthetic-access" });
  expect(sealed).not.toContain("synthetic-access");
  expect(await openConnectionSecret("member-a", "cc_a", 1, "credentials", sealed)).toEqual({ access_token: "synthetic-access" });
  for (const [member, id, generation, field] of [
    ["member-b", "cc_a", 1, "credentials"], ["member-a", "cc_b", 1, "credentials"],
    ["member-a", "cc_a", 2, "credentials"], ["member-a", "cc_a", 1, "pending"],
  ] as const) await expect(openConnectionSecret(member, id, generation, field, sealed)).rejects.toThrow();
});
it("binds an action request's inputs and result to that request, field and member", async () => {
  const first = await sealActionSecret("member-a", "car_a", "arguments", { text: "Try the lentil soup" });
  const second = await sealActionSecret("member-a", "car_b", "arguments", { text: "Buy basil" });
  expect(first).not.toContain("lentil");
  expect(await openActionSecret("member-a", "car_a", "arguments", first)).toEqual({ text: "Try the lentil soup" });
  // Swapping ciphertext between two requests, or between a request's two fields, never opens.
  await expect(openActionSecret("member-a", "car_b", "arguments", first)).rejects.toThrow();
  await expect(openActionSecret("member-a", "car_a", "arguments", second)).rejects.toThrow();
  await expect(openActionSecret("member-a", "car_a", "result", first)).rejects.toThrow();
  await expect(openActionSecret("member-b", "car_a", "arguments", first)).rejects.toThrow();
  // Nor does a connection secret open as an action's, or the other way round.
  await expect(openConnectionSecret("member-a", "car_a", 1, "arguments", first)).rejects.toThrow();
  const credentials = await sealConnectionSecret("member-a", "cc_a", 1, "credentials", { access_token: "synthetic-access" });
  await expect(openActionSecret("member-a", "cc_a", "result", credentials)).rejects.toThrow();
});
