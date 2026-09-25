import "server-only";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { DBAdapter } from "better-auth/adapters";
import * as z from "@murphai/contracts/zod-runtime";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { hostedAuthTransactionAdapter } from "./adapter";
import { lockHostedAuthOtpTx } from "./otp-store";
import { authLookupKey } from "./record-crypto";
import type { AuthRecord } from "./record";
import type { HostedAuthSmsVerification } from "./twilio-verify";

const challengeSchema = z.object({
  version: z.literal("twilio-verify-v1"),
  verificationSid: z.string().regex(/^VE[0-9a-f]{32}$/iu).nullable(),
  attempts: z.number().int().min(0).max(3),
  approvedCode: z.string().regex(/^[0-9a-f]{64}$/u).nullable(),
}).strict();
type Challenge = z.infer<typeof challengeSchema>;

export async function sendHostedAuthSmsOtp(input: {
  prisma: PrismaClient; phoneNumber: string; verification: HostedAuthSmsVerification;
}): Promise<void> {
  const id = randomUUID();
  const now = new Date();
  const state: Challenge = { version: "twilio-verify-v1", verificationSid: null, attempts: 0, approvedCode: null };
  await withChallengeLock(input, async (adapter) => {
    await adapter.deleteMany({ model: "verification", where: [{ field: "identifier", value: input.phoneNumber }] });
    await adapter.create({ model: "verification", forceAllowId: true, data: {
      id, identifier: input.phoneNumber, value: JSON.stringify(state),
      createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + 300_000),
    } });
  });
  const verificationSid = await input.verification.send({ phoneNumber: input.phoneNumber });
  await withChallengeLock(input, async (adapter) => {
    const current = await readChallenge(adapter, input.phoneNumber);
    if (current.record.id !== id) throw invalidCode();
    await writeChallenge(adapter, current.record, { ...state, verificationSid });
  });
}

/** Reserves an attempt before external work; approval survives a later DB rollback. */
export async function prepareHostedAuthSmsOtp(input: {
  prisma: PrismaClient; phoneNumber: string; code: string; verification: HostedAuthSmsVerification;
}): Promise<string> {
  if (!/^\d{6}$/u.test(input.code)) throw invalidCode();
  const reserved = await withChallengeLock(input, async (adapter) => {
    const current = await readChallenge(adapter, input.phoneNumber);
    if (!current.state.verificationSid) throw invalidCode();
    const digest = approvedCodeDigest(current.record.id, input.code);
    // Only the already-approved code can retry a failed final database commit.
    if (current.state.approvedCode === digest) return { ...current, approved: true };
    if (current.state.attempts >= 3) throw invalidCode();
    await writeChallenge(adapter, current.record, { ...current.state, attempts: current.state.attempts + 1 });
    return { ...current, approved: false };
  });
  if (reserved.approved) return reserved.record.id;
  // Once approved, different codes never reach the provider again.
  if (reserved.state.approvedCode || !reserved.state.verificationSid) throw invalidCode();
  const approved = await input.verification.check({
    phoneNumber: input.phoneNumber, verificationSid: reserved.state.verificationSid, code: input.code,
  });
  if (!approved) throw invalidCode();
  await withChallengeLock(input, async (adapter) => {
    const current = await readChallenge(adapter, input.phoneNumber);
    if (current.record.id !== reserved.record.id || current.state.verificationSid !== reserved.state.verificationSid) throw invalidCode();
    const digest = approvedCodeDigest(current.record.id, input.code);
    if (current.state.approvedCode && current.state.approvedCode !== digest) throw invalidCode();
    await writeChallenge(adapter, current.record, { ...current.state, approvedCode: digest });
  });
  return reserved.record.id;
}

/** Called only while the canonical login transaction holds the same OTP lock. */
export async function verifyHostedAuthSmsOtpTx(input: {
  adapter: DBAdapter; phoneNumber: string; code: string; verificationId: string;
}): Promise<boolean> {
  const current = await readChallenge(input.adapter, input.phoneNumber);
  return current.record.id === input.verificationId && current.state.verificationSid !== null
    && current.state.approvedCode === approvedCodeDigest(current.record.id, input.code);
}

async function readChallenge(adapter: DBAdapter, phoneNumber: string) {
  const record = await adapter.findOne<AuthRecord>({
    model: "verification", where: [{ field: "identifier", value: phoneNumber }],
  });
  if (!record || !(record.expiresAt instanceof Date) || record.expiresAt <= new Date() || typeof record.value !== "string") throw invalidCode();
  let value: unknown;
  try { value = JSON.parse(record.value); } catch { throw invalidCode(); }
  const parsed = challengeSchema.safeParse(value);
  if (!parsed.success) throw invalidCode();
  return { record, state: parsed.data };
}

async function writeChallenge(adapter: DBAdapter, record: AuthRecord, state: Challenge) {
  await adapter.update({
    model: "verification", where: [{ field: "id", value: record.id }],
    update: { value: JSON.stringify(state), updatedAt: new Date() },
  });
}

function withChallengeLock<T>(
  input: { prisma: PrismaClient; phoneNumber: string }, run: (adapter: DBAdapter) => Promise<T>,
): Promise<T> {
  return input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await lockHostedAuthOtpTx(tx, input.phoneNumber);
    return run(hostedAuthTransactionAdapter(input.prisma, tx, {}));
  }), { maxWait: 5_000, timeout: 10_000 });
}

function approvedCodeDigest(id: string, code: string) {
  return authLookupKey("verification", "sms-approved-code", JSON.stringify([id, code]));
}

function invalidCode() {
  return hostedOnboardingError({ code: "AUTH_CODE_INVALID", httpStatus: 400, message: "That code is invalid or expired. Request a new code and try again." });
}
