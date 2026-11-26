import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as feed } from "../app/api/game/v1/health/feed/route";
import { serializeHostedNativeSessionToken } from "../src/lib/better-auth/transport";
import { sealHealthTexts } from "../src/lib/health-wins/crypto";
import * as cursor from "../src/lib/health-wins/cursor";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "../src/lib/hosted-crypto/domain-root-store";
import { getHostedDomainRootUnwrapCache } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import * as cryptoConfig from "../src/lib/hosted-crypto/env";
import { setHostedSecureBoxStringTestCodecForTests } from "../src/lib/hosted-crypto/secure-box";
import { recordHostedLaunchRequiredConsent } from "../src/lib/legal/consent";
import { getPrisma } from "../src/lib/prisma";
import { issueHostedAppSession } from "./support/hosted-auth-session";
import { localRosterCrypto } from "./support/roster-postgres";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Health route authentication proofs require an isolated loopback test database.");
}

describe.skipIf(!enabled)("Health feed native authentication with encrypted records", () => {
  const db = getPrisma();
  let memberId: string;

  beforeEach(async () => {
    memberId = randomUUID();
    localRosterCrypto();
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://fixture.example.test");
    vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 57).toString("base64url"));
    vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 58).toString("base64url"));
    vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", memberId);
    setHostedSecureBoxStringTestCodecForTests(null);
    // Keep the test provider instance stable so every real unwrap is counted.
    const config = cryptoConfig.getHostedWebCryptoConfig();
    vi.spyOn(cryptoConfig, "getHostedWebCryptoConfig").mockReturnValue(config);
    await db.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
  });
  afterEach(async () => {
    await db.hostedMember.deleteMany({ where: { id: memberId } });
    vi.unstubAllEnvs();
  });

  function provisionRoot() {
    return provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain: "control", userId: memberId, prisma: db });
  }

  async function seedPage() {
    const root = await provisionRoot();
    const { sessionId, token } = await issueHostedAppSession({ memberId });
    for (const scope of ["launch.legal", "launch.health-data"] as const) {
      await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: db });
    }
    const ids = Array.from({ length: 21 }, () => randomUUID());
    const captions = await sealHealthTexts(ids.map(id => ({
      memberId, table: "health_post", rowId: id, field: "caption", value: "Synthetic entry",
    })));
    await db.healthPost.createMany({ data: ids.map((id, i) => ({ id, authorMemberId: memberId, captionEncrypted: captions[i] })) });
    return { rootKeyId: root.rootKeyId, sessionId, token };
  }

  async function fetchPage(token: string, afterSeal?: () => Promise<unknown>) {
    const seal = cursor.sealHealthCursor;
    let cache: ReturnType<typeof getHostedDomainRootUnwrapCache>;
    let masters: Uint8Array[] = [];
    const sealing = vi.spyOn(cursor, "sealHealthCursor").mockImplementationOnce(async (...args) => {
      const result = await seal(...args);
      cache = getHostedDomainRootUnwrapCache();
      if (cache) masters = (await Promise.all(cache.values())).map(entry => entry.rootKey);
      await afterSeal?.();
      return result;
    });
    try {
      const request = new Request("https://fixture.example.test/api/game/v1/health/feed", {
        headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}` },
      });
      const response = await feed(request);
      expect(sealing).toHaveBeenCalledOnce();
      expect(masters.length).toBeGreaterThan(0);
      expect(masters.every(key => key.every(byte => byte === 0))).toBe(true);
      expect(cache?.size).toBe(0);
      expect(getHostedDomainRootUnwrapCache()).toBeUndefined();
      return response;
    } finally {
      sealing.mockRestore();
    }
  }

  it("unwraps each exact control root once across authentication, captions and cursor sealing", async () => {
    const { rootKeyId, token } = await seedPage();
    const decrypt = vi.spyOn(cryptoConfig.getHostedWebCryptoConfig().gcpKms, "decrypt");
    const rootIds = () => decrypt.mock.calls.map(([input]) => JSON.parse(input.additionalAuthenticatedData).rootKeyId);
    const first = await fetchPage(token);
    expect(first.status).toBe(200);
    const page = await first.json();
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.posts).toHaveLength(20);
    expect(page.posts[0].caption).toBe("Synthetic entry");
    expect(rootIds()).toEqual([rootKeyId]);

    // Session, user and posts still reference the old decrypt-only root. The next cursor uses the active one.
    await db.hostedUserCryptoEnvelope.updateMany({ where: { userId: memberId, domain: "control", rootKeyId }, data: { status: "decrypt_only" } });
    const next = await provisionRoot();
    decrypt.mockClear();
    const rotated = await fetchPage(token);
    expect(rotated.status).toBe(200);
    expect(await rotated.json()).toMatchObject({ nextCursor: expect.any(String) });
    expect(rootIds()).toEqual([rootKeyId, next.rootKeyId]);
    expect(next.rootKeyId).not.toBe(rootKeyId);
  });

  it.each([
    ["revocation", 401, "UNAUTHENTICATED"],
    ["suspension", 403, "HOSTED_MEMBER_SUSPENDED"],
  ] as const)("rejects %s after the page opens under the authenticated root", async (change, status, code) => {
    const { token, sessionId } = await seedPage();
    const decrypt = vi.spyOn(cryptoConfig.getHostedWebCryptoConfig().gcpKms, "decrypt");
    const response = await fetchPage(token, () => change === "revocation"
      ? db.hostedAuthRecord.delete({ where: { model_id: { model: "session", id: sessionId } } })
      : db.hostedMember.update({ where: { id: memberId }, data: { suspendedAt: new Date() } }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(decrypt).toHaveBeenCalledTimes(1);
  });
});
