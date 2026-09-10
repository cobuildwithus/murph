import "server-only";
import type { Prisma } from "@prisma/client";
import { authLookupKey } from "./record-crypto";

export function hostedAuthOtpIdentifier(contact: { kind: "email" | "phone"; value: string }): string {
  // Pinned Better Auth 1.7.3 emailOTP and phoneNumber identifier contracts.
  return contact.kind === "email" ? `sign-in-otp-${contact.value}` : contact.value;
}

export async function lockHostedAuthOtpTx(tx: Prisma.TransactionClient, identifier: string): Promise<void> {
  const key = authLookupKey("verification", "otp-lock", identifier);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hosted-auth:otp'), hashtext(${key}))`;
}
