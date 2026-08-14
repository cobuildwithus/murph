import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { DeviceSyncError } from "@murphai/device-syncd/errors";

import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../../hosted-onboarding/shared";
import { getPrisma } from "../../prisma";
import { generateHostedRandomPrefixedId } from "../shared";
import {
  isMemberOwnedDeviceProviderApplicationProvider,
  type MemberOwnedDeviceProviderApplicationProvider,
} from "../provider-applications";
import {
  readMemberOwnedProviderSetupBinding,
  requireMemberOwnedProviderSetupStatus,
  type MemberOwnedProviderSetupConnectionDisposition,
  type MemberOwnedProviderSetupRecord,
  type MemberOwnedProviderSetupStatus,
} from "./types";

export const DEVICE_PROVIDER_SETUP_SELECT = {
  active: true,
  applicationName: true,
  browserRunId: true,
  completedAt: true,
  connectSourceId: true,
  connectTarget: true,
  createdAt: true,
  id: true,
  memberId: true,
  provider: true,
  providerApplicationId: true,
  providerApplicationRevision: true,
  sourceProviderSlug: true,
  status: true,
  updatedAt: true,
  version: true,
} as const satisfies Prisma.DeviceProviderSetupSelect;

type DeviceProviderSetupRow = Prisma.DeviceProviderSetupGetPayload<{
  select: typeof DEVICE_PROVIDER_SETUP_SELECT;
}>;

type DeviceProviderSetupClient = PrismaClient | Prisma.TransactionClient;

export type DeviceProviderSetupErrorCode =
  | "DEVICE_PROVIDER_SETUP_CONFLICT"
  | "DEVICE_PROVIDER_SETUP_NOT_FOUND"
  | "DEVICE_PROVIDER_SETUP_PERSONAL_MEMBER_REQUIRED"
  | "DEVICE_PROVIDER_SETUP_MEMBER_NOT_FOUND"
  | "DEVICE_PROVIDER_SETUP_PROVIDER_UNSUPPORTED";

export class DeviceProviderSetupError extends DeviceSyncError {
  constructor(code: DeviceProviderSetupErrorCode, message: string) {
    super({
      code,
      httpStatus: code === "DEVICE_PROVIDER_SETUP_NOT_FOUND"
        || code === "DEVICE_PROVIDER_SETUP_MEMBER_NOT_FOUND"
        ? 404
        : code === "DEVICE_PROVIDER_SETUP_PERSONAL_MEMBER_REQUIRED"
        ? 403
        : 409,
      message,
      retryable: false,
    });
    this.name = "DeviceProviderSetupError";
  }
}

export interface DeviceProviderSetupTransitionInput {
  active?: boolean;
  applicationName?: string | null;
  browserRunId?: string | null;
  completedAt?: Date | null;
  expectedVersion: number;
  memberId: string;
  provider: MemberOwnedDeviceProviderApplicationProvider;
  providerApplicationId?: string | null;
  providerApplicationRevision?: number | null;
  setupId: string;
  status: MemberOwnedProviderSetupStatus;
}

export class PrismaDeviceProviderSetupStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient = getPrisma()) {
    this.prisma = prisma;
  }

  async ensureActive(input: {
    connectSourceId: string;
    connectTarget: string;
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    sourceProviderSlug: string | null;
  }): Promise<MemberOwnedProviderSetupRecord> {
    return this.prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.memberId);
      await requirePersonalMember({ memberId: input.memberId, prisma: tx });
      const existing = await tx.deviceProviderSetup.findFirst({
        orderBy: { createdAt: "desc" },
        select: DEVICE_PROVIDER_SETUP_SELECT,
        where: {
          active: true,
          memberId: input.memberId,
          provider: input.provider,
        },
      });
      if (existing) {
        assertSetupCoordinates(existing, input);
        return mapSetup(existing);
      }

      const created = await tx.deviceProviderSetup.create({
        data: {
          active: true,
          connectSourceId: input.connectSourceId,
          connectTarget: input.connectTarget,
          id: generateHostedRandomPrefixedId("dps"),
          memberId: input.memberId,
          provider: input.provider,
          sourceProviderSlug: input.sourceProviderSlug,
          status: "pending",
        },
        select: DEVICE_PROVIDER_SETUP_SELECT,
      });
      return mapSetup(created);
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  }

  async readActive(input: {
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
  }): Promise<MemberOwnedProviderSetupRecord | null> {
    const row = await this.prisma.deviceProviderSetup.findFirst({
      orderBy: { createdAt: "desc" },
      select: DEVICE_PROVIDER_SETUP_SELECT,
      where: {
        active: true,
        memberId: input.memberId,
        provider: input.provider,
      },
    });
    return row ? mapSetup(row) : null;
  }

  async readOwned(input: {
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    setupId: string;
  }): Promise<MemberOwnedProviderSetupRecord> {
    const row = await this.prisma.deviceProviderSetup.findUnique({
      select: DEVICE_PROVIDER_SETUP_SELECT,
      where: { id: input.setupId },
    });
    if (!row || row.memberId !== input.memberId || row.provider !== input.provider) {
      throw new DeviceProviderSetupError(
        "DEVICE_PROVIDER_SETUP_NOT_FOUND",
        "Private provider setup was not found for the current member.",
      );
    }
    return mapSetup(row);
  }

  async transition(
    input: DeviceProviderSetupTransitionInput,
  ): Promise<MemberOwnedProviderSetupRecord> {
    assertApplicationPair(input);
    const update = await this.prisma.deviceProviderSetup.updateMany({
      data: {
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.applicationName === undefined
          ? {}
          : { applicationName: input.applicationName }),
        ...(input.browserRunId === undefined
          ? {}
          : { browserRunId: input.browserRunId }),
        ...(input.completedAt === undefined
          ? {}
          : { completedAt: input.completedAt }),
        ...(input.providerApplicationId === undefined
          ? {}
          : { providerApplicationId: input.providerApplicationId }),
        ...(input.providerApplicationRevision === undefined
          ? {}
          : { providerApplicationRevision: input.providerApplicationRevision }),
        status: input.status,
        version: { increment: 1 },
      },
      where: {
        active: true,
        id: input.setupId,
        memberId: input.memberId,
        provider: input.provider,
        version: input.expectedVersion,
      },
    });
    if (update.count !== 1) {
      throw new DeviceProviderSetupError(
        "DEVICE_PROVIDER_SETUP_CONFLICT",
        "Private provider setup changed. Refresh and try again.",
      );
    }
    return this.readOwned(input);
  }

  async readConnectionDisposition(
    setup: MemberOwnedProviderSetupRecord,
  ): Promise<MemberOwnedProviderSetupConnectionDisposition> {
    const connections = await this.prisma.deviceConnection.findMany({
      orderBy: { connectedAt: "desc" },
      select: {
        id: true,
        providerApplicationId: true,
        providerApplicationRevision: true,
        status: true,
      },
      take: 2,
      where: {
        provider: setup.provider,
        status: { not: "disconnected" },
        userId: setup.memberId,
      },
    });
    if (connections.length === 0) {
      return { kind: "none" };
    }

    const binding = readMemberOwnedProviderSetupBinding(setup);
    const exact = binding
      ? connections.find((connection) =>
          connection.providerApplicationId === binding.applicationId
          && connection.providerApplicationRevision === binding.revision
        )
      : null;
    if (binding && exact && connections.length === 1) {
      switch (exact.status) {
        case "active":
        case "reauthorization_required":
          return {
            binding,
            connectionId: exact.id,
            kind: "exact",
            status: exact.status,
          };
      }
    }
    return {
      connectionId: connections[0]?.id ?? "unknown",
      kind: "conflict",
    };
  }

  async beginDeletion(
    expected: MemberOwnedProviderSetupRecord,
  ): Promise<{
    kind: "connection_conflict" | "ready";
    setup: MemberOwnedProviderSetupRecord;
  }> {
    return this.prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, expected.memberId);
      const current = await tx.deviceProviderSetup.findFirst({
        select: DEVICE_PROVIDER_SETUP_SELECT,
        where: {
          active: true,
          id: expected.id,
          memberId: expected.memberId,
          provider: expected.provider,
          providerApplicationId: expected.providerApplicationId,
          providerApplicationRevision: expected.providerApplicationRevision,
          version: expected.version,
        },
      });
      if (!current) {
        throw new DeviceProviderSetupError(
          "DEVICE_PROVIDER_SETUP_CONFLICT",
          "Private provider setup changed. Refresh and try again.",
        );
      }

      const connection = await tx.deviceConnection.findFirst({
        select: { id: true },
        where: {
          provider: expected.provider,
          status: { not: "disconnected" },
          userId: expected.memberId,
        },
      });
      const status = connection ? "disconnect_first" : "deletion_pending";
      if (current.status === status) {
        return {
          kind: connection ? "connection_conflict" : "ready",
          setup: mapSetup(current),
        };
      }

      const updated = await tx.deviceProviderSetup.updateMany({
        data: {
          status,
          version: { increment: 1 },
        },
        where: {
          active: true,
          id: current.id,
          memberId: current.memberId,
          provider: current.provider,
          providerApplicationId: current.providerApplicationId,
          providerApplicationRevision: current.providerApplicationRevision,
          version: current.version,
        },
      });
      if (updated.count !== 1) {
        throw new DeviceProviderSetupError(
          "DEVICE_PROVIDER_SETUP_CONFLICT",
          "Private provider setup changed. Refresh and try again.",
        );
      }
      const successor = await tx.deviceProviderSetup.findUnique({
        select: DEVICE_PROVIDER_SETUP_SELECT,
        where: { id: current.id },
      });
      if (!successor) {
        throw new DeviceProviderSetupError(
          "DEVICE_PROVIDER_SETUP_NOT_FOUND",
          "Private provider setup was not found for the current member.",
        );
      }
      return {
        kind: connection ? "connection_conflict" : "ready",
        setup: mapSetup(successor),
      };
    }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
  }

  async markConnectedForExactApplication(input: {
    applicationId: string;
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
    revision: number;
  }): Promise<MemberOwnedProviderSetupRecord | null> {
    await this.prisma.deviceProviderSetup.updateMany({
      data: {
        completedAt: new Date(),
        status: "connected",
        version: { increment: 1 },
      },
      where: {
        active: true,
        memberId: input.memberId,
        provider: input.provider,
        providerApplicationId: input.applicationId,
        providerApplicationRevision: input.revision,
        status: "oauth_in_progress",
      },
    });

    const setup = await this.prisma.deviceProviderSetup.findFirst({
      orderBy: { createdAt: "desc" },
      select: DEVICE_PROVIDER_SETUP_SELECT,
      where: {
        active: true,
        memberId: input.memberId,
        provider: input.provider,
        providerApplicationId: input.applicationId,
        providerApplicationRevision: input.revision,
        status: "connected",
      },
    });
    return setup ? mapSetup(setup) : null;
  }

  async markDisconnected(input: {
    memberId: string;
    provider: MemberOwnedDeviceProviderApplicationProvider;
  }): Promise<MemberOwnedProviderSetupRecord | null> {
    const setup = await this.readActive(input);
    if (
      !setup
      || setup.status === "deletion_pending"
      || setup.status === "deleted"
    ) {
      return null;
    }
    const binding = readMemberOwnedProviderSetupBinding(setup);
    return this.transition({
      completedAt: null,
      expectedVersion: setup.version,
      memberId: setup.memberId,
      provider: setup.provider,
      setupId: setup.id,
      status: binding ? "oauth_ready" : "pending",
    });
  }

  async listMemberSetups(memberId: string): Promise<MemberOwnedProviderSetupRecord[]> {
    const rows = await this.prisma.deviceProviderSetup.findMany({
      orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
      select: DEVICE_PROVIDER_SETUP_SELECT,
      where: {
        active: true,
        memberId,
      },
    });
    return rows.map(mapSetup);
  }
}

function mapSetup(row: DeviceProviderSetupRow): MemberOwnedProviderSetupRecord {
  if (!isMemberOwnedDeviceProviderApplicationProvider(row.provider)) {
    throw new DeviceProviderSetupError(
      "DEVICE_PROVIDER_SETUP_PROVIDER_UNSUPPORTED",
      "Stored private provider setup is not supported.",
    );
  }
  if (!Number.isSafeInteger(row.version) || row.version <= 0) {
    throw new TypeError("Stored private provider setup version is invalid.");
  }
  if (
    row.applicationName !== null
    && normalizeProviderApplicationName(row.applicationName) !== row.applicationName
  ) {
    throw new TypeError("Stored private provider application name is invalid.");
  }
  const hasApplicationId = row.providerApplicationId !== null;
  const hasApplicationRevision = row.providerApplicationRevision !== null;
  if (
    hasApplicationId !== hasApplicationRevision
    || (hasApplicationId && row.applicationName === null)
    || (hasApplicationRevision
      && (!Number.isSafeInteger(row.providerApplicationRevision)
        || (row.providerApplicationRevision ?? 0) <= 0))
  ) {
    throw new TypeError("Stored private provider setup application binding is invalid.");
  }
  return {
    ...row,
    provider: row.provider,
    status: requireMemberOwnedProviderSetupStatus(row.status),
  };
}

function assertSetupCoordinates(
  setup: DeviceProviderSetupRow,
  expected: {
    connectSourceId: string;
    connectTarget: string;
    sourceProviderSlug: string | null;
  },
): void {
  if (
    setup.connectSourceId !== expected.connectSourceId
    || setup.connectTarget !== expected.connectTarget
    || setup.sourceProviderSlug !== expected.sourceProviderSlug
  ) {
    throw new DeviceProviderSetupError(
      "DEVICE_PROVIDER_SETUP_CONFLICT",
      "An active private provider setup has different connection coordinates.",
    );
  }
}

function assertApplicationPair(input: DeviceProviderSetupTransitionInput): void {
  if (
    input.applicationName !== undefined
    && input.applicationName !== null
    && normalizeProviderApplicationName(input.applicationName) !== input.applicationName
  ) {
    throw new TypeError("Private provider application name is invalid.");
  }
  const updatesId = input.providerApplicationId !== undefined;
  const updatesRevision = input.providerApplicationRevision !== undefined;
  if (updatesId !== updatesRevision) {
    throw new TypeError("Private provider setup application binding must be updated as a pair.");
  }
  if (!updatesId || !updatesRevision) {
    return;
  }

  const hasId = input.providerApplicationId !== null;
  const hasRevision = input.providerApplicationRevision !== null;
  if (hasId !== hasRevision) {
    throw new TypeError("Private provider setup application binding must be updated as a pair.");
  }
  if (
    hasId
    && (input.providerApplicationId?.trim().length === 0
      || !Number.isSafeInteger(input.providerApplicationRevision)
      || (input.providerApplicationRevision ?? 0) <= 0)
  ) {
    throw new TypeError("Private provider setup application binding is invalid.");
  }
}

function normalizeProviderApplicationName(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length >= 3 && normalized.length <= 80 ? normalized : null;
}

async function requirePersonalMember(input: {
  memberId: string;
  prisma: DeviceProviderSetupClient;
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
    throw new DeviceProviderSetupError(
      "DEVICE_PROVIDER_SETUP_MEMBER_NOT_FOUND",
      "Finish signup before starting private provider setup.",
    );
  }
  if (member.threadContainer !== null || member.hostedGroupRuntime !== null) {
    throw new DeviceProviderSetupError(
      "DEVICE_PROVIDER_SETUP_PERSONAL_MEMBER_REQUIRED",
      "Private provider setup is available only for personal Murph members.",
    );
  }
}
