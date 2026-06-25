import type {
  HostedSensitiveActionChallenge,
  Prisma,
} from "@prisma/client";
import type {
  HostedActionApprovalRequest,
} from "@murphai/hosted-execution/action-approval";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveHostedPublicOrigin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/hosted-web/public-url", () => ({
  resolveHostedPublicOrigin: mocks.resolveHostedPublicOrigin,
}));

import {
  consumeHostedActionApproval,
  requestHostedActionApproval,
} from "@/src/lib/action-approvals";

const MEMBER_ID = "member_action_123";
const REQUEST: HostedActionApprovalRequest = {
  actionFingerprint: "b".repeat(64),
  actionId: `vault-file-send:${"a".repeat(64)}`,
  actionKind: "vault.file.send.v1",
  presentation: {
    body: "Send report.pdf to this conversation.",
    title: "Send a file?",
  },
  returnContactKind: "text",
};

describe("hosted action approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveHostedPublicOrigin.mockReturnValue("https://withmurph.ai");
  });

  it("spends an approved action exactly once and lets a later request create a fresh pending attempt", async () => {
    const prisma = createActionApprovalPrismaFake();
    const now = new Date("2026-06-25T16:00:00.000Z");
    const requested = await requestHostedActionApproval({
      memberId: MEMBER_ID,
      now,
      prisma,
      request: REQUEST,
    });

    expect(requested.status).toBe("pending");
    if (requested.status !== "pending") {
      throw new Error("Expected a pending hosted action approval.");
    }
    expect(requested.approvalUrl).toBe(
      `https://withmurph.ai/approve/${requested.approvalId}`,
    );

    const approvedAt = new Date("2026-06-25T16:01:00.000Z");
    const row = requireApprovalRow(prisma, requested.approvalId);
    row.approvalStatus = "approved";
    row.decidedAt = approvedAt;
    row.expiresAt = new Date("2026-06-25T16:16:00.000Z");

    await expect(consumeHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:02:00.000Z"),
      prisma,
      request: REQUEST,
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "approved",
    });
    expect(
      requireApprovalRow(prisma, requested.approvalId).consumedAt?.toISOString(),
    )
      .toBe("2026-06-25T16:02:00.000Z");

    await expect(consumeHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:03:00.000Z"),
      prisma,
      request: REQUEST,
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "expired",
    });

    const refreshed = await requestHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:04:00.000Z"),
      prisma,
      request: REQUEST,
    });
    const refreshedRow = requireApprovalRow(prisma, requested.approvalId);

    expect(refreshed).toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:19:00.000Z",
      status: "pending",
    });
    expect(refreshedRow.approvalStatus).toBe("pending");
    expect(refreshedRow.consumedAt).toBeNull();
    expect(refreshedRow.decidedAt).toBeNull();
  });

  it("refreshes expired or denied attempts instead of permanently blocking retries", async () => {
    const prisma = createActionApprovalPrismaFake();
    const requested = await requestHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma,
      request: REQUEST,
    });
    const row = requireApprovalRow(prisma, requested.approvalId);
    row.expiresAt = new Date("2026-06-25T16:10:00.000Z");

    const afterExpiry = await requestHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:11:00.000Z"),
      prisma,
      request: REQUEST,
    });

    expect(afterExpiry).toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:26:00.000Z",
      status: "pending",
    });

    const deniedRow = requireApprovalRow(prisma, requested.approvalId);
    deniedRow.approvalStatus = "denied";
    deniedRow.decidedAt = new Date("2026-06-25T16:12:00.000Z");

    const afterDenial = await requestHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:13:00.000Z"),
      prisma,
      request: REQUEST,
    });

    expect(afterDenial).toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:28:00.000Z",
      status: "pending",
    });
    expect(
      requireApprovalRow(prisma, requested.approvalId).decidedAt,
    ).toBeNull();
  });

  it("does not consume an approved action after its delivery window expires", async () => {
    const prisma = createActionApprovalPrismaFake();
    const requested = await requestHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:00:00.000Z"),
      prisma,
      request: REQUEST,
    });
    const row = requireApprovalRow(prisma, requested.approvalId);
    row.approvalStatus = "approved";
    row.decidedAt = new Date("2026-06-25T16:01:00.000Z");
    row.expiresAt = new Date("2026-06-25T16:02:00.000Z");

    await expect(consumeHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:03:00.000Z"),
      prisma,
      request: REQUEST,
    })).resolves.toEqual({
      approvalId: requested.approvalId,
      status: "expired",
    });
    expect(requireApprovalRow(prisma, requested.approvalId).consumedAt)
      .toBeNull();

    await expect(requestHostedActionApproval({
      memberId: MEMBER_ID,
      now: new Date("2026-06-25T16:04:00.000Z"),
      prisma,
      request: REQUEST,
    })).resolves.toMatchObject({
      approvalId: requested.approvalId,
      expiresAt: "2026-06-25T16:19:00.000Z",
      status: "pending",
    });
  });
});

interface ActionApprovalPrismaFake {
  hostedSensitiveActionChallenge: {
    findFirst(
      args: Prisma.HostedSensitiveActionChallengeFindFirstArgs,
    ): Promise<HostedSensitiveActionChallenge | null>;
    updateMany(
      args: Prisma.HostedSensitiveActionChallengeUpdateManyArgs,
    ): Promise<Prisma.BatchPayload>;
    upsert(
      args: Prisma.HostedSensitiveActionChallengeUpsertArgs,
    ): Promise<HostedSensitiveActionChallenge>;
  };
  rows: Map<string, HostedSensitiveActionChallenge>;
}

function createActionApprovalPrismaFake(): ActionApprovalPrismaFake {
  const rows = new Map<string, HostedSensitiveActionChallenge>();
  return {
    hostedSensitiveActionChallenge: {
      async findFirst(args) {
        return Array.from(rows.values()).find((row) =>
          matchesWhere(row, args.where ?? {})
        ) ?? null;
      },
      async updateMany(args) {
        let count = 0;
        for (const row of Array.from(rows.values())) {
          if (!matchesWhere(row, args.where ?? {})) {
            continue;
          }
          rows.delete(row.tokenHash);
          const updated = applyUpdateData(row, args.data);
          rows.set(updated.tokenHash, updated);
          count += 1;
        }
        return { count };
      },
      async upsert(args) {
        const approvalKey = requireStringField(args.where, "approvalKey");
        const existing = Array.from(rows.values()).find((row) =>
          row.approvalKey === approvalKey
        );
        if (existing) {
          return existing;
        }
        const row = buildRowFromCreate(args.create);
        rows.set(row.tokenHash, row);
        return row;
      },
    },
    rows,
  };
}

function requireApprovalRow(
  prisma: ActionApprovalPrismaFake,
  approvalId: string,
): HostedSensitiveActionChallenge {
  const row = Array.from(prisma.rows.values()).find((candidate) =>
    candidate.approvalKey === approvalId
  );
  if (!row) {
    throw new Error(`Missing approval row: ${approvalId}`);
  }
  return row;
}

function buildRowFromCreate(
  create: Prisma.HostedSensitiveActionChallengeUpsertArgs["create"],
): HostedSensitiveActionChallenge {
  return {
    actionHash: nullableStringField(create, "actionHash"),
    actionId: nullableStringField(create, "actionId"),
    approvalKey: nullableStringField(create, "approvalKey"),
    approvalStatus: approvalStatusField(create, "approvalStatus"),
    bindingHash: requireStringField(create, "bindingHash"),
    consumedAt: nullableDateField(create, "consumedAt"),
    createdAt: requireDateField(create, "createdAt"),
    decidedAt: nullableDateField(create, "decidedAt"),
    expiresAt: requireDateField(create, "expiresAt"),
    kind: requireStringField(create, "kind"),
    memberId: requireStringField(create, "memberId"),
    presentationBody: nullableStringField(create, "presentationBody"),
    presentationTitle: nullableStringField(create, "presentationTitle"),
    returnContactKind: nullableStringField(create, "returnContactKind"),
    tokenHash: requireStringField(create, "tokenHash"),
  };
}

function applyUpdateData(
  row: HostedSensitiveActionChallenge,
  data: Prisma.HostedSensitiveActionChallengeUpdateManyArgs["data"],
): HostedSensitiveActionChallenge {
  const updated = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (
      key in updated
      && (value === null || value instanceof Date || typeof value === "string")
    ) {
      setRowField(updated, key, value);
    }
  }
  return updated;
}

function matchesWhere(
  row: HostedSensitiveActionChallenge,
  where: Prisma.HostedSensitiveActionChallengeWhereInput | undefined,
): boolean {
  for (const [key, value] of Object.entries(where ?? {})) {
    if (key === "OR") {
      const clauses = Array.isArray(value) ? value : [];
      if (!clauses.some((clause) => matchesWhere(row, whereInput(clause)))) {
        return false;
      }
      continue;
    }

    if (!matchesWhereValue(readRowField(row, key), value)) {
      return false;
    }
  }
  return true;
}

function matchesWhereValue(rowValue: unknown, expected: unknown): boolean {
  if (
    expected
    && typeof expected === "object"
    && !(expected instanceof Date)
    && !Array.isArray(expected)
  ) {
    const operators = objectRecord(expected);
    if (
      "gt" in operators
      && !(rowValue instanceof Date
        && operators.gt instanceof Date
        && rowValue > operators.gt)
    ) {
      return false;
    }
    if (
      "lte" in operators
      && !(rowValue instanceof Date
        && operators.lte instanceof Date
        && rowValue <= operators.lte)
    ) {
      return false;
    }
    if ("not" in operators) {
      return rowValue !== operators.not;
    }
    return true;
  }
  return rowValue === expected;
}

function readRowField(row: HostedSensitiveActionChallenge, key: string): unknown {
  return objectRecord(row)[key];
}

function setRowField(
  row: HostedSensitiveActionChallenge,
  key: string,
  value: Date | string | null,
): void {
  objectRecord(row)[key] = value;
}

function objectRecord(input: object): Record<string, unknown> {
  return input as Record<string, unknown>;
}

function whereInput(
  value: unknown,
): Prisma.HostedSensitiveActionChallengeWhereInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Prisma.HostedSensitiveActionChallengeWhereInput;
}

function requireStringField(input: object, key: string): string {
  const value = objectRecord(input)[key];
  if (typeof value !== "string") {
    throw new TypeError(`${key} must be a string.`);
  }
  return value;
}

function nullableStringField(input: object, key: string): string | null {
  const value = objectRecord(input)[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${key} must be a string or null.`);
  }
  return value;
}

function requireDateField(input: object, key: string): Date {
  const value = objectRecord(input)[key];
  if (!(value instanceof Date)) {
    throw new TypeError(`${key} must be a Date.`);
  }
  return value;
}

function nullableDateField(input: object, key: string): Date | null {
  const value = objectRecord(input)[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (!(value instanceof Date)) {
    throw new TypeError(`${key} must be a Date or null.`);
  }
  return value;
}

function approvalStatusField(
  input: object,
  key: string,
): HostedSensitiveActionChallenge["approvalStatus"] {
  const value = objectRecord(input)[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (value === "pending" || value === "approved" || value === "denied") {
    return value;
  }
  throw new TypeError(`${key} must be an action approval status or null.`);
}
