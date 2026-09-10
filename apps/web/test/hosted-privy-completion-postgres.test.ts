import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import { PrivyClient, type User } from "@privy-io/node";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as completePrivy } from "@/app/api/hosted-onboarding/privy/complete/route";
import { POST as logout } from "@/app/api/hosted-onboarding/session/logout/route";
import { POST as acceptConsent } from "@/app/api/legal/consent/accept/route";
import { GET as consentStatus } from "@/app/api/legal/consent/status/route";
import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import { createHostedPrivyUserLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";
import { buildCurrentHostedConsentDocumentVersions } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

import { createHostedPrivyTokenFixture } from "./support/hosted-privy-token-fixture";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname)
    || url.searchParams.has("host")
  ) {
    throw new Error("Privy completion proof requires a dedicated loopback murph_test_* database.");
  }
}

const privyCache = globalThis as typeof globalThis & {
  __murphHostedPrivyManagementClient?: PrivyClient | null;
};
const completePath = "/api/hosted-onboarding/privy/complete";
const statusPath = "/api/legal/consent/status";
const acceptPath = "/api/legal/consent/accept";
const logoutPath = "/api/hosted-onboarding/session/logout";

// No Murph owner or SDK is mocked. HTTP terminates in the actual route exports;
// provider responses and local KMS are the only synthetic external boundaries.
// This proves the default-off migration authority, not a production Next build
// or browser acceptance of Secure cookies (owned by the browser journey).
describe.skipIf(!enabled)("Privy completion HTTP and PostgreSQL composition", () => {
  let server: Server;
  let origin: string;
  let issuer: ReturnType<typeof createHostedPrivyTokenFixture>;
  let users: Map<string, User>;
  let providerReads: number;
  let previousManagementClient: PrivyClient | null | undefined;

  beforeEach(async () => {
    issuer = createHostedPrivyTokenFixture();
    users = new Map();
    providerReads = 0;
    previousManagementClient = privyCache.__murphHostedPrivyManagementClient;
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", issuer.appId);
    vi.stubEnv("PRIVY_VERIFICATION_KEY", issuer.publicKeyPem);
    vi.stubEnv("HOSTED_SIGNUP_NOTIFICATION_EMAILS", "");
    configureLocalCrypto();
    setHostedSecureBoxStringTestCodecForTests(null);

    server = createServer((incoming, outgoing) => {
      void (async () => {
        const url = new URL(incoming.url ?? "/", origin);
        if (url.pathname.startsWith("/v1/users/")) {
          providerReads += 1;
          const user = users.get(decodeURIComponent(url.pathname.slice("/v1/users/".length)));
          outgoing.writeHead(user ? 200 : 404, {
            "content-type": "application/json",
            "x-should-retry": "false",
          });
          outgoing.end(JSON.stringify(user ?? { error: "User not found" }));
          return;
        }
        const route = routes.get(`${incoming.method} ${url.pathname}`);
        if (!route) {
          outgoing.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          else if (value !== undefined) headers.set(name, value);
        }
        const body = Buffer.concat(chunks).toString("utf8");
        const response = await route(new Request(url, {
          method: incoming.method,
          headers,
          ...(body ? { body } : {}),
        }));
        outgoing.statusCode = response.status;
        response.headers.forEach((value, name) => {
          if (name !== "set-cookie") outgoing.setHeader(name, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) outgoing.setHeader("set-cookie", cookies);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      })().catch(() => outgoing.writeHead(500).end("HTTP composition failed"));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected loopback HTTP address.");
    origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", origin);
    // Use the actual installed management SDK against the HTTP fixture; preserve
    // its request serialization, parsing and production user-lookup wrapper.
    privyCache.__murphHostedPrivyManagementClient = new PrivyClient({
      apiUrl: origin,
      appId: issuer.appId,
      appSecret: "synthetic-contract-secret",
      maxRetries: 0,
    });
  });

  afterEach(async () => {
    try {
      const lookupKeys = [...users.keys()].map(createHostedPrivyUserLookupKey).filter((key): key is string => Boolean(key));
      await getPrisma().hostedMember.deleteMany({
        where: { identity: { privyUserLookupKey: { in: lookupKeys } } },
      });
    } finally {
      privyCache.__murphHostedPrivyManagementClient = previousManagementClient;
      vi.unstubAllEnvs();
      if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  afterAll(async () => { await getPrisma().$disconnect(); });

  it("creates identity through HTTP, persists consent, reuses the member on replay, and revokes the issued session on logout", async () => {
    const identity = addIdentity();
    const response = await complete(identity.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, launchConsentGranted: false });
    const cookie = requireSessionCookie(response);
    const member = await findIdentity(identity.userId);
    expect(member).not.toBeNull();
    const memberId = member!.memberId;
    expect(member!.privyUserIdEncrypted).not.toContain(identity.userId);
    expect(member!.phoneNumberEncrypted).not.toContain(identity.phoneNumber);
    expect(await getPrisma().hostedUserCryptoEnvelope.count({ where: { userId: memberId } })).toBe(1);
    expect(await getPrisma().hostedWebSession.count({ where: { memberId } })).toBe(1);

    const initial = await request(statusPath, { cookie });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ launchGranted: false });
    for (const scope of ["launch.legal", "launch.health-data"] as const) {
      const accepted = await request(acceptPath, {
        cookie,
        body: { scope, source: "web_onboarding", acceptedDocumentVersions: buildCurrentHostedConsentDocumentVersions(scope) },
      });
      expect(accepted.status).toBe(200);
    }
    const reloaded = await request(statusPath, { cookie });
    expect(await reloaded.json()).toMatchObject({ launchGranted: true });
    expect(await getPrisma().hostedConsentGrant.count({ where: { memberId, status: "granted" } })).toBe(2);

    const replay = await complete(identity.token, cookie);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, launchConsentGranted: true });
    expect((await findIdentity(identity.userId))?.memberId).toBe(memberId);
    expect(await getPrisma().hostedMemberIdentity.count({ where: { privyUserLookupKey: createHostedPrivyUserLookupKey(identity.userId) } })).toBe(1);
    // A completion replay intentionally issues a fresh browser session, while
    // identity and consent remain owned by the existing member.
    expect(await getPrisma().hostedWebSession.count({ where: { memberId } })).toBe(2);
    expect(providerReads).toBe(2);
    const replayCookie = requireSessionCookie(replay);
    const loggedOut = await request(logoutPath, { cookie: replayCookie, body: {} });
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.getSetCookie().some((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(await getPrisma().hostedWebSession.count({ where: { memberId, revokedAt: { not: null }, revokeReason: "logout" } })).toBe(1);
    expect((await request(statusPath, { cookie: replayCookie })).status).toBe(401);
    expect((await request(statusPath)).status).toBe(401);
    expect(await getPrisma().hostedConsentGrant.count({ where: { memberId, status: "granted" } })).toBe(2);
  });

  it("rejects an account switch before member mutation and preserves the original session", async () => {
    const first = addIdentity();
    const second = addIdentity();
    const signedIn = await complete(first.token);
    expect(signedIn.status).toBe(200);
    const cookie = requireSessionCookie(signedIn);
    const readsBefore = providerReads;
    const switched = await complete(second.token, cookie);
    expect(switched.status).toBe(409);
    expect(await switched.json()).toMatchObject({ error: { code: "PRIVY_SESSION_MEMBER_MISMATCH" } });
    expect(providerReads).toBe(readsBefore);
    expect(await findIdentity(second.userId)).toBeNull();
    expect((await request(statusPath, { cookie })).status).toBe(200);
  });

  it("rejects foreign-origin completion before verification, provider access or durable writes", async () => {
    const identity = addIdentity();
    const response = await request(completePath, {
      cookie: `privy-id-token=${identity.token}`,
      origin: "https://foreign.example.test",
      body: { authIntent: { method: "phone" } },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH" } });
    expect(providerReads).toBe(0);
    expect(await findIdentity(identity.userId)).toBeNull();
  });

  it("rejects a signed identity for another app before provider access or durable writes", async () => {
    const identity = addIdentity();
    const response = await complete(issuer.sign({ sub: identity.userId, aud: "different-test-app" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "PRIVY_AUTH_FAILED" } });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(providerReads).toBe(0);
    expect(await findIdentity(identity.userId)).toBeNull();
  });

  it("does not bind an identity or issue a session when the management provider contradicts the signed principal", async () => {
    const identity = addIdentity();
    const user = users.get(identity.userId)!;
    users.set(identity.userId, { ...user, id: "did:privy:different-synthetic-principal" });
    const response = await complete(identity.token);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "PRIVY_USER_LOOKUP_FAILED" } });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(providerReads).toBe(1);
    expect(await findIdentity(identity.userId)).toBeNull();
    expect(await getPrisma().hostedWebSession.count({ where: { privyUserId: identity.userId } })).toBe(0);
  });

  it("fails closed for new Privy issuance after the Better Auth authority is enabled", async () => {
    const identity = addIdentity();
    vi.stubEnv("HOSTED_BETTER_AUTH_ENABLED", "true");
    const response = await complete(identity.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "AUTHORITY_MIGRATED" } });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(providerReads).toBe(0);
    expect(await findIdentity(identity.userId)).toBeNull();
  });

  function addIdentity() {
    const userId = `did:privy:completion-proof-${randomUUID()}`;
    const phoneNumber = `+1555${randomInt(0, 10_000_000).toString().padStart(7, "0")}`;
    const verifiedAt = Math.floor(Date.now() / 1000) - 30;
    users.set(userId, {
      id: userId,
      created_at: verifiedAt - 30,
      has_accepted_terms: false,
      is_guest: false,
      mfa_methods: [],
      linked_accounts: [{ type: "phone", phoneNumber, first_verified_at: verifiedAt, latest_verified_at: verifiedAt, verified_at: verifiedAt }],
    });
    return {
      userId,
      phoneNumber,
      token: issuer.sign({ sub: userId, linked_accounts: JSON.stringify([{ type: "phone", phone_number: phoneNumber, lv: verifiedAt }]) }),
    };
  }

  function findIdentity(userId: string) {
    return getPrisma().hostedMemberIdentity.findUnique({
      where: { privyUserLookupKey: createHostedPrivyUserLookupKey(userId)! },
      select: { memberId: true, phoneNumberEncrypted: true, privyUserIdEncrypted: true },
    });
  }

  function complete(token: string, cookie?: string) {
    return request(completePath, {
      cookie: [`privy-id-token=${token}`, cookie].filter(Boolean).join("; "),
      body: { authIntent: { method: "phone" }, timeZone: "UTC" },
    });
  }

  function request(path: string, input: { body?: unknown; cookie?: string; origin?: string } = {}) {
    return fetch(`${origin}${path}`, {
      method: input.body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        origin: input.origin ?? origin,
        ...(input.cookie ? { cookie: input.cookie } : {}),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  }
});

const routes = new Map<string, (request: Request) => Promise<Response>>([
  [`POST ${completePath}`, completePrivy],
  [`GET ${statusPath}`, consentStatus],
  [`POST ${acceptPath}`, acceptConsent],
  [`POST ${logoutPath}`, logout],
]);

function requireSessionCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("murph-session="));
  if (!cookie) throw new Error("Completion did not issue a hosted session cookie.");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  return cookie.split(";", 1)[0];
}

function configureLocalCrypto(): void {
  const signer = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const recipient = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const values: Record<string, string> = {
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_CRYPTO_LOCAL_KMS: "1",
    HOSTED_CRYPTO_GCP_KMS_API_ROOT: "local://murph-hosted-kms",
    HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: JSON.stringify(signer.privateKey.export({ format: "jwk" })),
    HOSTED_CRYPTO_LOCAL_KMS_WRAP_KEY: randomBytes(32).toString("base64"),
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION: "projects/murph-test/locations/global/keyRings/test/cryptoKeys/sign/cryptoKeyVersions/1",
    HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKey.export({ type: "spki", format: "pem" }).toString(),
    HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME: "projects/murph-test/locations/global/keyRings/test/cryptoKeys/wrap",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:auth-proof",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK: JSON.stringify(recipient.publicKey.export({ format: "jwk" })),
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
