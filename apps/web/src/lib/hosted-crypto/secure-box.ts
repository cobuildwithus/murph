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
  "device-sync-external-account-id",
  "device-sync-payload",
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

export async function openHostedUserSecureBoxString(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "scope" | "tenant" | "userId">;
  lane: HostedCryptoLane;
  prisma?: HostedSecureBoxPrismaClient;
  scope: string;
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
    return new TextDecoder().decode(plaintext);
  } finally {
    rootKey.fill(0);
  }
}

function getHostedSecureBoxStringTestCodecForTests(): HostedSecureBoxStringTestCodec | null {
  if (!process.env.VITEST) {
    return null;
  }
  return globalForHostedSecureBoxTests.__murphHostedSecureBoxStringTestCodec ?? null;
}
