import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPrismaClient } from "@/src/lib/prisma";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { assertUnusedHostedSignupTx } from "@/src/lib/hosted-privacy/unused-signup";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.pathname.startsWith("/murph_test")) throw new Error("Unused-signup proof requires an isolated local test database.");
}
const createdAt = new Date("2026-01-01T12:00:00.000Z");

describe.skipIf(!enabled)("unused-signup locked PostgreSQL admission", () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  const ids: string[] = [];
  beforeAll(() => { prisma = createPrismaClient({ databaseUrl, poolMax: 3 }); });
  afterAll(async () => {
    await prisma.deviceConnectIntent.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });
  async function seed() {
    const id = `unused-signup-${randomUUID()}`;
    ids.push(id);
    await prisma.hostedMember.create({ data: { id, createdAt, initialOnboardingCompletedAt: null,
      identity: { create: { privyUserIdEncrypted: "synthetic-ciphertext", privyUserLookupKey: id } } } });
    return id;
  }
  function check(memberId: string, expectedCreatedAt = createdAt) {
    return prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, memberId);
      await assertUnusedHostedSignupTx({ tx, memberId, createdAt: expectedCreatedAt });
    });
  }
  it("admits an exact unused legacy signup and permits retry after suspension", async () => {
    const id = await seed();
    await expect(check(id)).resolves.toBeUndefined();
    await prisma.hostedMember.update({ where: { id }, data: { suspendedAt: new Date() } });
    await expect(check(id)).resolves.toBeUndefined();
  });
  it("rejects a wrong creation timestamp", async () => {
    await expect(check(await seed(), new Date(0))).rejects.toMatchObject({ code: "UNUSED_SIGNUP_CHANGED" });
  });
  it.each(["activated", "phone", "wallet", "approval", "workspace", "first-party", "device-intent", "returning-session"])("rejects %s state", async (kind) => {
    const id = await seed();
    if (kind === "activated") await prisma.hostedMember.update({ where: { id }, data: { initialOnboardingCompletedAt: new Date() } });
    if (kind === "phone") await prisma.hostedMemberIdentity.update({ where: { memberId: id }, data: { phoneNumberEncrypted: "synthetic-phone" } });
    if (kind === "wallet") await prisma.hostedMemberIdentity.update({ where: { memberId: id }, data: { walletAddressEncrypted: "synthetic-wallet" } });
    if (kind === "approval") await prisma.hostedMemberApprovalCredentials.create({ data: { memberId: id, credentialsEncrypted: "synthetic-approval" } });
    if (kind === "workspace") await prisma.hostedWorkspace.create({ data: { userId: id } });
    if (kind === "first-party") await prisma.hostedAuthRecord.create({ data: { model: "user", id, memberId: id, payloadEncrypted: "synthetic-auth", createdAt, updatedAt: createdAt } });
    if (kind === "device-intent") await prisma.deviceConnectIntent.create({ data: { claimHash: id, memberId: id, provider: "synthetic", connectSourceId: "synthetic", connectTarget: "synthetic", expiresAt: new Date() } });
    if (kind === "returning-session") await prisma.hostedWebSession.create({ data: { id, memberId: id, tokenHash: id, privyUserId: "synthetic-provider", createdAt, lastSeenAt: new Date(), expiresAt: new Date() } });
    await expect(check(id)).rejects.toMatchObject({ code: "UNUSED_SIGNUP_CHANGED" });
  });
  it("observes activation committed while cleanup waits on the member lock", async () => {
    const id = await seed();
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const activation = prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, id);
      locked();
      await gate;
      await tx.hostedMember.update({ where: { id }, data: { initialOnboardingCompletedAt: new Date() } });
    });
    await acquired;
    const cleanup = check(id);
    release();
    await activation;
    await expect(cleanup).rejects.toMatchObject({ code: "UNUSED_SIGNUP_CHANGED" });
  });
});
