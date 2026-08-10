import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { DeviceSyncError } from "@murphai/device-syncd/errors";
import { getPrisma } from "../../prisma";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../../hosted-onboarding/shared";
import { generateHostedRandomPrefixedId } from "../shared";
import {
  decryptDeviceProviderApplication,
  encryptDeviceProviderApplication,
  isDeviceProviderApplicationSecretInvalidError,
} from "./crypto";
import {
  buildDeviceProviderApplicationRuntimeConfigs,
  buildDeviceProviderApplicationSecret,
  requireDeviceProviderApplicationRevision,
  requireMemberOwnedDeviceProviderApplicationProvider,
  type DeviceProviderApplicationView,
  type MemberOwnedDeviceProviderApplicationProvider,
  type ResolvedDeviceProviderApplication,
} from "./types";

export const DEVICE_PROVIDER_APPLICATION_SELECT = {
  configEncrypted: true,
  createdAt: true,
  id: true,
  memberId: true,
  provider: true,
  revision: true,
  updatedAt: true,
} as const satisfies Prisma.DeviceProviderApplicationSelect;

type DeviceProviderApplicationRow =
  Prisma.DeviceProviderApplicationGetPayload<{
    select: typeof DEVICE_PROVIDER_APPLICATION_SELECT;
  }>;

type DeviceProviderApplicationReadClient =
  | PrismaClient
  | Prisma.TransactionClient;

export type DeviceProviderApplicationErrorCode =
  | "DEVICE_PROVIDER_APPLICATION_CONFLICT"
  | "DEVICE_PROVIDER_APPLICATION_NOT_FOUND"
  | "DEVICE_PROVIDER_APPLICATION_INVALID"
  | "DEVICE_PROVIDER_APPLICATION_PERSONAL_MEMBER_REQUIRED"
  | "DEVICE_PROVIDER_APPLICATION_REVISION_MISMATCH"
  | "DEVICE_PROVIDER_APPLICATION_PROVIDER_MISMATCH"
  | "DEVICE_PROVIDER_APPLICATION_MEMBER_NOT_FOUND"
  | "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT";

export class DeviceProviderApplicationError extends DeviceSyncError {
  constructor(code: DeviceProviderApplicationErrorCode, message: string) {
    super({
      code,
      httpStatus: deviceProviderApplicationErrorHttpStatus(code),
      message,
      retryable: false,
    });
    this.name = "DeviceProviderApplicationError";
  }
}

function deviceProviderApplicationErrorHttpStatus(
  code: DeviceProviderApplicationErrorCode,
): number {
  switch (code) {
    case "DEVICE_PROVIDER_APPLICATION_NOT_FOUND":
    case "DEVICE_PROVIDER_APPLICATION_MEMBER_NOT_FOUND":
      return 404;
    case "DEVICE_PROVIDER_APPLICATION_PERSONAL_MEMBER_REQUIRED":
      return 403;
    case "DEVICE_PROVIDER_APPLICATION_CONFLICT":
    case "DEVICE_PROVIDER_APPLICATION_INVALID":
    case "DEVICE_PROVIDER_APPLICATION_REVISION_MISMATCH":
    case "DEVICE_PROVIDER_APPLICATION_PROVIDER_MISMATCH":
    case "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT":
      return 409;
  }
}

export function isDeviceProviderApplicationError(
  value: unknown,
): value is DeviceProviderApplicationError {
  return value instanceof DeviceProviderApplicationError;
}

export async function readDeviceProviderApplicationView(input: {
  memberId: string;
  prisma?: DeviceProviderApplicationReadClient;
  provider: string;
}): Promise<DeviceProviderApplicationView | null> {
  const provider = requireMemberOwnedDeviceProviderApplicationProvider(
    input.provider,
  );
  const prisma = input.prisma ?? getPrisma();
  const row = await prisma.deviceProviderApplication.findUnique({
    select: DEVICE_PROVIDER_APPLICATION_SELECT,
    where: {
      memberId_provider: {
        memberId: input.memberId,
        provider,
      },
    },
  });
  return row ? projectView(row) : null;
}

export async function saveDeviceProviderApplication(input: {
  clientId: string;
  clientSecret: string;
  expectedRevision: number | null;
  memberId: string;
  prisma?: PrismaClient;
  provider: string;
}): Promise<DeviceProviderApplicationView> {
  const provider = requireMemberOwnedDeviceProviderApplicationProvider(
    input.provider,
  );
  const prisma = input.prisma ?? getPrisma();
  // Reject missing and synthetic-room members before any KMS work. The
  // transaction repeats this check under the member lock before committing.
  await requirePersonalMember({ memberId: input.memberId, prisma });
  const initial = await prisma.deviceProviderApplication.findUnique({
    select: DEVICE_PROVIDER_APPLICATION_SELECT,
    where: {
      memberId_provider: {
        memberId: input.memberId,
        provider,
      },
    },
  });
  assertExpectedRevision({
    currentRevision: initial?.revision ?? null,
    expectedRevision: input.expectedRevision,
  });

  const desiredSecret = buildDeviceProviderApplicationSecret({
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    provider,
  });
  const applicationId = initial?.id
    ?? generateHostedRandomPrefixedId("dpa");
  const initialRevision = initial
    ? requireDeviceProviderApplicationRevision(initial.revision)
    : 0;
  const targetRevision = initialRevision + 1;
  const initialSecret = initial
    ? await readExistingDeviceProviderApplicationSecret({
        applicationId: initial.id,
        memberId: input.memberId,
        prisma,
        provider,
        revision: initial.revision,
        value: initial.configEncrypted,
      })
    : null;
  const credentialsUnchanged = Boolean(
    initialSecret
    && initialSecret.clientId === desiredSecret.clientId
    && initialSecret.clientSecret === desiredSecret.clientSecret,
  );
  const encrypted = credentialsUnchanged
    ? null
    : await encryptDeviceProviderApplication({
        applicationId,
        clientId: desiredSecret.clientId,
        clientSecret: desiredSecret.clientSecret,
        memberId: input.memberId,
        prisma,
        provider,
        revision: targetRevision,
      });

  const row = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await requirePersonalMember({ memberId: input.memberId, prisma: tx });

    const current = await tx.deviceProviderApplication.findUnique({
      select: DEVICE_PROVIDER_APPLICATION_SELECT,
      where: {
        memberId_provider: {
          memberId: input.memberId,
          provider,
        },
      },
    });
    assertInitialRowUnchanged({ current, initial });
    assertExpectedRevision({
      currentRevision: current?.revision ?? null,
      expectedRevision: input.expectedRevision,
    });

    if (!current) {
      const legacyConnection = await tx.deviceConnection.findFirst({
        select: { id: true },
        where: {
          provider,
          status: { not: "disconnected" },
          userId: input.memberId,
        },
      });
      if (legacyConnection) {
        throw new DeviceProviderApplicationError(
          "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT",
          "Disconnect the existing provider connection before creating a private provider application.",
        );
      }

      return tx.deviceProviderApplication.create({
        data: {
          configEncrypted: requireEncryptedProviderApplication(encrypted),
          id: applicationId,
          memberId: input.memberId,
          provider,
          revision: 1,
        },
        select: DEVICE_PROVIDER_APPLICATION_SELECT,
      });
    }

    if (credentialsUnchanged) {
      return current;
    }

    const activeConnection = await tx.deviceConnection.findFirst({
      select: { id: true },
      where: {
        providerApplicationId: current.id,
        status: { not: "disconnected" },
      },
    });
    if (activeConnection) {
      throw new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_CONNECTION_CONFLICT",
        "Disconnect the existing provider connection before replacing its private application credentials.",
      );
    }

    await tx.deviceConnection.updateMany({
      data: {
        providerApplicationId: null,
        providerApplicationRevision: null,
      },
      where: {
        providerApplicationId: current.id,
        status: "disconnected",
      },
    });
    await tx.deviceOauthSession.deleteMany({
      where: { providerApplicationId: current.id },
    });

    return tx.deviceProviderApplication.update({
      data: {
        configEncrypted: requireEncryptedProviderApplication(encrypted),
        revision: current.revision + 1,
      },
      select: DEVICE_PROVIDER_APPLICATION_SELECT,
      where: { id: current.id },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return projectView(row);
}

export async function resolveDeviceProviderApplication(input: {
  applicationId: string;
  expectedRevision: number;
  memberId: string;
  prisma?: DeviceProviderApplicationReadClient;
  provider: string;
}): Promise<ResolvedDeviceProviderApplication> {
  try {
    const provider = requireMemberOwnedDeviceProviderApplicationProvider(
      input.provider,
    );
    const expectedRevision = requireDeviceProviderApplicationRevision(
      input.expectedRevision,
    );
    const prisma = input.prisma ?? getPrisma();
    await requirePersonalMember({ memberId: input.memberId, prisma });
    const row = await prisma.deviceProviderApplication.findUnique({
      select: DEVICE_PROVIDER_APPLICATION_SELECT,
      where: { id: input.applicationId },
    });
    const authorizedRow = requireApplicationAuthority({
      applicationId: input.applicationId,
      expectedRevision,
      memberId: input.memberId,
      provider,
      row,
    });
    const secret = await decryptDeviceProviderApplication({
      applicationId: authorizedRow.id,
      memberId: authorizedRow.memberId,
      prisma,
      provider,
      revision: authorizedRow.revision,
      value: authorizedRow.configEncrypted,
    });

    return {
      applicationId: authorizedRow.id,
      provider,
      providerConfigs: buildDeviceProviderApplicationRuntimeConfigs({
        provider,
        secret,
      }),
      revision: authorizedRow.revision,
    };
  } catch (error) {
    if (error instanceof DeviceProviderApplicationError) {
      throw error;
    }
    if (isDeviceProviderApplicationSecretInvalidError(error)) {
      throw new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_INVALID",
        "Private provider application credentials are invalid and must be repaired.",
      );
    }
    throw error;
  }
}

export async function resolveDeviceProviderApplicationForConnection(input: {
  connectionId: string;
  memberId: string;
  prisma?: DeviceProviderApplicationReadClient;
}): Promise<ResolvedDeviceProviderApplication | null> {
  const prisma = input.prisma ?? getPrisma();
  const connection = await prisma.deviceConnection.findFirst({
    select: {
      provider: true,
      providerApplicationId: true,
      providerApplicationRevision: true,
    },
    where: {
      id: input.connectionId,
      userId: input.memberId,
    },
  });
  if (!connection) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_NOT_FOUND",
      "Device connection was not found for the current member.",
    );
  }
  if (
    connection.providerApplicationId === null
    && connection.providerApplicationRevision === null
  ) {
    return null;
  }
  if (
    !connection.providerApplicationId
    || connection.providerApplicationRevision === null
  ) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_REVISION_MISMATCH",
      "Device connection has an incomplete private provider application binding.",
    );
  }

  return resolveDeviceProviderApplication({
    applicationId: connection.providerApplicationId,
    expectedRevision: connection.providerApplicationRevision,
    memberId: input.memberId,
    prisma,
    provider: connection.provider,
  });
}

async function requirePersonalMember(input: {
  memberId: string;
  prisma: DeviceProviderApplicationReadClient;
}): Promise<void> {
  const member = await input.prisma.hostedMember.findUnique({
    select: {
      hostedGroupRuntime: { select: { id: true } },
      id: true,
      threadContainer: { select: { memberId: true } },
    },
    where: { id: input.memberId },
  });
  if (!member) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_MEMBER_NOT_FOUND",
      "Finish signup before connecting a private provider application.",
    );
  }
  if (member.threadContainer !== null || member.hostedGroupRuntime !== null) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_PERSONAL_MEMBER_REQUIRED",
      "Private provider applications are available only for personal Murph members.",
    );
  }
}

async function readExistingDeviceProviderApplicationSecret(input: {
  applicationId: string;
  memberId: string;
  prisma: DeviceProviderApplicationReadClient;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  revision: number;
  value: string;
}) {
  try {
    return await decryptDeviceProviderApplication(input);
  } catch (error) {
    if (isDeviceProviderApplicationSecretInvalidError(error)) {
      return null;
    }
    throw error;
  }
}

function projectView(
  row: DeviceProviderApplicationRow,
): DeviceProviderApplicationView {
  return {
    applicationId: row.id,
    createdAt: row.createdAt.toISOString(),
    provider: requireMemberOwnedDeviceProviderApplicationProvider(row.provider),
    revision: requireDeviceProviderApplicationRevision(row.revision),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertExpectedRevision(input: {
  currentRevision: number | null;
  expectedRevision: number | null;
}): void {
  const expected = input.expectedRevision === null
    ? null
    : requireDeviceProviderApplicationRevision(input.expectedRevision);
  if (input.currentRevision !== expected) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_CONFLICT",
      "The private provider application changed. Refresh and try again.",
    );
  }
}

function assertInitialRowUnchanged(input: {
  current: DeviceProviderApplicationRow | null;
  initial: DeviceProviderApplicationRow | null;
}): void {
  if (!input.initial || !input.current) {
    if (input.initial !== input.current) {
      throw new DeviceProviderApplicationError(
        "DEVICE_PROVIDER_APPLICATION_CONFLICT",
        "The private provider application changed while it was being saved.",
      );
    }
    return;
  }
  if (
    input.initial.id !== input.current.id
    || input.initial.revision !== input.current.revision
    || input.initial.updatedAt.getTime() !== input.current.updatedAt.getTime()
  ) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_CONFLICT",
      "The private provider application changed while it was being saved.",
    );
  }
}

function requireEncryptedProviderApplication(value: string | null): string {
  if (!value) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_INVALID",
      "Private provider application encryption was not prepared.",
    );
  }
  return value;
}

function requireApplicationAuthority(input: {
  applicationId: string;
  expectedRevision: number;
  memberId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  row: DeviceProviderApplicationRow | null;
}): DeviceProviderApplicationRow {
  if (!input.row) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_NOT_FOUND",
      "Private provider application was not found.",
    );
  }
  if (input.row.memberId !== input.memberId) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_NOT_FOUND",
      "Private provider application was not found for the current member.",
    );
  }
  if (input.row.provider !== input.provider) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_PROVIDER_MISMATCH",
      "Private provider application does not match the requested provider.",
    );
  }
  if (input.row.revision !== input.expectedRevision) {
    throw new DeviceProviderApplicationError(
      "DEVICE_PROVIDER_APPLICATION_REVISION_MISMATCH",
      "Private provider application changed and must be reauthorized.",
    );
  }
  return input.row;
}
