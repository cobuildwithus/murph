import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk } from "../hosted-onboarding/http";
import { hostedAuthAdapter, hostedAuthTransactionAdapter } from "./adapter";
import type { AuthRecord } from "./record";
import { requireHostedTelegramClientId, verifyHostedTelegramIdToken } from "./telegram-token";

const identifier = (startId: string) => `native-telegram-start:${startId}`;

export async function createNativeTelegramProof(prisma: PrismaClient, binding: string) {
  const clientId = requireHostedTelegramClientId();
  const startId = randomBytes(32).toString("base64url");
  const now = new Date();
  await hostedAuthAdapter(prisma)({}).create({ model: "verification", data: {
    identifier: identifier(startId), value: binding, createdAt: now, updatedAt: now,
    expiresAt: new Date(now.getTime() + 300_000),
  } });
  return jsonOk({ ok: true, startId, clientId });
}

// The unmodified official SDKs do not send an OIDC nonce. Their registered app
// callback and SDK-owned PKCE carry the token to the app. Native linking adds a
// fresh session-bound start, a two-minute token age and global single use. Web
// proof remains nonce-bound and never calls this owner.
export async function readNativeTelegramProof(input: {
  token: string; startId: string; prisma: PrismaClient; binding: string;
}) {
  const where = [{ field: "identifier", value: identifier(input.startId) }];
  const pending = await hostedAuthAdapter(input.prisma)({}).findOne<AuthRecord>({ model: "verification", where });
  if (!pending || pending.value !== input.binding || !(pending.expiresAt instanceof Date)
    || pending.expiresAt <= new Date()) throw invalidProof();
  const pendingExpiresAt = pending.expiresAt;
  const verified = await verifyHostedTelegramIdToken({ token: input.token, transport: "native", clientId: requireHostedTelegramClientId() });
  if (verified.authenticatedAt.getTime() < pending.createdAt.getTime() - 5_000) throw invalidProof();
  const usedIdentifier = `native-telegram-used:${createHash("sha256").update(input.token).digest("hex")}`;
  if (await hostedAuthAdapter(input.prisma)({}).findOne({ model: "verification", where: [{ field: "identifier", value: usedIdentifier }] })) throw invalidProof();
  return { verified, async consume(tx: Prisma.TransactionClient) {
    const adapter = hostedAuthTransactionAdapter(input.prisma, tx, {});
    const consumed = await adapter.consumeOne<AuthRecord>({ model: "verification", where });
    const now = new Date();
    if (!consumed || JSON.stringify(consumed) !== JSON.stringify(pending) || pendingExpiresAt <= now
      || verified.expiresAt <= now || now.getTime() - verified.authenticatedAt.getTime() > 120_000) throw invalidProof();
    try {
      // Unique verification lookup key serializes replay across all members and
      // sessions. Retain the tombstone beyond the entire token acceptance window.
      await adapter.create({ model: "verification", data: {
        identifier: usedIdentifier, value: "consumed", createdAt: now, updatedAt: now,
        expiresAt: new Date(verified.authenticatedAt.getTime() + 300_000),
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw invalidProof();
      throw error;
    }
  } };
}

function invalidProof() {
  return hostedOnboardingError({ code: "AUTH_TELEGRAM_INVALID", httpStatus: 401, message: "Telegram sign-in could not be verified. Try again." });
}
