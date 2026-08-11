import {
  buildHostedSecureBoxAad,
  getHostedCryptoDomainForLane,
  openHostedSecureBox,
  parseSerializedHostedSecureBoxEnvelope,
  sealHostedSecureBox,
  serializeHostedSecureBoxEnvelope,
  type HostedCryptoLane,
  type HostedSecureBoxAadFields,
} from "@murphai/runtime-state";
import type { Prisma, PrismaClient } from "@prisma/client";

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
    const aad = buildHostedSecureBoxAad({
      ...input.aad,
      domain,
      lane: input.lane,
      scope: input.scope,
      tenant: "murph-hosted",
      userId: input.userId,
    });
    return serializeHostedSecureBoxEnvelope(
      await sealHostedSecureBox({
        aad,
        domain,
        lane: input.lane,
        plaintext: new TextEncoder().encode(input.value),
        rootKey,
        rootKeyId: envelope.rootKeyId,
        scope: input.scope,
      }),
    );
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
    const aad = buildHostedSecureBoxAad({
      ...input.aad,
      domain,
      lane: input.lane,
      scope: input.scope,
      tenant: "murph-hosted",
      userId: input.userId,
    });
    const plaintext = await openHostedSecureBox({
      aad,
      envelope: serializedEnvelope,
      expectedDomain: domain,
      expectedLane: input.lane,
      expectedRootKeyId: serializedEnvelope.rootKeyId,
      expectedScope: input.scope,
      rootKey,
    });
    try {
      return new TextDecoder().decode(plaintext);
    } finally {
      plaintext.fill(0);
    }
  } finally {
    rootKey.fill(0);
  }
}

export async function openHostedUserSecureBoxStrings(input: {
  entries: ReadonlyArray<{
    aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
    scope: string;
    userId: string;
    value: string | null | undefined;
  }>;
  lane: HostedCryptoLane;
  prisma?: HostedSecureBoxPrismaClient;
  retainFailureInScopedCache?: boolean;
  signal?: AbortSignal;
}): Promise<Array<string | null>> {
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to decrypt hosted ${input.lane} values.`);
  }
  const testCodec = getHostedSecureBoxStringTestCodecForTests();
  if (testCodec) {
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

  const domain = getHostedCryptoDomainForLane(input.lane);
  const parsedEntries = input.entries.map((entry) => {
    if (entry.value === null || entry.value === undefined || entry.value.trim().length === 0) {
      return null;
    }
    const envelope = parseSerializedHostedSecureBoxEnvelope(entry.value);
    if (envelope.domain !== domain) {
      throw new Error(`Hosted secure-box envelope domain mismatch for lane ${input.lane}.`);
    }
    return { entry, envelope };
  });
  const { unwrapHostedDomainRootsForWebByRootKeyIds } = await import("./domain-root-store");
  const roots = await unwrapHostedDomainRootsForWebByRootKeyIds({
    prisma: input.prisma,
    references: parsedEntries.flatMap((parsed) =>
      parsed
        ? [{
            domain,
            rootKeyId: parsed.envelope.rootKeyId,
            userId: parsed.entry.userId,
          }]
        : []
    ),
    ...(input.retainFailureInScopedCache === undefined
      ? {}
      : {
          retainFailureInScopedCache:
            input.retainFailureInScopedCache,
        }),
    signal: input.signal,
  });
  const rootsByKey = new Map(
    roots.map((root) => [
      createHostedSecureBoxRootReferenceKey(root),
      root,
    ] as const),
  );

  try {
    return await Promise.all(parsedEntries.map(async (parsed) => {
      if (!parsed) {
        return null;
      }
      const root = rootsByKey.get(createHostedSecureBoxRootReferenceKey({
        domain,
        rootKeyId: parsed.envelope.rootKeyId,
        userId: parsed.entry.userId,
      }));
      if (!root) {
        throw new Error("Hosted secure-box root was not returned by the batch unwrap.");
      }
      const rootKey = Uint8Array.from(root.rootKey);
      try {
        const aad = buildHostedSecureBoxAad({
          ...parsed.entry.aad,
          domain,
          lane: input.lane,
          scope: parsed.entry.scope,
          tenant: "murph-hosted",
          userId: parsed.entry.userId,
        });
        const plaintext = await openHostedSecureBox({
          aad,
          envelope: parsed.envelope,
          expectedDomain: domain,
          expectedLane: input.lane,
          expectedRootKeyId: parsed.envelope.rootKeyId,
          expectedScope: parsed.entry.scope,
          rootKey,
        });
        try {
          return new TextDecoder().decode(plaintext);
        } finally {
          plaintext.fill(0);
        }
      } finally {
        rootKey.fill(0);
      }
    }));
  } finally {
    for (const root of roots) {
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
