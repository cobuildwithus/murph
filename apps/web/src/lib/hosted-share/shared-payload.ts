import type { HostedSharePayload } from "@prisma/client";
import {
  assertContract,
  sharePackSchema,
  type SharePack,
} from "@murphai/contracts";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  decryptHostedWebNullableString,
  encryptHostedWebNullableString,
} from "../hosted-web/encryption";

import type {
  HostedSharePayloadState,
  HostedSharePrismaClient,
} from "./types";

export const HOSTED_SHARE_PAYLOAD_SCHEMA = "murph.hosted-share-payload.v1";

const HOSTED_SHARE_PAYLOAD_FIELD = "hosted-share.payload";

export async function readHostedSharePayload(input: {
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<HostedSharePayloadState | null> {
  const record = await input.prisma.hostedSharePayload.findUnique({
    where: {
      shareId: input.shareId,
    },
  });

  return record ? projectHostedSharePayloadState(record) : null;
}

export async function requireHostedSharePayload(input: {
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<HostedSharePayloadState> {
  const payload = await readHostedSharePayload(input);

  if (!payload) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_PAYLOAD_NOT_FOUND",
      message: "That shared bundle is no longer available.",
      httpStatus: 404,
    });
  }

  return payload;
}

export async function upsertHostedSharePayload(input: {
  pack: SharePack;
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<HostedSharePayloadState> {
  const pack = assertContract(sharePackSchema, input.pack, "share pack");
  const payloadEncrypted = encryptHostedWebNullableString({
    field: HOSTED_SHARE_PAYLOAD_FIELD,
    memberId: input.shareId,
    value: JSON.stringify(pack),
  });

  if (!payloadEncrypted) {
    throw new TypeError("Hosted share payload must not be empty.");
  }

  const record = await input.prisma.hostedSharePayload.upsert({
    where: {
      shareId: input.shareId,
    },
    create: {
      payloadEncrypted,
      payloadSchema: HOSTED_SHARE_PAYLOAD_SCHEMA,
      shareId: input.shareId,
    },
    update: {
      payloadEncrypted,
      payloadSchema: HOSTED_SHARE_PAYLOAD_SCHEMA,
    },
  });

  return projectHostedSharePayloadState(record);
}

export async function deleteHostedSharePayload(input: {
  prisma: HostedSharePrismaClient;
  shareId: string;
}): Promise<void> {
  await input.prisma.hostedSharePayload.deleteMany({
    where: {
      shareId: input.shareId,
    },
  });
}

export function projectHostedSharePayloadState(
  record: Pick<HostedSharePayload, "payloadEncrypted" | "payloadSchema" | "shareId">,
): HostedSharePayloadState {
  const payloadText = decryptHostedWebNullableString({
    field: HOSTED_SHARE_PAYLOAD_FIELD,
    memberId: record.shareId,
    value: record.payloadEncrypted,
  });

  if (!payloadText) {
    throw new TypeError("Hosted share payload ciphertext must decrypt to a share pack.");
  }

  return {
    pack: assertContract(
      sharePackSchema,
      JSON.parse(payloadText),
      "stored hosted share payload",
    ),
    payloadSchema: normalizeHostedSharePayloadSchema(record.payloadSchema),
    shareId: record.shareId,
  };
}

function normalizeHostedSharePayloadSchema(value: string): string {
  if (value !== HOSTED_SHARE_PAYLOAD_SCHEMA) {
    throw new TypeError("Hosted share payload schema is invalid.");
  }

  return value;
}
