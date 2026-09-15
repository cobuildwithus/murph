import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import { assertHostedBetterAuthIssuanceEnabled } from "../better-auth/config";
import { hostedAuthRequestIp } from "../better-auth/admission";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { runWithFreshHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk } from "../hosted-onboarding/http";
import { parseApprovalPasskeyRegistration, readApprovalPasskeyRequest } from "./passkey-http";
import { createApprovalRecoveryOptions, recoverApprovalPasskey, rotateApprovalRecoveryKey } from "./passkey-recovery";

const rotateSchema = z.object({ authorization: z.unknown() }).strict();
const optionsSchema = z.object({ key: z.string().max(128) }).strict();
const registerSchema = optionsSchema.extend({ token: z.string().max(128), response: z.unknown() }).strict();

export async function approvalRecoveryRequest(request: Request, operation: "rotate" | "options" | "register"): Promise<Response> {
  assertHostedBetterAuthIssuanceEnabled();
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const { body, prisma, session } = await readApprovalPasskeyRequest(request);
    const limits = hostedAuthRateLimitStorage(prisma);
    for (const [key, max] of [[`approval-recovery:member:${session.member.id}`, 20], [`approval-recovery:ip:${hostedAuthRequestIp(request)}`, 100]] as const) {
      if (!(await limits.consume(key, { max, window: 600 })).allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many attempts. Wait a few minutes and try again.", retryable: true });
    }
    const input = { prisma, session, request };
    if (operation === "rotate") {
      const parsed = rotateSchema.safeParse(body);
      if (!parsed.success) throw invalidRequest();
      return jsonOk({ key: await rotateApprovalRecoveryKey({ ...input, authorization: parsed.data.authorization }) });
    }
    if (operation === "options") {
      const parsed = optionsSchema.safeParse(body);
      if (!parsed.success) throw invalidRequest();
      return jsonOk(await createApprovalRecoveryOptions({ ...input, key: parsed.data.key }));
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest();
    await recoverApprovalPasskey({ ...input, ...parsed.data, response: parseApprovalPasskeyRegistration(parsed.data.response) });
    return jsonOk({ recovered: true });
  });
}

function invalidRequest() { return hostedOnboardingError({ code: "APPROVAL_RECOVERY_INVALID", httpStatus: 400, message: "The recovery request was invalid. Please try again." }); }
