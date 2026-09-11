import "server-only";
import { isIP } from "node:net";
import type { PrismaClient } from "@prisma/client";
import * as z from "@murphai/contracts/zod-runtime";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { resolveHostedSignupTimeZone } from "../hosted-onboarding/time-zone-hint";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { readOptionalJsonObject } from "../hosted-onboarding/http";
import { createHostedLinqParticipantContact, type HostedLinqParticipantContact } from "../hosted-onboarding/linq-participant-contact";
import { hostedAuthRateLimitStorage } from "./rate-limit";

export type HostedAuthTransport = "browser" | "native";
const otpBody = z.object({
  kind: z.enum(["email", "phone"]), value: z.string().min(1).max(320),
  code: z.string().regex(/^\d{6}$/u).optional(), inviteCode: z.string().min(1).max(256).optional(),
  timeZone: z.unknown().optional(),
});

export async function admitHostedAuthOtpRequest(input: {
  request: Request; transport: HostedAuthTransport; operation: "send" | "verify"; prisma: PrismaClient;
}): Promise<{ contact: HostedLinqParticipantContact; code: string | undefined; inviteCode: string | undefined; timeZone: string | null }> {
  if (input.request.headers.has("authorization") || (input.transport === "native" && input.request.headers.has("cookie"))) {
    throw invalidRequest();
  }
  if (input.transport === "browser") assertHostedOnboardingMutationOrigin(input.request);
  const parsed = otpBody.safeParse(await readOptionalJsonObject(input.request, { limitBytes: 2_048 }));
  if (!parsed.success) throw invalidRequest();
  const body = parsed.data;
  const contact = requireOtpContact(body);
  const { code, inviteCode } = body;
  if (input.operation === "verify" && !code) throw invalidRequest();
  const ip = hostedAuthRequestIp(input.request);
  const limits = hostedAuthRateLimitStorage(input.prisma);
  const send = input.operation === "send";
  for (const [key, max, window] of [
    [`${input.operation}:ip:${ip}`, send ? 20 : 100, 600],
    [`${input.operation}:contact:${contact.kind}:${contact.value}`, send ? 5 : 20, 600],
    ...(send ? [[`send:cooldown:${contact.kind}:${contact.value}`, 1, 60] as const] : []),
  ] as const) {
    if (!(await limits.consume(key, { max, window })).allowed) {
      throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many sign-in attempts. Wait a moment and try again.", retryable: true });
    }
  }
  return { contact, code, inviteCode, timeZone: resolveHostedSignupTimeZone({ clientTimeZone: body.timeZone, headers: input.request.headers }) };
}

function requireOtpContact(body: { kind: "email" | "phone"; value: string }): HostedLinqParticipantContact {
  const contact = createHostedLinqParticipantContact(body);
  if (!contact) throw invalidRequest();
  if (contact.kind === "email") {
    if (!z.string().email().safeParse(contact.value).success || contact.value.endsWith("@auth.invalid")) throw invalidRequest();
  } else if (!/^\+[1-9]\d{6,14}$/u.test(contact.value)) throw invalidRequest();
  return contact;
}

export function hostedAuthRequestIp(request: Request): string {
  // This header is owned by Vercel's ingress. Arbitrary forwarded headers are
  // not a trusted identity on a standalone development server.
  if (process.env.VERCEL !== "1") {
    if (process.env.NODE_ENV === "production") throw invalidRequest();
    return "127.0.0.1";
  }
  const value = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (!isIP(value)) throw invalidRequest();
  return value.toLowerCase();
}

function invalidRequest() {
  return hostedOnboardingError({ code: "AUTH_REQUEST_INVALID", httpStatus: 400, message: "The sign-in request was invalid. Try again." });
}
