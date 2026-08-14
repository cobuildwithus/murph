import {
  buildHostedSecureBoxAad,
  getHostedCryptoDomainForLane,
  openHostedSecureBox,
  parseSerializedHostedSecureBoxEnvelope,
  sealHostedSecureBox,
  serializeHostedSecureBoxEnvelope,
  type HostedCryptoDomain,
  type HostedCryptoLane,
  type HostedSecureBoxAadFields,
} from "@murphai/runtime-state";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { HostedDomainRootReference } from "./domain-root-store";
import {
  getHostedDomainRootUnwrapCache,
  type CachedUnwrappedHostedDomainRoot,
} from "./domain-root-unwrap-cache";

const WEB_SEAL_LANES = new Set<HostedCryptoLane>([
  "hosted-member-private-field",
  "hosted-inference-connection",
  "clinical-records-oauth",
  "clinical-records-page-cursor",
  "clinical-records-patient-id",
  "clinical-records-token",
  "device-sync-external-account-id",
  "device-sync-payload",
  "device-sync-provider-application",
  "device-sync-token",
  "mailbox-payload",
  "email-raw",
]);

type HostedSecureBoxStringTestCodec = {
  decrypt(input: {
    aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
    lane: HostedCryptoLane;
    scope: string;
    userId: string;
    value: string;
  }): string;
  encrypt(input: {
    aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
    lane: HostedCryptoLane;
    scope: string;
    userId: string;
    value: string;
  }): string;
};

export type HostedSecureBoxPrismaClient = PrismaClient | Prisma.TransactionClient;

export interface HostedSecureBoxStringRootReference {
  domain: HostedCryptoDomain;
  rootKeyId: string;
}

const globalForHostedSecureBoxTests = globalThis as typeof globalThis & {
  __murphHostedSecureBoxStringTestCodec?: HostedSecureBoxStringTestCodec;
};

export function setHostedSecureBoxStringTestCodecForTests(
  codec: HostedSecureBoxStringTestCodec | null,
): void {
  if (!process.env.VITEST) {
    throw new Error("Hosted secure-box test codec can only be configured under Vitest.");
  }

  if (codec) {
    globalForHostedSecureBoxTests.__murphHostedSecureBoxStringTestCodec = codec;
  } else {
    delete globalForHostedSecureBoxTests.__murphHostedSecureBoxStringTestCodec;
  }
}

export function isHostedSecureBoxStringTestCodecConfiguredForTests(): boolean {
  return getHostedSecureBoxStringTestCodecForTests() !== null;
}

/**
 * Reads only envelope routing metadata needed to prewarm a decrypt root. The
 * test codec has no provider-backed root and therefore returns null; production
 * values either return their exact root reference or throw on malformed or
 * domain-mismatched secure-box bytes.
 */
export function readHostedUserSecureBoxStringRootReference(input: {
  lane: HostedCryptoLane;
  value: string | null | undefined;
}): HostedSecureBoxStringRootReference | null {
  if (input.value === null || input.value === undefined || input.value.trim().length === 0) {
    return null;
  }
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to decrypt hosted ${input.lane} values.`);
  }
  if (getHostedSecureBoxStringTestCodecForTests()) {
    return null;
  }
  const serializedEnvelope = parseSerializedHostedSecureBoxEnvelope(input.value);
  const domain = getHostedCryptoDomainForLane(input.lane);
  if (serializedEnvelope.domain !== domain) {
    throw new Error(`Hosted secure-box envelope domain mismatch for lane ${input.lane}.`);
  }
  return {
    domain,
    rootKeyId: serializedEnvelope.rootKeyId,
  };
}

export async function sealHostedUserSecureBoxString(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  lane: HostedCryptoLane;
  prisma?: HostedSecureBoxPrismaClient;
  scope: string;
  signal?: AbortSignal;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  if (input.value === null || input.value === undefined) {
    return null;
  }
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to encrypt hosted ${input.lane} values.`);
  }
  const testCodec = getHostedSecureBoxStringTestCodecForTests();
  if (testCodec) {
    return testCodec.encrypt({
      aad: input.aad,
      lane: input.lane,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    });
  }
  const domain = getHostedCryptoDomainForLane(input.lane);
  const { unwrapHostedDomainRootForWeb } = await import("./domain-root-store");
  const { envelope, rootKey } = await unwrapHostedDomainRootForWeb({
    domain,
    prisma: input.prisma,
    signal: input.signal,
    userId: input.userId,
  });
  try {
    return await sealHostedUserSecureBoxStringWithRootKey({
      aad: input.aad,
      domain,
      lane: input.lane,
      rootKey,
      rootKeyId: envelope.rootKeyId,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    });
  } finally {
    rootKey.fill(0);
  }
}

export async function sealHostedUserSecureBoxStrings(input: {
  entries: ReadonlyArray<{
    aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
    scope: string;
    value: string;
  }>;
  lane: HostedCryptoLane;
  prisma?: HostedSecureBoxPrismaClient;
  signal?: AbortSignal;
  userId: string;
}): Promise<string[]> {
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to encrypt hosted ${input.lane} values.`);
  }
  if (input.entries.length === 0) {
    return [];
  }
  const testCodec = getHostedSecureBoxStringTestCodecForTests();
  if (testCodec) {
    return input.entries.map((entry) =>
      testCodec.encrypt({
        aad: entry.aad,
        lane: input.lane,
        scope: entry.scope,
        userId: input.userId,
        value: entry.value,
      })
    );
  }

  const domain = getHostedCryptoDomainForLane(input.lane);
  const { unwrapHostedDomainRootForWeb } = await import("./domain-root-store");
  const { envelope, rootKey } = await unwrapHostedDomainRootForWeb({
    domain,
    prisma: input.prisma,
    signal: input.signal,
    userId: input.userId,
  });
  try {
    return await Promise.all(input.entries.map(async (entry) => {
      const aad = buildHostedSecureBoxAad({
        ...entry.aad,
        domain,
        lane: input.lane,
        scope: entry.scope,
        tenant: "murph-hosted",
        userId: input.userId,
      });
      return serializeHostedSecureBoxEnvelope(
        await sealHostedSecureBox({
          aad,
          domain,
          lane: input.lane,
          plaintext: new TextEncoder().encode(entry.value),
          rootKey,
          rootKeyId: envelope.rootKeyId,
          scope: entry.scope,
        }),
      );
    }));
  } finally {
    rootKey.fill(0);
  }
}

export async function openHostedUserSecureBoxString(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  lane: HostedCryptoLane;
  prisma?: HostedSecureBoxPrismaClient;
  scope: string;
  signal?: AbortSignal;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  if (input.value === null || input.value === undefined || input.value.trim().length === 0) {
    return null;
  }
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to decrypt hosted ${input.lane} values.`);
  }
  const testCodec = getHostedSecureBoxStringTestCodecForTests();
  if (testCodec) {
    return testCodec.decrypt({
      aad: input.aad,
      lane: input.lane,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    });
  }
  const serializedEnvelope = parseSerializedHostedSecureBoxEnvelope(input.value);
  const domain = getHostedCryptoDomainForLane(input.lane);
  if (serializedEnvelope.domain !== domain) {
    throw new Error(`Hosted secure-box envelope domain mismatch for lane ${input.lane}.`);
  }
  const { unwrapHostedDomainRootForWebByRootKeyId } = await import("./domain-root-store");
  const { rootKey } = await unwrapHostedDomainRootForWebByRootKeyId({
    domain,
    prisma: input.prisma,
    rootKeyId: serializedEnvelope.rootKeyId,
    signal: input.signal,
    userId: input.userId,
  });
  try {
    return await openHostedUserSecureBoxStringWithRootKey({
      aad: input.aad,
      domain,
      lane: input.lane,
      rootKey,
      scope: input.scope,
      serializedEnvelope,
      userId: input.userId,
    });
  } finally {
    rootKey.fill(0);
  }
}

export interface HostedSecureBoxStringEntry {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  scope: string;
  userId: string;
  value: string | null | undefined;
}

type ParsedHostedSecureBoxStringEntry = {
  entry: HostedSecureBoxStringEntry;
  envelope: ReturnType<typeof parseSerializedHostedSecureBoxEnvelope>;
} | null;

export async function prewarmHostedUserSecureBoxStrings(input: {
  entries: readonly HostedSecureBoxStringEntry[];
  lane: HostedCryptoLane;
  prisma?: HostedSecureBoxPrismaClient;
  signal?: AbortSignal;
}): Promise<void> {
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to decrypt hosted ${input.lane} values.`);
  }
  if (getHostedSecureBoxStringTestCodecForTests()) {
    return;
  }

  const { domain, parsedEntries } = parseHostedSecureBoxStringEntries(input);
  const { unwrapHostedDomainRootsForWebByRootKeyIds } = await import(
    "./domain-root-store"
  );
  const roots = await unwrapHostedDomainRootsForWebByRootKeyIds({
    prisma: input.prisma,
    references: buildHostedSecureBoxRootReferences({ domain, parsedEntries }),
    retainFailureInScopedCache: true,
    signal: input.signal,
  });
  for (const root of roots) {
    root.rootKey.fill(0);
  }
}

/**
 * Seals a secure-box string only from an exact root already present in the
 * request-scoped cache. This path never imports or invokes the provider-capable
 * domain-root store and is therefore safe inside a database transaction after
 * a matching pre-transaction warm.
 */
export async function sealHostedUserSecureBoxStringFromPreparedRoot(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  lane: HostedCryptoLane;
  preparedRoot: Promise<CachedUnwrappedHostedDomainRoot>;
  preparedRootKeyId: string;
  scope: string;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  if (input.value === null || input.value === undefined) {
    return null;
  }
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to encrypt hosted ${input.lane} values.`);
  }
  if (
    typeof input.preparedRootKeyId !== "string"
    || input.preparedRootKeyId.trim().length === 0
  ) {
    throw new Error("Hosted secure-box prepared root reference is missing.");
  }
  const testCodec = getHostedSecureBoxStringTestCodecForTests();
  if (testCodec) {
    return testCodec.encrypt({
      aad: input.aad,
      lane: input.lane,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    });
  }

  const domain = getHostedCryptoDomainForLane(input.lane);
  const cachedRoot = getHostedDomainRootUnwrapCache()?.get(
    createHostedSecureBoxRootReferenceKey({
      domain,
      rootKeyId: input.preparedRootKeyId,
      userId: input.userId,
    }),
  );
  if (!cachedRoot || cachedRoot !== input.preparedRoot) {
    throw new Error(
      "Hosted secure-box prepared root is not the exact scoped cache entry.",
    );
  }
  const unwrapped = await input.preparedRoot;
  if (
    unwrapped.envelope.domain !== domain
    || unwrapped.envelope.rootKeyId !== input.preparedRootKeyId
    || unwrapped.envelope.userId !== input.userId
  ) {
    throw new Error("Hosted secure-box cached root does not match its prepared reference.");
  }
  const rootKey = Uint8Array.from(unwrapped.rootKey);
  try {
    return await sealHostedUserSecureBoxStringWithRootKey({
      aad: input.aad,
      domain,
      lane: input.lane,
      rootKey,
      rootKeyId: input.preparedRootKeyId,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    });
  } finally {
    rootKey.fill(0);
  }
}

async function sealHostedUserSecureBoxStringWithRootKey(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  rootKey: Uint8Array;
  rootKeyId: string;
  scope: string;
  userId: string;
  value: string;
}): Promise<string> {
  const aad = buildHostedSecureBoxAad({
    ...input.aad,
    domain: input.domain,
    lane: input.lane,
    scope: input.scope,
    tenant: "murph-hosted",
    userId: input.userId,
  });
  return serializeHostedSecureBoxEnvelope(
    await sealHostedSecureBox({
      aad,
      domain: input.domain,
      lane: input.lane,
      plaintext: new TextEncoder().encode(input.value),
      rootKey: input.rootKey,
      rootKeyId: input.rootKeyId,
      scope: input.scope,
    }),
  );
}

/**
 * Opens a secure-box string only from an exact root already present in the
 * request-scoped cache. This is the single-item entry point used by callers
 * that carry an explicit prepared root reference; the actual cache read and
 * decrypt remain owned by the canonical prepared-root batch path.
 */
export async function openHostedUserSecureBoxStringFromPreparedRoot(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  lane: HostedCryptoLane;
  preparedRootKeyId: string | null;
  scope: string;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  if (input.value === null || input.value === undefined || input.value.trim().length === 0) {
    return null;
  }
  if (!getHostedSecureBoxStringTestCodecForTests()) {
    if (!input.preparedRootKeyId) {
      throw new Error("Hosted secure-box prepared root reference is missing.");
    }
    const rootReference = readHostedUserSecureBoxStringRootReference({
      lane: input.lane,
      value: input.value,
    });
    if (!rootReference || rootReference.rootKeyId !== input.preparedRootKeyId) {
      throw new Error(`Hosted secure-box prepared root mismatch for lane ${input.lane}.`);
    }
  }

  const [opened] = await openHostedUserSecureBoxStringsWithPreparedRoots({
    entries: [{
      aad: input.aad,
      scope: input.scope,
      userId: input.userId,
      value: input.value,
    }],
    lane: input.lane,
  });
  return opened ?? null;
}

async function openHostedUserSecureBoxStringWithRootKey(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  domain: HostedCryptoDomain;
  lane: HostedCryptoLane;
  rootKey: Uint8Array;
  scope: string;
  serializedEnvelope: ReturnType<typeof parseSerializedHostedSecureBoxEnvelope>;
  userId: string;
}): Promise<string> {
  const aad = buildHostedSecureBoxAad({
    ...input.aad,
    domain: input.domain,
    lane: input.lane,
    scope: input.scope,
    tenant: "murph-hosted",
    userId: input.userId,
  });
  const plaintext = await openHostedSecureBox({
    aad,
    envelope: input.serializedEnvelope,
    expectedDomain: input.domain,
    expectedLane: input.lane,
    expectedRootKeyId: input.serializedEnvelope.rootKeyId,
    expectedScope: input.scope,
    rootKey: input.rootKey,
  });
  try {
    return new TextDecoder().decode(plaintext);
  } finally {
    plaintext.fill(0);
  }
}

export async function openHostedUserSecureBoxStrings(input: {
  entries: readonly HostedSecureBoxStringEntry[];
  lane: HostedCryptoLane;
  prisma?: HostedSecureBoxPrismaClient;
  retainFailureInScopedCache?: boolean;
  signal?: AbortSignal;
}): Promise<Array<string | null>> {
  const testCodec = prepareHostedSecureBoxBatchOpen(input);
  if (testCodec) {
    return openHostedSecureBoxStringsWithTestCodec(input, testCodec);
  }

  const { domain, parsedEntries } = parseHostedSecureBoxStringEntries(input);
  const { unwrapHostedDomainRootsForWebByRootKeyIds } = await import(
    "./domain-root-store"
  );
  const roots = await unwrapHostedDomainRootsForWebByRootKeyIds({
    prisma: input.prisma,
    references: buildHostedSecureBoxRootReferences({ domain, parsedEntries }),
    ...(input.retainFailureInScopedCache === undefined
      ? {}
      : {
          retainFailureInScopedCache: input.retainFailureInScopedCache,
        }),
    signal: input.signal,
  });
  return openParsedHostedSecureBoxStrings({
    domain,
    lane: input.lane,
    parsedEntries,
    roots,
  });
}

export async function openHostedUserSecureBoxStringsWithPreparedRoots(input: {
  entries: readonly HostedSecureBoxStringEntry[];
  lane: HostedCryptoLane;
}): Promise<Array<string | null>> {
  const testCodec = prepareHostedSecureBoxBatchOpen(input);
  if (testCodec) {
    return openHostedSecureBoxStringsWithTestCodec(input, testCodec);
  }

  const { domain, parsedEntries } = parseHostedSecureBoxStringEntries(input);
  const { readPreparedHostedDomainRootsForWebByRootKeyIds } = await import(
    "./domain-root-store"
  );
  const roots = await readPreparedHostedDomainRootsForWebByRootKeyIds({
    references: buildHostedSecureBoxRootReferences({ domain, parsedEntries }),
  });
  return openParsedHostedSecureBoxStrings({
    domain,
    lane: input.lane,
    parsedEntries,
    roots,
  });
}

function prepareHostedSecureBoxBatchOpen(input: {
  lane: HostedCryptoLane;
}): HostedSecureBoxStringTestCodec | null {
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to decrypt hosted ${input.lane} values.`);
  }
  return getHostedSecureBoxStringTestCodecForTests();
}

function openHostedSecureBoxStringsWithTestCodec(
  input: {
    entries: readonly HostedSecureBoxStringEntry[];
    lane: HostedCryptoLane;
  },
  testCodec: HostedSecureBoxStringTestCodec,
): Array<string | null> {
  return input.entries.map((entry) =>
    entry.value === null
    || entry.value === undefined
    || entry.value.trim().length === 0
      ? null
      : testCodec.decrypt({
          aad: entry.aad,
          lane: input.lane,
          scope: entry.scope,
          userId: entry.userId,
          value: entry.value,
        })
  );
}

function parseHostedSecureBoxStringEntries(input: {
  entries: readonly HostedSecureBoxStringEntry[];
  lane: HostedCryptoLane;
}): {
  domain: ReturnType<typeof getHostedCryptoDomainForLane>;
  parsedEntries: ParsedHostedSecureBoxStringEntry[];
} {
  const domain = getHostedCryptoDomainForLane(input.lane);
  const parsedEntries = input.entries.map((entry) => {
    if (
      entry.value === null
      || entry.value === undefined
      || entry.value.trim().length === 0
    ) {
      return null;
    }
    const envelope = parseSerializedHostedSecureBoxEnvelope(entry.value);
    if (envelope.domain !== domain) {
      throw new Error(`Hosted secure-box envelope domain mismatch for lane ${input.lane}.`);
    }
    return { entry, envelope };
  });
  return { domain, parsedEntries };
}

function buildHostedSecureBoxRootReferences(input: {
  domain: ReturnType<typeof getHostedCryptoDomainForLane>;
  parsedEntries: readonly ParsedHostedSecureBoxStringEntry[];
}): HostedDomainRootReference[] {
  return input.parsedEntries.flatMap((parsed) =>
    parsed
      ? [{
          domain: input.domain,
          rootKeyId: parsed.envelope.rootKeyId,
          userId: parsed.entry.userId,
        }]
      : []
  );
}

async function openParsedHostedSecureBoxStrings(input: {
  domain: ReturnType<typeof getHostedCryptoDomainForLane>;
  lane: HostedCryptoLane;
  parsedEntries: readonly ParsedHostedSecureBoxStringEntry[];
  roots: ReadonlyArray<{
    domain: string;
    rootKey: Uint8Array;
    rootKeyId: string;
    userId: string;
  }>;
}): Promise<Array<string | null>> {
  const rootsByKey = new Map(
    input.roots.map((root) => [
      createHostedSecureBoxRootReferenceKey(root),
      root,
    ] as const),
  );

  try {
    let firstObservedFailure: unknown;
    let hasObservedFailure = false;
    const settled = await Promise.allSettled(input.parsedEntries.map(async (parsed) => {
      try {
        if (!parsed) {
          return null;
        }
        const root = rootsByKey.get(createHostedSecureBoxRootReferenceKey({
          domain: input.domain,
          rootKeyId: parsed.envelope.rootKeyId,
          userId: parsed.entry.userId,
        }));
        if (!root) {
          throw new Error("Hosted secure-box root was not returned by the batch unwrap.");
        }
        const rootKey = Uint8Array.from(root.rootKey);
        try {
          return await openHostedUserSecureBoxStringWithRootKey({
            aad: parsed.entry.aad,
            domain: input.domain,
            lane: input.lane,
            rootKey,
            scope: parsed.entry.scope,
            serializedEnvelope: parsed.envelope,
            userId: parsed.entry.userId,
          });
        } finally {
          rootKey.fill(0);
        }
      } catch (error) {
        if (!hasObservedFailure) {
          firstObservedFailure = error;
          hasObservedFailure = true;
        }
        throw error;
      }
    }));
    if (hasObservedFailure) {
      // Drain every started open before releasing root ownership or returning
      // an authenticity failure to the caller.
      throw firstObservedFailure;
    }
    return settled.map((result) => {
      if (result.status === "rejected") {
        throw result.reason;
      }
      return result.value;
    });
  } finally {
    for (const root of input.roots) {
      root.rootKey.fill(0);
    }
  }
}

function createHostedSecureBoxRootReferenceKey(input: {
  domain: string;
  rootKeyId: string;
  userId: string;
}): string {
  return `${input.userId}|${input.domain}|${input.rootKeyId}`;
}

function getHostedSecureBoxStringTestCodecForTests(): HostedSecureBoxStringTestCodec | null {
  if (!process.env.VITEST) {
    return null;
  }
  return globalForHostedSecureBoxTests.__murphHostedSecureBoxStringTestCodec ?? null;
}
