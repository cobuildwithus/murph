import { generateKeyPairSync, sign } from "node:crypto";

import type { Prisma } from "@prisma/client";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  getHostedDomainRootEnvelopeBody,
  type HostedCryptoDomain,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  HostedDomainRootPreparationMismatchError,
  prepareHostedCryptoDomainRootCandidates,
  prepareHostedDomainRootForWeb,
  readPreparedHostedDomainRootForWebLocal,
  revalidatePreparedHostedDomainRootForWebTx,
  unwrapHostedDomainRootForWeb,
  unwrapHostedDomainRootForWebByRootKeyId,
  unwrapHostedDomainRootsForWebByRootKeyIds,
} from "../src/lib/hosted-crypto/domain-root-store";
import {
  cacheHostedIngressRootKey,
  HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES,
  HOSTED_INGRESS_ROOT_CACHE_TTL_MS,
  readCachedHostedIngressRootKey,
  runWithFreshHostedDomainRootUnwrapCache,
  runWithHostedDomainRootProviderCallsDisabled,
} from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import type { GcpKmsDecryptInput, HostedGcpKmsClient } from "../src/lib/hosted-crypto/gcp-kms";
import {
  openHostedUserSecureBoxStringFromPreparedRoot,
  sealHostedUserSecureBoxStringFromPreparedRoot,
  setHostedSecureBoxStringTestCodecForTests,
} from "../src/lib/hosted-crypto/secure-box";

const provider = vi.hoisted(() => ({ client: null as HostedGcpKmsClient | null }));
vi.mock("../src/lib/hosted-crypto/gcp-kms", () => ({
  createHostedGcpKmsClientFromEnv: () => {
    if (!provider.client) throw new Error("Synthetic KMS is not configured.");
    return provider.client;
  },
}));
vi.mock("../src/lib/prisma", () => ({
  getPrisma: () => { throw new Error("A synthetic database must be supplied."); },
}));

const SIGN_KEY = "projects/test/locations/global/keyRings/test/cryptoKeys/sign/cryptoKeyVersions/1";
const NEXT_SIGN_KEY = "projects/test/locations/global/keyRings/test/cryptoKeys/sign/cryptoKeyVersions/2";
const WRAP_KEY = "projects/test/locations/global/keyRings/test/cryptoKeys/wrap";
const USER = "member-ingress-cache-test";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  setHostedSecureBoxStringTestCodecForTests(null);
});
afterEach(() => {
  // Exercise idle expiry, rather than clearing timers while leaving resident keys.
  vi.advanceTimersByTime(HOSTED_INGRESS_ROOT_CACHE_TTL_MS);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  provider.client = null;
});

test("two independent prepared requests seal/open real ciphertext with one KMS unwrap", async () => {
  const fixture = createFixture();
  await fixture.addRoot();
  const masters: Uint8Array[] = [];
  let ciphertext: string | null = null;
  const box = {
    aad: { purpose: "synthetic-ingress-cache", rowId: "synthetic-message" },
    lane: "mailbox-payload" as const,
    scope: "synthetic-mailbox",
    userId: USER,
  };
  for (let request = 0; request < 2; request += 1) {
    await runWithFreshHostedDomainRootUnwrapCache(async () => {
      const prepared = await prepareHostedDomainRootForWeb({
        domain: "ingress", prisma: fixture.prisma, reason: "test.ingress-cache", userId: USER,
      });
      const local = readPreparedHostedDomainRootForWebLocal(prepared);
      masters.push((await local.root).rootKey);
      const caller = await unwrapHostedDomainRootForWeb({
        domain: "ingress", prisma: fixture.prisma, userId: USER,
      });
      expect(caller.rootKey).not.toBe(masters[request]);
      expect(caller.rootKey).toEqual(masters[request]);
      caller.rootKey.fill(0);
      expect(masters[request]?.some((byte) => byte !== 0)).toBe(true);
      await fixture.transaction(async () => {
        await revalidatePreparedHostedDomainRootForWebTx({ prepared, tx: fixture.prisma });
        if (request === 0) {
          ciphertext = await sealHostedUserSecureBoxStringFromPreparedRoot({
            ...box, preparedRoot: local.root, preparedRootKeyId: local.rootKeyId,
            value: "synthetic durable message",
          });
        } else {
          await expect(openHostedUserSecureBoxStringFromPreparedRoot({
            ...box, preparedRootKeyId: local.rootKeyId, value: ciphertext,
          })).resolves.toBe("synthetic durable message");
        }
      });
    });
    expect(masters[request]).toEqual(new Uint8Array(32));
  }
  expect(masters[0]).not.toBe(masters[1]);
  expect(fixture.decrypt).toHaveBeenCalledTimes(1); // Provider calls, not simulated latency.
  // addRoot discovery, then fresh metadata + locked authority per request.
  expect(fixture.query).toHaveBeenCalledTimes(5);
  expect(fixture.lock).toHaveBeenCalledTimes(2);
});

test("fixed TTL expires even after a warm hit; the next request unwraps again", async () => {
  const fixture = createFixture();
  await fixture.addRoot();
  await fixture.unwrap();
  vi.advanceTimersByTime(HOSTED_INGRESS_ROOT_CACHE_TTL_MS - 1);
  await fixture.unwrap();
  expect(fixture.decrypt).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  await fixture.unwrap();
  expect(fixture.decrypt).toHaveBeenCalledTimes(2);
});

test("capacity bounds real root-store reuse and evicts the oldest successful unwrap", async () => {
  const fixture = createFixture();
  for (let index = 0; index <= HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES; index += 1) {
    const userId = `member-cache-capacity-${index}`;
    await fixture.addRoot("ingress", userId);
    await fixture.unwrap("ingress", userId);
  }
  expect(vi.getTimerCount()).toBe(HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES);
  await fixture.unwrap("ingress", "member-cache-capacity-1");
  expect(fixture.decrypt).toHaveBeenCalledTimes(HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES + 1);
  await fixture.unwrap("ingress", "member-cache-capacity-0");
  expect(fixture.decrypt).toHaveBeenCalledTimes(HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES + 2);
});

test("cache copies are independent and zeroized on capacity eviction and idle expiry", () => {
  const kmsClient = {};
  const source = Buffer.alloc(32, 7);
  const copies = vi.spyOn(Uint8Array, "from");
  cacheHostedIngressRootKey({ identity: "synthetic-first", kmsClient, rootKey: source });
  const owned = copies.mock.results[0];
  if (owned?.type !== "return") throw new Error("Expected a cache-owned copy.");
  expect(owned.value).not.toBe(source);
  source.fill(0);
  const caller = readCachedHostedIngressRootKey({ identity: "synthetic-first", kmsClient });
  expect(caller).toEqual(new Uint8Array(32).fill(7));
  caller?.fill(0);
  expect(owned.value).toEqual(new Uint8Array(32).fill(7));
  for (let index = 0; index < HOSTED_INGRESS_ROOT_CACHE_MAX_ENTRIES; index += 1) {
    cacheHostedIngressRootKey({ identity: `synthetic-fill-${index}`, kmsClient, rootKey: source });
  }
  expect(owned.value).toEqual(new Uint8Array(32));
  expect(readCachedHostedIngressRootKey({ identity: "synthetic-first", kmsClient })).toBeUndefined();
  // Record a nonzero owned buffer, then let the timer erase it without a read.
  source.fill(9);
  copies.mockClear();
  cacheHostedIngressRootKey({ identity: "synthetic-expiry", kmsClient, rootKey: source });
  const expiring = copies.mock.results[0];
  if (expiring?.type !== "return") throw new Error("Expected an expiring copy.");
  expect(expiring.value).toEqual(new Uint8Array(32).fill(9));
  vi.advanceTimersByTime(HOSTED_INGRESS_ROOT_CACHE_TTL_MS);
  expect(expiring.value).toEqual(new Uint8Array(32));
  expect(vi.getTimerCount()).toBe(0);
});

test("deadline reads fail closed if an expiry timer has not run, without extending retention", () => {
  const identity = "synthetic-delayed-timer";
  const kmsClient = {};
  const copies = vi.spyOn(Uint8Array, "from");
  cacheHostedIngressRootKey({ identity, kmsClient, rootKey: new Uint8Array(32).fill(3) });
  const owned = copies.mock.results[0];
  if (owned?.type !== "return") throw new Error("Expected a cache-owned copy.");
  const deadline = performance.now() + HOSTED_INGRESS_ROOT_CACHE_TTL_MS;
  vi.spyOn(performance, "now").mockReturnValue(deadline);
  expect(readCachedHostedIngressRootKey({ identity, kmsClient })).toBeUndefined();
  expect(owned.value).toEqual(new Uint8Array(32));
  expect(vi.getTimerCount()).toBe(0);
});

test("fresh status controls historical decryptability; a warm key cannot revive a revoked or deleted row", async () => {
  const fixture = createFixture();
  const row = await fixture.addRoot();
  await fixture.unwrap();
  row.status = "decrypt_only";
  await expect(fixture.unwrap()).rejects.toThrow("not available for decrypt");
  await fixture.unwrapReference(row);
  row.status = "revoked";
  await expect(fixture.unwrapReference(row)).rejects.toThrow("not available for decrypt");
  await expect(runWithFreshHostedDomainRootUnwrapCache(() =>
    unwrapHostedDomainRootsForWebByRootKeyIds({ prisma: fixture.prisma, references: [row] })
  )).rejects.toThrow("not available for decrypt");
  fixture.rows.length = 0;
  await expect(fixture.unwrapReference(row)).rejects.toThrow("not available for decrypt");
  expect(fixture.decrypt).toHaveBeenCalledTimes(1);
});

test("a warm preparation still locks and rejects root rotation, then retries outside the transaction", async () => {
  const fixture = createFixture();
  const old = await fixture.addRoot();
  await fixture.unwrap();
  await runWithFreshHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareHostedDomainRootForWeb({
      domain: "ingress", prisma: fixture.prisma, reason: "test.rotation", userId: USER,
    });
    old.status = "decrypt_only";
    await fixture.addRoot();
    await expect(fixture.transaction(() =>
      revalidatePreparedHostedDomainRootForWebTx({ prepared, tx: fixture.prisma })
    )).rejects.toBeInstanceOf(HostedDomainRootPreparationMismatchError);
    expect(fixture.decrypt).toHaveBeenCalledTimes(1);
  });
  await fixture.unwrap();
  await fixture.unwrapReference(old);
  expect(fixture.decrypt).toHaveBeenCalledTimes(2);
  expect(fixture.lock).toHaveBeenCalledTimes(1);
});

test("revocation after warm preparation still fails locked revalidation without KMS", async () => {
  const fixture = createFixture();
  const row = await fixture.addRoot();
  await fixture.unwrap();
  await runWithFreshHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareHostedDomainRootForWeb({
      domain: "ingress", prisma: fixture.prisma, reason: "test.revocation", userId: USER,
    });
    row.status = "revoked";
    await expect(fixture.transaction(() =>
      revalidatePreparedHostedDomainRootForWebTx({ prepared, tx: fixture.prisma })
    )).rejects.toThrow("candidate is required");
  });
  expect(fixture.decrypt).toHaveBeenCalledTimes(1);
});

test("a process hit cannot substitute for a prepared transaction entry, even without a request scope", async () => {
  const fixture = createFixture();
  await fixture.addRoot();
  await fixture.unwrap();
  fixture.query.mockClear();
  const unprepared = () => unwrapHostedDomainRootForWeb({
    domain: "ingress", prisma: fixture.prisma, userId: USER,
  });
  await expect(runWithFreshHostedDomainRootUnwrapCache(() =>
    fixture.transaction(unprepared)
  )).rejects.toBeInstanceOf(HostedDomainRootPreparationMismatchError);
  await expect(fixture.transaction(unprepared)).rejects.toBeInstanceOf(HostedDomainRootPreparationMismatchError);
  expect(fixture.query).not.toHaveBeenCalled();
  expect(fixture.decrypt).toHaveBeenCalledTimes(1);
});

test("member/root identity stays isolated and non-ingress domains remain request-local", async () => {
  const fixture = createFixture();
  const first = await fixture.addRoot();
  const other = await fixture.addRoot("ingress", "member-cache-other");
  await fixture.unwrap();
  await fixture.unwrap("ingress", other.userId);
  await expect(fixture.unwrapReference({ ...first, userId: other.userId })).rejects.toThrow();
  for (const domain of ["control", "device"] as const) {
    await fixture.addRoot(domain);
    await fixture.unwrap(domain);
    await fixture.unwrap(domain);
  }
  await expect(fixture.unwrap("runtime")).rejects.toThrow("not allowed");
  expect(fixture.decrypt).toHaveBeenCalledTimes(6);
});

test("changed signed generation, wraps, and signature never reuse the old immutable envelope entry", async () => {
  const fixture = createFixture();
  const row = await fixture.addRoot();
  await fixture.unwrap();
  row.signedEnvelopeJson.generation += 1;
  fixture.resign(row);
  await fixture.unwrap();
  const wrap = row.signedEnvelopeJson.wraps.find((entry) => entry.kind === "gcp-kms");
  if (!wrap || wrap.kind !== "gcp-kms") throw new Error("Missing test KMS wrap.");
  // An independently wrapped root, with the same row/root identity and valid signature.
  const changed = await fixture.kms.encrypt({
    additionalAuthenticatedData: wrap.additionalAuthenticatedData,
    keyName: wrap.kmsKeyName,
    plaintext: new Uint8Array(32).fill(11),
  });
  wrap.ciphertextBlob = changed.ciphertext;
  fixture.resign(row);
  await fixture.unwrap();
  // Signature metadata is also part of identity; change it deterministically.
  row.signedEnvelopeJson.authoritySignature.signedAt = new Date(
    Date.parse(row.signedEnvelopeJson.authoritySignature.signedAt) + 1,
  ).toISOString();
  fixture.resign(row);
  await fixture.unwrap();
  expect(fixture.decrypt).toHaveBeenCalledTimes(4);
});

test.each(["signature", "missing-wrap", "aad", "context", "row-user", "row-root"] as const)(
  "warm ingress rejects invalid envelope %s before provider reuse",
  async (change) => {
    const fixture = createFixture();
    const row = await fixture.addRoot();
    await fixture.unwrap();
    const wrap = row.signedEnvelopeJson.wraps.find((entry) => entry.kind === "gcp-kms");
    if (!wrap || wrap.kind !== "gcp-kms") throw new Error("Missing test KMS wrap.");
    switch (change) {
      case "signature": row.signedEnvelopeJson.authoritySignature.signature = "invalid"; break;
      case "missing-wrap": row.signedEnvelopeJson.wraps = []; fixture.resign(row); break;
      case "aad": wrap.additionalAuthenticatedData = "wrong"; fixture.resign(row); break;
      case "context": wrap.encryptionContext.userId = "member-wrong"; fixture.resign(row); break;
      case "row-user": row.signedEnvelopeJson.userId = "member-wrong"; fixture.resign(row); break;
      case "row-root": row.signedEnvelopeJson.rootKeyId = "udrk:ingress:wrong"; fixture.resign(row); break;
    }
    await expect(fixture.unwrap()).rejects.toThrow();
    expect(fixture.decrypt).toHaveBeenCalledTimes(1);
  },
);

test.each(["environment", "wrap-key", "public-key", "missing-config", "disabled-signer", "removed-signer"] as const)(
  "warm ingress still fails closed after %s changes",
  async (change) => {
    const fixture = createFixture();
    await fixture.addRoot();
    await fixture.unwrap();
    switch (change) {
      case "environment": vi.stubEnv("HOSTED_CRYPTO_ENV", "different"); break;
      case "wrap-key": vi.stubEnv("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME", `${WRAP_KEY}-different`); break;
      case "public-key": vi.stubEnv("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM", createSigner().publicKeyPem); break;
      case "missing-config": vi.stubEnv("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME", ""); break;
      case "disabled-signer":
      case "removed-signer":
        vi.stubEnv("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION", NEXT_SIGN_KEY);
        if (change === "disabled-signer") vi.stubEnv("HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON", JSON.stringify({
          [SIGN_KEY]: { publicKeyPem: fixture.signer.publicKeyPem, status: "disabled" },
        }));
        break;
    }
    await expect(fixture.unwrap()).rejects.toThrow();
    expect(fixture.decrypt).toHaveBeenCalledTimes(1);
  },
);

test("reader-first signer rotation and a changed provider client force fresh unwraps", async () => {
  const fixture = createFixture();
  const row = await fixture.addRoot();
  await fixture.unwrap();
  vi.stubEnv("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION", NEXT_SIGN_KEY);
  vi.stubEnv("HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON", JSON.stringify({
    [SIGN_KEY]: { publicKeyPem: fixture.signer.publicKeyPem, status: "verify_only" },
  }));
  await fixture.unwrap();
  fixture.resign(row, NEXT_SIGN_KEY);
  await fixture.unwrap();
  provider.client = { ...fixture.kms };
  await fixture.unwrap();
  expect(fixture.decrypt).toHaveBeenCalledTimes(4);
});

test.each(["provider-failure", "invalid-length"] as const)("%s cannot poison the next request", async (failure) => {
  const fixture = createFixture();
  await fixture.addRoot();
  const invalid = new Uint8Array(31).fill(7);
  if (failure === "provider-failure") fixture.decrypt.mockRejectedValueOnce(new Error("Synthetic KMS failure."));
  else fixture.decrypt.mockResolvedValueOnce({ plaintext: invalid });
  await expect(fixture.unwrap()).rejects.toThrow();
  if (failure === "invalid-length") expect(invalid).toEqual(new Uint8Array(31));
  await fixture.unwrap();
  expect(fixture.decrypt).toHaveBeenCalledTimes(2);
});

test("already-aborted warm requests reject without evicting another request's valid key", async () => {
  const fixture = createFixture();
  await fixture.addRoot();
  await fixture.unwrap();
  const abort = new AbortController();
  abort.abort();
  await expect(fixture.unwrap("ingress", USER, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
  await fixture.unwrap();
  expect(fixture.decrypt).toHaveBeenCalledTimes(1);
});

test("concurrent cold scopes do not share cancellation or publish an aborted late completion", async () => {
  const fixture = createFixture();
  await fixture.addRoot();
  const started = deferred<void>();
  const release = deferred<void>();
  const latePlaintext = new Uint8Array(32).fill(19);
  fixture.decrypt.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    // Deliberately model an adapter returning bytes just after caller cancellation.
    return { plaintext: latePlaintext };
  });
  const abort = new AbortController();
  const first = fixture.unwrap("ingress", USER, abort.signal);
  const rejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  await started.promise;
  // Must complete independently, not join the first promise. Keep a caller-owned
  // copy to prove the aborted late key cannot replace this successful key.
  const successful = await runWithFreshHostedDomainRootUnwrapCache(() =>
    unwrapHostedDomainRootForWeb({ domain: "ingress", prisma: fixture.prisma, userId: USER })
  );
  abort.abort();
  release.resolve();
  await rejected;
  expect(latePlaintext).toEqual(new Uint8Array(32));
  const later = await runWithFreshHostedDomainRootUnwrapCache(() =>
    unwrapHostedDomainRootForWeb({ domain: "ingress", prisma: fixture.prisma, userId: USER })
  );
  try { expect(later.rootKey).toEqual(successful.rootKey); }
  finally { later.rootKey.fill(0); successful.rootKey.fill(0); }
  expect(fixture.decrypt).toHaveBeenCalledTimes(2);
});

interface EnvelopeRow {
  domain: HostedCryptoDomain;
  id: string;
  rootKeyId: string;
  signedEnvelopeJson: HostedDomainRootKeyEnvelopeV1;
  status: "active" | "decrypt_only" | "revoked";
  updatedAt: Date;
  userId: string;
}

function createFixture() {
  const signer = createSigner();
  const recipient = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  vi.stubEnv("HOSTED_CRYPTO_ENV", "test");
  vi.stubEnv("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_KEY_VERSION", SIGN_KEY);
  vi.stubEnv("HOSTED_CRYPTO_GCP_AUTHORITY_SIGN_PUBLIC_KEY_PEM", signer.publicKeyPem);
  vi.stubEnv("HOSTED_CRYPTO_GCP_WEB_WRAP_KEY_NAME", WRAP_KEY);
  vi.stubEnv("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID", "synthetic-automation");
  vi.stubEnv("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_JWK", JSON.stringify(recipient.publicKey.export({ format: "jwk" })));
  for (const key of [
    "HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON",
    "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PUBLIC_KEYRING_JSON",
    "HOSTED_CRYPTO_RECOVERY_KEY_ID",
    "HOSTED_CRYPTO_RECOVERY_PUBLIC_JWK",
    "HOSTED_CRYPTO_TEE_RUNTIME_KEY_ID",
    "HOSTED_CRYPTO_TEE_RUNTIME_PUBLIC_JWK",
    "HOSTED_CRYPTO_TEE_RUNTIME_POLICY_ID",
  ]) vi.stubEnv(key, "");
  const rows: EnvelopeRow[] = [];
  const wrapped = new Map<string, Uint8Array>();
  let inTransaction = false;
  const decrypt = vi.fn(async (input: GcpKmsDecryptInput) => {
    expect(inTransaction).toBe(false);
    input.signal?.throwIfAborted();
    const rootKey = wrapped.get(input.ciphertext);
    if (!rootKey) throw new Error("Unknown synthetic ciphertext.");
    return { plaintext: Uint8Array.from(rootKey) };
  });
  const kms: HostedGcpKmsClient = {
    decrypt,
    asymmetricSign: async (input) => ({
      keyVersionName: input.keyVersionName, signature: signer.signature(input.message),
    }),
    encrypt: async (input) => {
      expect(inTransaction).toBe(false);
      const ciphertext = `synthetic-wrap-${wrapped.size}`;
      wrapped.set(ciphertext, Uint8Array.from(input.plaintext));
      return { ciphertext, keyName: input.keyName };
    },
    macSign: async () => { throw new Error("Unexpected MAC call."); },
  };
  provider.client = kms;
  const query = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (!sql.includes("FROM hosted_user_crypto_envelope")) throw new Error("Unexpected SQL read.");
    const [userId, domain, rootKeyId] = values;
    return rows.filter((row) => row.userId === userId
      && (Array.isArray(domain) ? domain.includes(row.domain) : row.domain === domain)
      && (sql.includes("status IN") ? row.status !== "revoked" : row.status === "active")
      && (rootKeyId === undefined || sql.includes("domain = ANY(") || row.rootKeyId === rootKeyId));
  });
  const lock = vi.fn(async (strings: TemplateStringsArray) => {
    expect(inTransaction).toBe(true);
    if (!strings.join("?").includes("pg_advisory_xact_lock")) throw new Error("Unexpected SQL write.");
    return 1;
  });
  // Narrow database boundary double: real preparation, status-filter SQL,
  // envelope parsing/signatures, wrap checks and encryption all remain wired.
  const prisma = {
    $queryRaw: query,
    $executeRaw: lock,
    hostedUserCryptoEnvelope: {
      findMany: async (input: { where: { OR: Array<{ userId: string; domain: string; rootKeyId: string }> } }) =>
        rows.filter((row) => row.status !== "revoked" && input.where.OR.some((reference) =>
          reference.userId === row.userId && reference.domain === row.domain && reference.rootKeyId === row.rootKeyId)),
    },
  } as unknown as Prisma.TransactionClient;
  return {
    decrypt, kms, lock, prisma, query, rows, signer,
    async addRoot(domain: HostedCryptoDomain = "ingress", userId = USER) {
      const candidates = await prepareHostedCryptoDomainRootCandidates({ domains: [domain], prisma, userId });
      const envelope = candidates.get(domain);
      if (!envelope) throw new Error("Expected a newly prepared test root.");
      const row: EnvelopeRow = {
        domain, id: `synthetic-row-${rows.length}`, rootKeyId: envelope.rootKeyId,
        signedEnvelopeJson: envelope, status: "active", updatedAt: new Date(envelope.updatedAt), userId,
      };
      rows.push(row);
      return row;
    },
    resign(row: EnvelopeRow, keyVersionName = SIGN_KEY) {
      const body = getHostedDomainRootEnvelopeBody(row.signedEnvelopeJson);
      row.signedEnvelopeJson = attachHostedDomainRootEnvelopeSignature({
        body, keyVersionName, signature: signer.signature(buildHostedDomainRootEnvelopeSigningPayload(body)),
        signedAt: row.signedEnvelopeJson.authoritySignature.signedAt,
      });
    },
    async unwrap(domain: HostedCryptoDomain = "ingress", userId = USER, signal?: AbortSignal) {
      await runWithFreshHostedDomainRootUnwrapCache(async () => {
        const root = await unwrapHostedDomainRootForWeb({ domain, prisma, signal, userId });
        try { expect(root.rootKey.some((byte) => byte !== 0)).toBe(true); }
        finally { root.rootKey.fill(0); }
      });
    },
    async unwrapReference(row: Pick<EnvelopeRow, "domain" | "userId" | "rootKeyId">) {
      await runWithFreshHostedDomainRootUnwrapCache(async () => {
        const root = await unwrapHostedDomainRootForWebByRootKeyId({ ...row, prisma });
        root.rootKey.fill(0);
      });
    },
    async transaction<T>(run: () => Promise<T>): Promise<T> {
      inTransaction = true;
      try { return await runWithHostedDomainRootProviderCallsDisabled(run); }
      finally { inTransaction = false; }
    },
  };
}

function createSigner() {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    signature: (message: Uint8Array) => sign("sha256", message, {
      dsaEncoding: "ieee-p1363", key: keys.privateKey,
    }).toString("base64"),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
