import { beforeEach, expect, it, vi } from "vitest";
import { buildHostedVaultShareProjectionScopeKey } from "@murphai/hosted-execution/vault-share";
import { HOSTED_GROUP_BOARD_SCOPES } from "@/src/lib/hosted-groups/board-scopes";
import { readHostedGroupBoardData } from "@/src/lib/hosted-groups/group-store";

const mocks = vi.hoisted(() => ({ group: vi.fn(), grants: vi.fn(), runtime: vi.fn(), decrypt: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({
  $transaction: (run: (db: object) => unknown) => run({
    hostedGroup: { findUnique: mocks.group }, hostedVaultShare: { findMany: mocks.grants },
  }),
}) }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ hasHostedRuntimeActiveAccess: mocks.runtime }));
vi.mock("@/src/lib/hosted-vault-share/projection-snapshot", () => ({ decryptHostedVaultShareProjectionSnapshotsWithAgeGroups: mocks.decrypt }));

const members = ["ava", "leo"].map(memberId => ({ id: `seat-${memberId}`, memberId }));
const grants = members.flatMap(({ memberId }) => HOSTED_GROUP_BOARD_SCOPES.map(scope => ({
  id: `${memberId}-${scope.projectionKind}`, destinationMemberId: "room", grantorMemberId: memberId, grantedAt: new Date(1),
  projectionKind: scope.projectionKind, projectionScopeJson: scope, projectionScopeKey: buildHostedVaultShareProjectionScopeKey(scope),
})));
const read = (otherMetric?: "steps" | "sleep") => readHostedGroupBoardData({
  viewerId: "ava", otherId: "leo", groupId: "group", runtimeMemberId: "room", now: new Date(), otherMetric,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.runtime.mockResolvedValue(true);
  mocks.group.mockResolvedValue({ runtimeMemberId: "room", members });
  mocks.grants.mockImplementation(({ where, select }) => {
    if (select.status) return [];
    if (select.grantedAt) return grants.filter(grant => where.grantorMemberId.in.includes(grant.grantorMemberId)
      && where.projectionScopeKey.in.includes(grant.projectionScopeKey));
    return where.id.in.map((id: string) => ({ id, projectionSnapshotCiphertext: "sealed" }));
  });
  mocks.decrypt.mockImplementation(({ entries }) => entries.map(() => ({ records: [] })));
});

it.each(["steps", "sleep", undefined] as const)("decrypts the requested board grants for %s", async metric => {
  await read(metric);
  const scope = metric === "steps" ? 2 : 1;
  const expected = metric ? [grants[4 + scope].id] : grants.map(grant => grant.id);
  expect(mocks.decrypt.mock.calls.flatMap(([batch]) => batch.entries.map((entry: { id: string }) => entry.id))).toEqual(expected);
  expect(mocks.grants.mock.calls.filter(([query]) => query.select.projectionSnapshotCiphertext)
    .flatMap(([query]) => query.where.id.in)).toEqual(expected);
  expect(mocks.group).toHaveBeenCalledTimes(2);
  for (const [query] of mocks.group.mock.calls) expect(query.select.members.where.memberId.in).toEqual(["ava", "leo"]);
});

it.each(["viewer membership", "friend membership", "grant generation", "runtime access"])(
  "withholds the scoped records when %s changes during decryption", async loss => {
    const selected = grants[6];
    mocks.decrypt.mockImplementationOnce(() => {
      if (loss.endsWith("membership")) {
        const changed = loss === "viewer membership" ? "ava" : "leo";
        mocks.group.mockResolvedValue({ runtimeMemberId: "room",
          members: members.map(seat => seat.memberId === changed ? { ...seat, id: "replacement" } : seat) });
      } else if (loss === "runtime access") mocks.runtime.mockResolvedValue(false);
      else mocks.grants.mockResolvedValueOnce([{ ...selected, grantedAt: new Date(2) }]);
      return [{ records: [{ data: {}, recordKey: "day", occurredAt: new Date().toISOString() }] }];
    });
    const result = await read("steps");
    if (loss === "viewer membership") expect(result).toBeNull();
    else expect(result?.people[1].projections[2]).toMatchObject({ state: "pending", records: [] });
  },
);
